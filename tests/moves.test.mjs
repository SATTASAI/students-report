// นักเรียนย้ายเข้า / ย้ายออก / ออกกลางคัน (soft delete) และคะแนนยกมาจาก ปพ.6 โรงเรียนเดิม
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { computeStudentResult } from "../public/js/grading.js";

const ORIGIN = "http://school.test";
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;
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
  await call("admin", "POST", "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.4"] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const c = courses.find((x) => x.code === "ท14101" && x.classroom === "1");
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  const d = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [
    { term_number: 1, kind: "indicator", title: "ฟัง", max_score: 35 }, { term_number: 1, kind: "final", title: "สอบ 1", max_score: 15 },
    { term_number: 2, kind: "indicator", title: "อ่าน", max_score: 35 }, { term_number: 2, kind: "final", title: "สอบ 2", max_score: 15 },
  ] }, { expect: 200 })).data;
  return { env, call, c, d };
}

test("คะแนนยกมา: ใช้แทนช่องคะแนนของภาคนั้น และตัดเกรดรวมกับภาคที่เรียนจริง", () => {
  const items = [
    { id: 1, term_number: 1, kind: "indicator", max_score: 35 }, { id: 2, term_number: 1, kind: "final", max_score: 15 },
    { id: 3, term_number: 2, kind: "indicator", max_score: 35 }, { id: 4, term_number: 2, kind: "final", max_score: 15 },
  ];
  const k = computeStudentResult(items, { 3: 30, 4: 12 }, {}, { collect_ratio: 70 }, {}, { 1: { collect: 28, final: 11.5, total: 39.5 } });
  assert.equal(k.missing, 0);
  assert.equal(k.term_scores[1].carried, true);
  assert.equal(k.term_scores[1].total, 39.5);
  assert.equal(k.total, 81.5);
  assert.equal(k.grade, "4");
  assert.deepEqual(k.carried_terms, [1]);
  // ภาคที่ยกมาไม่มีโครงสร้างคะแนนในระบบเลยก็ใช้ได้ (เช่น ห้องนำร่องที่ภาค 1 อยู่ใน Q-Info)
  const k2 = computeStudentResult(items.slice(2), { 3: 30, 4: 12 }, {}, { collect_ratio: 70 }, {}, { 1: { total: 30 } });
  assert.equal(k2.total, 72);
  assert.equal(k2.grade, "3");
  // ไม่มีคะแนนยกมา → ยังไม่ครบ 2 ภาค
  assert.equal(computeStudentResult(items.slice(2), { 3: 30, 4: 12 }, {}, { collect_ratio: 70 }, {}).grade, null);
});

test("ย้ายออก/ออกกลางคัน: หายจากรายชื่อทุกหน้า แต่ข้อมูลยังอยู่ ยกเลิกได้ และรับกลับด้วยเลขประจำตัวเดิม", async () => {
  const { call, c, d } = await setup();
  const kids = d.students.filter((x) => x.enrollment_status === "enrolled");
  const leaver = kids[2];
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: d.items[0].id, student_id: leaver.id, score: 20 }] }, { expect: 200 });
  // ครูทั่วไปทำไม่ได้
  await call("t1", "POST", "/api/moves/out", { student_id: leaver.id, reason: "transfer" }, { expect: 403 });
  await call("admin", "POST", "/api/moves/out", { student_id: leaver.id, reason: "x" }, { expect: 400 });
  await call("admin", "POST", "/api/moves/out", { student_id: leaver.id, reason: "dropout", term_number: 2, move_date: "2026-12-01", note: "ขาดเรียนต่อเนื่อง ติดตามไม่ได้" }, { expect: 200 });
  await call("admin", "POST", "/api/moves/out", { student_id: leaver.id, reason: "transfer" }, { expect: 409 });
  // หายจากรายวิชา ห้องประจำชั้น กิจกรรม และ ปพ.6
  let cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.ok(!cd.students.some((x) => x.id === leaver.id));
  assert.deepEqual(cd.students.filter((x) => x.number).map((x) => x.number), cd.students.filter((x) => x.number).map((_, i) => i + 1));
  assert.ok(!(await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students.some((x) => x.id === leaver.id));
  assert.ok(!(await call("t1", "GET", `/api/reports/room?${Q}`, null, { expect: 200 })).data.students.some((x) => x.id === leaver.id));
  assert.ok(!(await call("t1", "GET", `/api/activities?${Q}`, null, { expect: 200 })).data.students.some((x) => x.id === leaver.id));
  // ค้นหายังเจอ (soft delete) สถานะออกกลางคัน
  const found = (await call("admin", "GET", `/api/moves?q=${leaver.student_code}`, null, { expect: 200 })).data.results[0];
  assert.equal(found.status, "withdrawn");
  assert.equal(found.enrolled, false);
  // ยกเลิก (บันทึกผิดคน) → กลับมาพร้อมคะแนนเดิม
  let list = (await call("admin", "GET", "/api/moves", null, { expect: 200 })).data;
  assert.equal(list.moves[0].reason, "dropout");
  await call("admin", "POST", `/api/moves/${list.moves[0].id}/undo`, {}, { expect: 200 });
  cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(cd.scores[leaver.id][d.items[0].id], 20);
  // ย้ายออกจริง แล้วกลับมาเรียน → ระเบียนเดิม เลขประจำตัวเดิม
  await call("admin", "POST", "/api/moves/out", { student_id: leaver.id, reason: "transfer", school: "โรงเรียนปลายทาง" }, { expect: 200 });
  await call("admin", "POST", "/api/moves/in", { student_id: leaver.id, grade_level: "ป.4", classroom: "1", term_number: 2 }, { expect: 200 });
  cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  const back = cd.students.find((x) => x.id === leaver.id);
  assert.equal(back.student_code, leaver.student_code);
  assert.equal(back.number, cd.students.filter((x) => x.number).length, "นักเรียนที่เข้าระหว่างปีได้เลขที่ต่อท้าย");
  await call("admin", "POST", "/api/moves/in", { student_id: leaver.id, grade_level: "ป.4", classroom: "1" }, { expect: 409 });
});

