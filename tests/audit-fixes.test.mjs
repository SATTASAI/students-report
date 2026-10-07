// ป้องกันจุดผิดพลาดที่พบจากการตรวจระบบ (8 ต.ค. 2569): อัตราส่วน โครงสร้าง การบันทึก และเอกสาร
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { remedialCap, indicatorResult, requiredHours, computeStudentResult, effectiveScore } from "../public/js/grading.js";

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
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie").split(";")[0];
  }
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.4"] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const c = courses.find((x) => x.code === "ท14101");
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  const d = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [
    { term_number: 1, kind: "indicator", title: "ฟัง", max_score: 35 }, { term_number: 1, kind: "final", title: "สอบ 1", max_score: 15 },
    { term_number: 2, kind: "indicator", title: "อ่าน", max_score: 35 }, { term_number: 2, kind: "final", title: "สอบ 2", max_score: 15 },
  ] }, { expect: 200 })).data;
  return { call, c, d, students: d.students.filter((x) => x.enrollment_status === "enrolled") };
}

test("คะแนนแก้ตัวนับได้ = คะแนน 2 ตำแหน่งที่น้อยที่สุดที่ผ่านเกณฑ์ และผลรายตัวชี้วัดต้องเป็น ผ", () => {
  const settings = { indicator_pass_pct: 50, indicator_pass_pct_t2: 55 };
  for (const [max, term] of [[4.35, 2], [1.29, 1], [7, 1], [10, 2], [3.33, 2], [12.5, 1]]) {
    const item = { id: 1, max_score: max, term_number: term, kind: "indicator" };
    const cap = remedialCap(item, settings);
    assert.equal(indicatorResult(item, cap, settings), "ผ", `cap ${cap} ของเต็ม ${max} ต้องผ่าน`);
    assert.equal(indicatorResult(item, Math.round((cap - 0.01) * 100) / 100, settings), "มผ", `ต่ำกว่า cap ต้องไม่ผ่าน (${max})`);
    assert.equal(effectiveScore(item, 0, max, settings), cap);
  }
  // ลบคะแนนเดิมแล้ว คะแนนแก้ตัวที่ค้างไม่นับแทน (ถือว่ายังไม่ครบ)
  assert.equal(effectiveScore({ max_score: 10, term_number: 1, kind: "indicator" }, null, 8, { indicator_pass_pct: 50 }), null);
});

test("เกณฑ์เวลาเรียน 0% คือ 0 จริง และรวมภาคที่ย่อขยายต้องเท่ากับผลบวกส่วนที่แสดง", () => {
  assert.equal(requiredHours(40, 0), 0);
  assert.equal(requiredHours(40, ""), 32);
  const items = [{ id: 1, term_number: 1, kind: "indicator", max_score: 30 }, { id: 2, term_number: 1, kind: "final", max_score: 7 }];
  const k = computeStudentResult(items, { 1: 12.3, 2: 0.33 }, {}, { collect_ratio: 70 }, {});
  const t = k.term_scores[1];
  assert.equal(t.exact, false);
  assert.equal(t.total, Math.round((t.collect + t.final) * 100) / 100);
});

test("สัดส่วนคะแนนรับเฉพาะที่ตกลงไว้ และนำเข้ารายวิชาเปลี่ยนสัดส่วนของวิชาที่ส่งผลแล้วไม่ได้", async () => {
  const { call, c, d, students } = await setup();
  const { subjects } = (await call("admin", "GET", "/api/admin/subjects", null, { expect: 200 })).data;
  const sub = subjects.find((x) => x.code === "ท14101");
  const body = { grade_level: sub.grade_level, code: sub.code, name: sub.name, learning_area: sub.learning_area, subject_type: sub.subject_type, hours_per_year: sub.hours_per_year, sort_order: sub.sort_order };
  for (const bad of [65, 0, 33]) await call("admin", "PUT", `/api/admin/subjects/${sub.id}`, { ...body, collect_ratio: bad }, { expect: 400 });
  const st = (await call("admin", "GET", "/api/admin/settings", null, { expect: 200 })).data.settings;
  await call("admin", "PUT", "/api/admin/settings", { ...st, collect_ratio: 65 }, { expect: 400 });
  // ส่งผล แล้วลองนำเข้าเปลี่ยนสัดส่วน
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: students.flatMap((s) => d.items.map((it) => ({ item_id: it.id, student_id: s.id, score: it.kind === "final" ? 10 : 25 }))) }, { expect: 200 });
  await call("t1", "POST", `/api/courses/${c.id}/submit`, { force: true }, { expect: 200 });
  const row = { grade_level: sub.grade_level, code: sub.code, name: sub.name, learning_area: sub.learning_area, subject_type: "พื้นฐาน", hours_per_year: sub.hours_per_year, collect_ratio: 80 };
  const imp = (await call("admin", "POST", "/api/admin/import/subjects", { rows: [row] }, { expect: 200 })).data;
  assert.equal(imp.ok, false);
  assert.match(imp.errors[0].error, /ส่งผลแล้ว/);
  assert.equal((await call("admin", "GET", "/api/admin/subjects", null, { expect: 200 })).data.subjects.find((x) => x.id === sub.id).collect_ratio, sub.collect_ratio);
  // เปลี่ยนเกณฑ์ผ่านหลังมีรายวิชาส่งแล้วต้องยืนยันก่อน
  const ch = await call("admin", "PUT", "/api/admin/settings", { ...st, indicator_pass_pct: 60 }, { expect: 409 });
  assert.equal(ch.data.needs_confirm, true);
  await call("admin", "PUT", "/api/admin/settings", { ...st, indicator_pass_pct: 60, confirm_locked: true }, { expect: 200 });
});

