import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { submissionChecks } from "../public/js/grading.js";

const ORIGIN = "http://school.test";
async function setup() {
  const env = await makeEnv();
  const cookies = {};
  async function call(who, method, path, body, { expect } = {}) {
    const headers = { "Content-Type": "application/json", Origin: ORIGIN };
    if (who && cookies[who]) headers.Cookie = cookies[who];
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const data = await res.json().catch(() => null);
    if (expect !== undefined) assert.equal(res.status, expect, `${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return { status: res.status, data };
  }
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"], ["t2", "teacher2@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie").split(";")[0];
  }
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.4"] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const c = courses.find((x) => x.code === "ท14101");
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  const d = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [
    { term_number: 2, kind: "indicator", title: "อ่าน", max_score: 35 }, { term_number: 2, kind: "final", title: "สอบ", max_score: 15 },
  ] }, { expect: 200 })).data;
  return { env, call, c, d };
}

test("ตรวจก่อนส่ง: ช่องว่าง ทศนิยม รอยต่อเกรด มส", () => {
  const st = [{ id: 1, name: "ก" }, { id: 2, name: "ข" }, { id: 3, name: "ค" }, { id: 4, name: "ง", enrollment_status: "transferred" }];
  const k = {
    1: { missing: 2, term_scores: { 2: { total: 30 } }, total: 30, total_max: 50 },
    2: { missing: 0, term_scores: { 1: { total: 39.5 }, 2: { total: 40 } }, total: 79.5, total_max: 100, grade: "3.5" },
    3: { missing: 0, term_scores: { 1: { total: 20 }, 2: { total: 20 } }, total: 40, total_max: 100, grade: "มส", original_grade: "มส" },
    4: { missing: 5, term_scores: {}, total: null },
  };
  const r = submissionChecks(st, k);
  assert.deepEqual(r.blanks.map((x) => x.id), [1]);
  assert.deepEqual(r.decimals.map((x) => x.id), [2]);
  assert.deepEqual(r.borderline.map((x) => [x.id, x.need]), [[2, 80]]);
  assert.deepEqual(r.ms.map((x) => x.id), [3]);
});

test("ส่ง → ส่งคืนพร้อมเหตุผล → ส่งใหม่ → ผู้บริหารอนุมัติ → แก้ย้อนหลังต้องส่งคืนก่อน", async () => {
  const { call, c, d } = await setup();
  const [ind, fin] = d.items;
  const s = d.students.filter((x) => x.enrollment_status === "enrolled");
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: s.flatMap((x) => [{ item_id: ind.id, student_id: x.id, score: 30 }, { item_id: fin.id, student_id: x.id, score: 12 }]) }, { expect: 200 });
  // อนุมัติก่อนส่งไม่ได้ (ข้ามรายการที่ยังไม่ส่ง)
  assert.equal((await call("admin", "POST", "/api/admin/courses/approve/x", { course_ids: [c.id] })).status, 404);
  let r = await call("admin", "POST", "/api/admin/courses/approve", { course_ids: [c.id] }, { expect: 200 });
  assert.equal(r.data.approved, 0);
  // ส่ง (ไม่มีอะไรต้องเตือน)
  let dd = (await call("t1", "POST", `/api/courses/${c.id}/submit`, {}, { expect: 200 })).data;
  assert.equal(dd.course.status, "submitted");
  assert.equal(dd.course.submitted_by_name, "ครูสมใจ ใจดี");
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: s[0].id, score: 1 }] }, { expect: 409 });
  // ครูส่งคืนตัวเองไม่ได้, ส่งคืนต้องมีเหตุผล
  await call("t1", "POST", `/api/admin/courses/${c.id}/return`, { note: "แก้" }, { expect: 403 });
  await call("admin", "POST", `/api/admin/courses/${c.id}/return`, { note: "" }, { expect: 400 });
  await call("admin", "POST", `/api/admin/courses/${c.id}/return`, { note: "คะแนนสอบคนที่ 1 ผิด" }, { expect: 200 });
  dd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(dd.course.status, "draft");
  assert.equal(dd.course.return_note, "คะแนนสอบคนที่ 1 ผิด");
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: fin.id, student_id: s[0].id, score: 12.5 }] }, { expect: 200 });
  // ส่งใหม่: มีทศนิยม → ต้องยืนยัน
  const warn = await call("t1", "POST", `/api/courses/${c.id}/submit`, {}, { expect: 409 });
  assert.equal(warn.data.checks.decimals.length, 1);
  await call("t1", "POST", `/api/courses/${c.id}/submit`, { force: true }, { expect: 200 });
  // ครูประเภท teacher อนุมัติไม่ได้ (แม้ได้สิทธิ์ทีมวัดผล)
  await call("t1", "POST", "/api/admin/courses/approve", { course_ids: [c.id] }, { expect: 403 });
  // ต้องผ่านฝ่ายวัดผลตรวจก่อน ผู้บริหารจึงอนุมัติได้
  r = await call("admin", "POST", "/api/admin/courses/approve", { course_ids: [c.id] }, { expect: 200 });
  assert.equal(r.data.approved, 0);
  await call("t1", "POST", "/api/admin/courses/review", { course_ids: [c.id] }, { expect: 403 });
  r = await call("admin", "POST", "/api/admin/courses/review", { course_ids: [c.id] }, { expect: 200 });
  assert.equal(r.data.reviewed, 1);
  assert.equal((await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data.course.status, "reviewed");
  r = await call("admin", "POST", "/api/admin/courses/approve", { course_ids: [c.id] }, { expect: 200 });
  assert.equal(r.data.approved, 1);
  dd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(dd.course.status, "approved");
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  assert.equal(courses.find((x) => x.id === c.id).status, "approved");
  // แก้ย้อนหลัง: ครูต้องให้ส่งคืนก่อน
  const e = await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: fin.id, student_id: s[0].id, score: 13 }] }, { expect: 409 });
  assert.ok(e.data.error.includes("อนุมัติ"));
  // ฝ่ายวัดผลแก้ได้ทันที → บันทึกประวัติ และกลับไปรอผู้บริหารอนุมัติใหม่
  dd = (await call("admin", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(dd.course.can_edit, true);
  assert.equal(dd.course.admin_edit, true);
  await call("admin", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: fin.id, student_id: s[0].id, score: 13 }] }, { expect: 200 });
  dd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(dd.course.status, "reviewed");
  assert.equal(dd.course.can_edit, false);
  assert.equal(dd.scores[s[0].id][fin.id], 13);
  assert.equal(dd.edits[0].what, "แก้คะแนน");
  assert.equal(dd.edits[0].detail, "1 รายการ");
  // แก้ไม่สำเร็จ (ผิดรูปแบบ) ไม่บันทึกประวัติ
  await call("admin", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: fin.id, student_id: s[0].id, score: 99 }] }, { expect: 400 });
  assert.equal((await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data.edits.length, 1);
  await call("admin", "POST", `/api/admin/courses/${c.id}/return`, { note: "ผู้ปกครองขอตรวจสอบคะแนน" }, { expect: 200 });
  dd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(dd.course.approved_at, null);
  const audit = (await call("admin", "GET", "/api/admin/audit", null, { expect: 200 })).data.entries.map((x) => x.action);
  for (const a of ["course.submit", "course.return", "course.review", "course.approve", "course.admin_edit"]) assert.ok(audit.includes(a), a);
});

test("สัดส่วนรายวิชา 80:20 (วิชาปฏิบัติ): ภาคละ 40 + 10 และเปลี่ยนไม่ได้เมื่อส่งผลแล้ว", async () => {
  const { computeStudentResult, structureIssues } = await import("../public/js/grading.js");
  const items = [
    { id: 1, kind: "indicator", max_score: 40, term_number: 1 }, { id: 2, kind: "final", max_score: 10, term_number: 1 },
    { id: 3, kind: "indicator", max_score: 40, term_number: 2 }, { id: 4, kind: "final", max_score: 10, term_number: 2 },
  ];
  assert.deepEqual(structureIssues(items, 80), []);
  assert.equal(structureIssues(items, 70).length, 4); // โครงสร้างเดิม 35+15 ใช้กับ 80:20 ไม่ได้
  const r = computeStudentResult(items, { 1: 32.5, 2: 8, 3: 31, 4: 8.5 }, {}, { collect_ratio: 80, hours_per_year: 80 });
  assert.equal(r.term_scores[1].total, 40.5);
  assert.equal(r.total, 80);
  assert.equal(r.grade, "4");
  assert.equal(r.exact, true);

  const { call, c } = await setup();
  const { subjects } = (await call("admin", "GET", "/api/admin/subjects", null, { expect: 200 })).data;
  const sub = subjects.find((x) => x.code === "ท14101");
  assert.equal(sub.structured_count, 1);
  const body = { grade_level: sub.grade_level, code: sub.code, name: sub.name, learning_area: sub.learning_area, subject_type: sub.subject_type, hours_per_year: sub.hours_per_year, sort_order: sub.sort_order };
  await call("admin", "PUT", `/api/admin/subjects/${sub.id}`, { ...body, collect_ratio: 80 }, { expect: 200 });
  let d = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(d.course.collect_ratio, 80);
  assert.ok(d.structure_issues.some((x) => x.includes("40")), "ต้องเตือนให้ปรับเป็น 40");
  // ปรับโครงสร้างภาค 2 เป็น 40 + 10 แล้วส่ง → ล็อก → เปลี่ยนสัดส่วนไม่ได้
  for (const it of d.items) await call("t1", "PUT", `/api/courses/${c.id}/items/${it.id}`, { term_number: 2, kind: it.kind, title: it.title, max_score: it.kind === "final" ? 10 : 40 }, { expect: 200 });
  d = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.deepEqual(d.structure_issues, []);
  await call("t1", "POST", `/api/courses/${c.id}/submit`, { force: true }, { expect: 200 });
  const e = await call("admin", "PUT", `/api/admin/subjects/${sub.id}`, { ...body, collect_ratio: 70 }, { expect: 409 });
  assert.ok(e.data.error.includes("ส่งคืน"));
  const after = (await call("admin", "GET", "/api/admin/subjects", null, { expect: 200 })).data.subjects.find((x) => x.id === sub.id);
  assert.equal(after.locked_count, 1);
  // เปลี่ยนชื่อวิชาได้ตามปกติ (ไม่แตะสัดส่วน)
  await call("admin", "PUT", `/api/admin/subjects/${sub.id}`, { ...body, name: "ภาษาไทย (แก้ชื่อ)", collect_ratio: 80 }, { expect: 200 });
});