test("ย้ายเข้า (นักเรียนใหม่): เลขประจำตัวและเลขบัตรห้ามซ้ำ ต่อท้ายเลขที่ ครูประจำชั้นกรอกคะแนนยกมาจาก ปพ.6", async () => {
  const { call, c, d } = await setup();
  const before = d.students.filter((x) => x.number);
  const base = { grade_level: "ป.4", classroom: "1", term_number: 2, school: "โรงเรียนบ้านเดิม", move_date: "2026-11-20" };
  const kid = { student_code: "20001", name_prefix: "เด็กหญิง", first_name: "ใหม่", last_name: "ย้ายมา", national_id: "1234567890123" };
  await call("admin", "POST", "/api/moves/in", { ...base, student: { ...kid, student_code: before[0].student_code } }, { expect: 409 });
  const nidTaken = (await call("admin", "GET", `/api/moves?q=${before[0].student_code}`, null, { expect: 200 })).data.results[0];
  assert.match(nidTaken.national_id, /x/); // เลขบัตรถูกปิดบางส่วน
  const id = (await call("admin", "POST", "/api/moves/in", { ...base, student: kid }, { expect: 200 })).data.student_id;
  await call("admin", "POST", "/api/moves/in", { ...base, student: { ...kid, student_code: "20002" } }, { expect: 409 }); // เลขบัตรซ้ำ
  let cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  const me = cd.students.find((x) => x.id === id);
  assert.equal(me.number, before.length + 1);
  assert.equal(me.transfer_in_term, 2);
  // ห้องเดิมของทุกคนเลขที่ไม่เลื่อน
  for (const s of before) assert.equal(cd.students.find((x) => x.id === s.id).number, s.number);

  // คะแนนยกมา: ครูประจำชั้นกรอก ภาค 1 เท่านั้น
  const co = (await call("t1", "GET", `/api/homeroom/carryover?${Q}`, null, { expect: 200 })).data;
  assert.deepEqual(co.students.map((x) => [x.id, x.terms, x.school]), [[id, [1], "โรงเรียนบ้านเดิม"]]);
  assert.ok(co.subjects.some((x) => x.code === "ท14101"));
  await call("t2", "PUT", `/api/homeroom/carryover?${Q}`, { changes: [] }, { expect: 403 });
  const put = (changes, expect) => call("t1", "PUT", `/api/homeroom/carryover?${Q}`, { changes }, { expect });
  await put([{ student_id: id, subject_code: "ท14101", term_number: 2, total: 40 }], 400);
  await put([{ student_id: id, subject_code: "ท14101", term_number: 1, total: 51 }], 400);
  await put([{ student_id: id, subject_code: "ท14101", term_number: 1, collect: 30, final: 5, total: 40 }], 400);
  await put([{ student_id: before[0].id, subject_code: "ท14101", term_number: 1, total: 40 }], 400);
  await put([{ student_id: id, subject_code: "ท14101", term_number: 1, collect: 28.5, final: 11 }], 200);
  // ครูผู้สอนกรอกภาค 2 → ผลการเรียนออก
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: d.items[2].id, student_id: id, score: 30 }, { item_id: d.items[3].id, student_id: id, score: 12 }] }, { expect: 200 });
  cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  const k = cd.computed[id];
  assert.equal(k.term_scores[1].total, 39.5);
  assert.equal(k.term_scores[1].carried, true);
  assert.equal(k.missing, 0);
  assert.equal(k.grade, "4"); // 39.5 + 42 = 81.5
  assert.equal(cd.carry[id][1].total, 39.5);
  // ปพ.6 ใช้ผลเดียวกัน
  const rep = (await call("t1", "GET", `/api/reports/room?${Q}`, null, { expect: 200 })).data;
  assert.equal(rep.students.find((x) => x.id === id).subjects.find((x) => x.code === "ท14101").total, 81.5);
  // ลบคะแนนยกมา
  await put([{ student_id: id, subject_code: "ท14101", term_number: 1, total: "" }], 200);
  cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(cd.computed[id].missing, 2);
});