test("บันทึกคะแนน: รูปแบบตัวเลขเข้มงวด ลบคะแนนแล้วคะแนนแก้ตัวไม่หาย เวลาเรียนไม่ปัดขึ้น", async () => {
  const { call, c, d, students } = await setup();
  const ind = d.items.find((i) => i.term_number === 1 && i.kind === "indicator"), sid = students[0].id;
  for (const bad of ["1e1", "0x5", true, [5], "-1", "abc"]) {
    await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: sid, score: bad }] }, { expect: 400 });
  }
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: sid, score: "12,5" }] }, { expect: 200 });
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: sid, score: 5 }] }, { expect: 200 });
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: sid, remedial: 30 }] }, { expect: 200 });
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: sid, score: "" }] }, { expect: 200 });
  let cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(cd.scores[sid]?.[ind.id], undefined);
  assert.equal(cd.remedials[sid][ind.id], 30);
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: sid, score: 5 }] }, { expect: 200 });
  cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(cd.remedials[sid][ind.id], 30);
  // ลดคะแนนเต็มต่ำกว่าคะแนนแก้ตัวที่มีอยู่ไม่ได้
  await call("t1", "PUT", `/api/courses/${c.id}/items/${ind.id}`, { term_number: 1, kind: "indicator", title: "ฟัง", max_score: 20 }, { expect: 409 });
  // คะแนนผิดบางช่อง: เซิร์ฟเวอร์บอกช่องที่ผิด (index) เพื่อให้หน้าเว็บบันทึกช่องที่เหลือได้
  const e = (await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: sid, score: 5 }, { item_id: ind.id, student_id: students[1].id, score: 99 }] }, { expect: 400 })).data;
  assert.deepEqual(e.errors.map((x) => x.index), [1]);
  // เวลาเรียน: 31.95 ต้องไม่กลายเป็น 32 (ไม่ปัดขึ้น)
  await call("t1", "PUT", `/api/courses/${c.id}/results`, { changes: [{ student_id: sid, hours_attended: "31.95" }] }, { expect: 200 });
  cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(cd.results[sid].hours_attended, 31.95);
  await call("t1", "PUT", `/api/courses/${c.id}/results`, { changes: [{ student_id: sid, hours_attended: "1e1" }] }, { expect: 400 });
});

test("ส่งผลเมื่อภาคหนึ่งยังไม่มีข้อมูล: ต้องยืนยันก่อน · คะแนนไม่ครบไม่พิมพ์เป็นตัวเลขรวม · ร้อยละ 3 ขึ้นไปว่างเมื่อยังไม่มีผล", async () => {
  const { call, c, d, students } = await setup();
  const t2 = d.items.filter((i) => i.term_number === 2);
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: t2[0].id, student_id: students[0].id, score: 20 }] }, { expect: 200 });
  const rep = (await call("admin", "GET", "/api/reports/room?grade=" + encodeURIComponent("ป.4") + "&room=1", null, { expect: 200 })).data;
  const sub = rep.students.find((x) => x.id === students[0].id).subjects.find((x) => x.code === "ท14101");
  assert.ok(sub.missing > 0, "ยังมีช่องว่าง");
  assert.equal(sub.grade, null);
  const sum = (await call("admin", "GET", "/api/reports/summary", null, { expect: 200 })).data;
  const row = sum.subjects.find((x) => x.code === "ท14101");
  assert.equal(row.good_pct, null);
  assert.equal(Object.values(row.counts).reduce((a, b) => a + b, 0), row.n);
});
