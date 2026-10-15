import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { computeStudentResult, indicatorResult, effectiveScore } from "../public/js/grading.js";

// ---------- ข้อมูลจริงจาก ปพ.5 ท11101 ป.1/1 ภาค 1/2569 (Q-Info) ----------
// หน่วย 1–6: ท 1.1 ข้อ 2 (5), ท 1.1 ข้อ 2 (5), ท 1.1 ข้อ 1 (8), ท 1.1 ข้อ 2 (10), ท 2.1 ข้อ 1 (2), ท 2.1 ข้อ 3 (5) = 35 + ปลายภาค 15
const MAX = [5, 5, 8, 10, 2, 5];
const PP5 = [ // [คะแนนรายตัวชี้วัด, ปลายภาค, รวมภาคที่ Q-Info พิมพ์]
  [[5, 3, 8, 6, 2, 4], 13, 41], [[5, 3, 8, 6, 2, 4], 13, 41], [[5, 3, 8, 5, 2, 3], 13, 39], [[5, 3, 8, 6, 2, 4], 11, 39],
  [[5, 3, 8, 6, 2, 4], 13, 41], [[5, 4, 8, 8, 2, 4], 13, 44], [[5, 3, 8, 6, 2, 3], 13, 40], [[5, 3, 8, 6, 2, 3], 13, 40],
  [[5, 3, 8, 6, 2, 4], 14, 42], [[5, 3, 8, 6, 2, 3], 14, 41], [[5, 5, 8, 10, 2, 5], 13, 48], [[5, 5, 8, 10, 2, 5], 12, 47],
  [[5, 3, 8, 6, 2, 4], 12, 40], [[5, 5, 8, 10, 2, 5], 14, 49], [[5, 3, 8, 8, 2, 4], 12, 42], [[5, 5, 8, 10, 2, 5], 13, 48],
  [[5, 3, 8, 5, 2, 4], 9, 36], [[5, 3, 8, 6, 2, 5], 13, 42], [[5, 3, 8, 7, 2, 4], 12, 41], [[5, 4, 8, 10, 2, 5], 14, 48],
  [[5, 4, 8, 7, 2, 4], 12, 42], [[5, 4, 8, 7, 2, 5], 11, 42],
];

test("ปพ.5 จริง ท11101 ป.1/1: คะแนนรวมภาคและผลรายตัวชี้วัดตรงกับ Q-Info ทั้ง 22 คน", () => {
  const items = [...MAX.map((m, i) => ({ id: i + 1, kind: "indicator", max_score: m, term_number: 1 })), { id: 7, kind: "final", max_score: 15, term_number: 1 }];
  const s = { collect_ratio: 70, hours_per_year: 200, attendance_pass_pct: 80, indicator_pass_pct: 50 };
  for (const [n, [ind, fin, total]] of PP5.entries()) {
    const scores = Object.fromEntries([...ind.map((v, i) => [i + 1, v]), [7, fin]]);
    const r = computeStudentResult(items, scores, {}, s);
    assert.equal(r.term_scores[1].total, total, `เลขที่ ${n + 1}`);
    assert.equal(r.term_scores[1].collect, total - fin);
    assert.equal(r.exact, true);
    // Q-Info พิมพ์ "ผ" ทุกช่อง (เช่น 3/5, 5/10 ผ่านที่เกณฑ์ 50%)
    assert.deepEqual(r.failed_indicators, [], `เลขที่ ${n + 1}`);
    // ภาค 1 อย่างเดียว: ยังไม่ตัดเกรด (Q-Info พิมพ์ 0 ซึ่งผิด)
    assert.equal(r.grade, null);
  }
});

test("คะแนนแก้ตัวรายตัวชี้วัดนับได้ไม่เกินเกณฑ์ผ่าน", () => {
  const item = { id: 1, kind: "indicator", max_score: 10, term_number: 2 };
  const s = { indicator_pass_pct: 50, indicator_pass_pct_t2: 60 };
  assert.equal(effectiveScore(item, 3, 9, s), 6);   // ภาค 2 เกณฑ์ 60% → นับ 6
  assert.equal(effectiveScore(item, 3, 4, s), 4);   // ยังไม่ถึงเกณฑ์ → นับตามจริง
  assert.equal(effectiveScore(item, 5, 2, s), 5);   // แก้ตัวได้น้อยกว่าเดิม → ใช้คะแนนเดิม
  assert.equal(effectiveScore({ ...item, max_score: 7, term_number: 1 }, 1, 7, s), 3.5);
  assert.equal(effectiveScore({ ...item, kind: "final" }, 3, 9, s), 3); // ปลายภาคไม่มีแก้ตัวรายตัวชี้วัด
  const items = [item, { id: 2, kind: "indicator", max_score: 25, term_number: 2 }, { id: 3, kind: "final", max_score: 15, term_number: 2 }];
  const r = computeStudentResult(items, { 1: 3, 2: 20, 3: 10 }, {}, { ...s, collect_ratio: 70 }, { 1: 9 });
  assert.equal(r.term_scores[2].total, 36);
  assert.deepEqual(r.failed_indicators, []);
  assert.deepEqual(r.remediated, [1]);
  assert.equal(indicatorResult(item, 6, s), "ผ");
});

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
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.1"] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const c1 = courses.find((c) => c.code === "ท11101" && c.classroom === "1");
  const c2 = courses.find((c) => c.code === "ท11101" && c.classroom === "2");
  await call("admin", "PUT", `/api/admin/courses/${c1.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  await call("admin", "PUT", `/api/admin/courses/${c2.id}/teachers`, { user_ids: [3] }, { expect: 200 });
  return { env, call, c1, c2 };
}

test("หน่วยการเรียนรู้ + แม่แบบของวิชา: วิชาการบันทึก ครูห้องอื่นกดใช้ได้", async () => {
  const { call, c1, c2 } = await setup();
  const U = `/api/courses/${c1.id}/units`;
  await call("t1", "POST", U, { term_number: 1, unit_no: 0, title: "x" }, { expect: 400 });
  let d = (await call("t1", "POST", U, { term_number: 1, unit_no: 1, title: "พยัญชนะไทย", hours: 10, task: "ใบงาน" }, { expect: 200 })).data;
  d = (await call("t1", "POST", U, { term_number: 1, unit_no: 2, title: "สระไทย", hours: 10, task: "ใบงาน" }, { expect: 200 })).data;
  const [u1, u2] = d.units;
  assert.equal(u1.task, "ใบงาน");
  // หน่วยของภาค 1 ใช้กับช่องคะแนนภาค 2 ไม่ได้
  await call("t1", "POST", `/api/courses/${c1.id}/items`, { term_number: 2, kind: "indicator", title: "x", max_score: 5, unit_id: u1.id }, { expect: 400 });
  // คะแนนเต็มทศนิยมเกิน 2 ตำแหน่งไม่ได้
  await call("t1", "POST", `/api/courses/${c1.id}/items`, { term_number: 1, kind: "indicator", title: "x", max_score: 5.125 }, { expect: 400 });
  d = (await call("t1", "POST", `/api/courses/${c1.id}/items`, { items: [
    { term_number: 1, kind: "indicator", code: "ท 1.1 ป.1/2", title: "อ่านพยัญชนะ", max_score: 17.5, unit_id: u1.id },
    { term_number: 1, kind: "indicator", code: "ท 1.1 ป.1/2", title: "อ่านสระ", max_score: 17.5, unit_id: u2.id },
    { term_number: 1, kind: "final", title: "สอบปลายภาค 1", max_score: 15 },
  ] }, { expect: 200 })).data;
  assert.equal(d.items.find((i) => i.title === "อ่านสระ").unit_id, u2.id);
  assert.deepEqual(d.structure_issues, []);
  // ครูบันทึกแม่แบบไม่ได้ วิชาการได้
  await call("t1", "PUT", `/api/courses/${c1.id}/template`, {}, { expect: 403 });
  d = (await call("admin", "PUT", `/api/courses/${c1.id}/template`, {}, { expect: 200 })).data;
  assert.equal(d.course.has_template, 1);
  // ครูห้อง 2 ใช้แม่แบบ → ได้หน่วยและช่องคะแนนครบ ผูกหน่วยถูก
  d = (await call("t2", "POST", `/api/courses/${c2.id}/apply-template`, { terms: [1] }, { expect: 200 })).data;
  assert.equal(d.units.length, 2);
  assert.equal(d.items.length, 3);
  const sara = d.items.find((i) => i.title === "อ่านสระ");
  assert.equal(d.units.find((u) => u.id === sara.unit_id).title, "สระไทย");
  // ใช้ซ้ำไม่ได้ (กันช่องซ้ำ)
  await call("t2", "POST", `/api/courses/${c2.id}/apply-template`, { terms: [1] }, { expect: 409 });
  // ภาค 2 ในแม่แบบไม่มี
  await call("t2", "POST", `/api/courses/${c2.id}/apply-template`, { terms: [2] }, { expect: 400 });
  // ลบหน่วย: ช่องคะแนนยังอยู่
  d = (await call("t1", "DELETE", `/api/courses/${c1.id}/units/${u2.id}`, null, { expect: 200 })).data;
  assert.equal(d.items.find((i) => i.title === "อ่านสระ").unit_id, null);
  // คัดลอกจากห้องอื่นได้หน่วยด้วย
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const other = courses.find((c) => c.code === "ค11101" && c.classroom === "1");
  d = (await call("admin", "POST", `/api/courses/${other.id}/copy-items`, { source_course_id: c2.id }, { expect: 200 })).data;
  assert.equal(d.units.length, 2);
});

test("บันทึกคะแนนแก้ตัวผ่าน API: เฉพาะตัวชี้วัดที่ไม่ผ่าน และนับไม่เกินเกณฑ์", async () => {
  const { call, c1 } = await setup();
  let d = (await call("t1", "POST", `/api/courses/${c1.id}/items`, { items: [
    { term_number: 1, kind: "indicator", title: "ก", max_score: 20 }, { term_number: 1, kind: "indicator", title: "ข", max_score: 15 },
    { term_number: 1, kind: "final", title: "สอบ", max_score: 15 },
  ] }, { expect: 200 })).data;
  const [a, b, f] = ["ก", "ข", "สอบ"].map((t) => d.items.find((i) => i.title === t));
  const s = d.students.filter((x) => x.enrollment_status === "enrolled");
  await call("t1", "PUT", `/api/courses/${c1.id}/scores`, { changes: [
    { item_id: a.id, student_id: s[0].id, score: 4 }, { item_id: b.id, student_id: s[0].id, score: 15 }, { item_id: f.id, student_id: s[0].id, score: 10 },
    { item_id: a.id, student_id: s[1].id, score: 15 },
  ] }, { expect: 200 });
  // ทศนิยม 3 ตำแหน่งไม่รับ
  await call("t1", "PUT", `/api/courses/${c1.id}/scores`, { changes: [{ item_id: a.id, student_id: s[2].id, score: 7.125 }] }, { expect: 400 });
  // ผ่านแล้วแก้ตัวไม่ได้ / ไม่มีคะแนนเดิมไม่ได้ / ปลายภาคไม่ได้
  await call("t1", "PUT", `/api/courses/${c1.id}/scores`, { changes: [{ item_id: a.id, student_id: s[1].id, remedial: 18 }] }, { expect: 400 });
  await call("t1", "PUT", `/api/courses/${c1.id}/scores`, { changes: [{ item_id: a.id, student_id: s[3].id, remedial: 18 }] }, { expect: 400 });
  await call("t1", "PUT", `/api/courses/${c1.id}/scores`, { changes: [{ item_id: f.id, student_id: s[0].id, remedial: 15 }] }, { expect: 400 });
  // 4/20 ไม่ผ่าน → แก้ตัวได้ 18 นับ 10 (เกณฑ์ 50%)
  d = (await call("t1", "PUT", `/api/courses/${c1.id}/scores`, { changes: [{ item_id: a.id, student_id: s[0].id, remedial: 18 }] }, { expect: 200 })).data;
  assert.equal(d.remedials[s[0].id][a.id], 18);
  assert.equal(d.scores[s[0].id][a.id], 4);
  assert.equal(d.computed[s[0].id].term_scores[1].total, 35);
  assert.deepEqual(d.computed[s[0].id].failed_indicators, []);
  // ล้างคะแนนแก้ตัว
  d = (await call("t1", "PUT", `/api/courses/${c1.id}/scores`, { changes: [{ item_id: a.id, student_id: s[0].id, remedial: "" }] }, { expect: 200 })).data;
  assert.equal(d.remedials[s[0].id], undefined);
  assert.equal(d.computed[s[0].id].term_scores[1].total, 29);
});

test("หน้าสร้างโครงสร้างรายวิชา: บันทึกทั้งภาคครั้งเดียว เรียงหน่วยใหม่ ย้าย/เอาออก และกันคะแนนหาย", async () => {
  const { call, c1 } = await setup();
  const body = (units, finals = [{ title: "สอบปลายภาค", max_score: 15 }], extra = {}) => ({ term: 1, units, finals, ...extra });
  let d = (await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body([
    { title: "พยัญชนะไทย", hours: 10, task: "ใบงานคัดพยัญชนะ", items: [{ code: "ท 1.1 ป.1/1", title: "อ่านออกเสียง", max_score: 15 }] },
    { title: "สระไทย", hours: "", task: "", items: [{ code: "ท 2.1 ป.1/1", title: "คัดลายมือ", max_score: 20 }] },
  ]), { expect: 200 })).data;
  assert.equal(d.units.length, 2);
  assert.deepEqual(d.units.map((u) => [u.unit_no, u.title, u.task]), [[1, "พยัญชนะไทย", "ใบงานคัดพยัญชนะ"], [2, "สระไทย", null]]);
  assert.equal(d.items.length, 3);
  assert.deepEqual(d.structure_issues.filter((x) => x.startsWith("ภาค 1")), []);
  const [u1, u2] = d.units;
  const a = d.items.find((i) => i.title === "อ่านออกเสียง"), b = d.items.find((i) => i.title === "คัดลายมือ"), f = d.items.find((i) => i.kind === "final");
  assert.equal(a.unit_id, u1.id);
  // สลับลำดับหน่วย + ย้ายตัวชี้วัด a ไปหน่วยสระ (id เดิม ไม่สร้างใหม่)
  d = (await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body([
    { id: u2.id, title: "สระไทย", items: [{ id: b.id, code: b.code, title: b.title, max_score: 20 }, { id: a.id, code: a.code, title: a.title, max_score: 15 }] },
    { id: u1.id, title: "พยัญชนะไทย", items: [] },
  ], [{ id: f.id, title: "สอบปลายภาค", max_score: 15 }]), { expect: 200 })).data;
  assert.equal(d.units.find((u) => u.id === u2.id).unit_no, 1);
  assert.equal(d.items.find((i) => i.id === a.id).unit_id, u2.id);
  assert.equal(d.items.length, 3);
  // กรอกคะแนนแล้ว: ลดคะแนนเต็มต่ำกว่าคะแนนไม่ได้ · เอาช่องออกต้องยืนยัน
  const s = d.students.filter((x) => x.enrollment_status === "enrolled");
  await call("t1", "PUT", `/api/courses/${c1.id}/scores`, { changes: [{ item_id: a.id, student_id: s[0].id, score: 12 }] }, { expect: 200 });
  const keep = (max) => [{ id: u2.id, title: "สระไทย", items: [{ id: b.id, code: b.code, title: b.title, max_score: 20 }, { id: a.id, code: a.code, title: a.title, max_score: max }] }];
  await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body(keep(10), [{ id: f.id, title: "สอบปลายภาค", max_score: 15 }]), { expect: 409 });
  const without = [{ id: u2.id, title: "สระไทย", items: [{ id: b.id, code: b.code, title: b.title, max_score: 35 }] }];
  const r = await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body(without, [{ id: f.id, title: "สอบปลายภาค", max_score: 15 }]), { expect: 409 });
  assert.equal(r.data.needs_confirm, true);
  d = (await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body(without, [{ id: f.id, title: "สอบปลายภาค", max_score: 15 }], { confirm: true }), { expect: 200 })).data;
  assert.equal(d.items.length, 2);
  assert.equal(d.units.length, 1); // หน่วยที่ไม่ส่งมา = ลบ
  // สอบปลายภาคระบุตัวชี้วัดปลายทางที่วัด (เก็บ/แสดง/ไม่ซ้ำ) และติดไปกับแม่แบบ
  const links = [{ code: "ท 1.1 ป.1/1", title: "อ่านออกเสียง" }, { code: "ท 1.1 ป.1/1", title: "อ่านออกเสียง" }, { code: "ท 2.1 ป.1/1", title: "คัดลายมือ" }, { title: "" }];
  d = (await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body(without, [{ id: f.id, title: "สอบปลายภาค", max_score: 15, indicators: links }]), { expect: 200 })).data;
  assert.deepEqual(d.items.find((i) => i.kind === "final").indicators, [{ code: "ท 1.1 ป.1/1", title: "อ่านออกเสียง" }, { code: "ท 2.1 ป.1/1", title: "คัดลายมือ" }]);
  assert.deepEqual(d.items.find((i) => i.kind !== "final").indicators, []);
  await call("admin", "PUT", `/api/courses/${c1.id}/template`, {}, { expect: 200 });
  const tpl = (await call("t1", "GET", `/api/courses/${c1.id}/template`, null, { expect: 200 })).data.template;
  assert.equal(tpl.items.find((i) => i.kind === "final").indicators.length, 2);
  // ตรวจข้อมูล: ไม่มีชื่อหน่วย / คะแนนเต็มผิด / id ของรายวิชาอื่น
  await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body([{ title: "", items: [] }]), { expect: 400 });
  await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body([{ title: "x", items: [{ title: "y", max_score: 0 }] }]), { expect: 400 });
  await call("t1", "PUT", `/api/courses/${c1.id}/structure`, body([{ id: 999999, title: "x", items: [] }]), { expect: 400 });
  await call("t2", "PUT", `/api/courses/${c1.id}/structure`, body([{ title: "x", items: [] }]), { expect: 403 });
});

test("นำโครงสร้างไปใช้กับห้องอื่นที่ครูคนเดียวกันสอน: เฉพาะห้องของตัวเอง คงคะแนนช่องที่ชื่อตรงกัน และต้องยืนยันก่อนลบคะแนน", async () => {
  const { call, c1, c2 } = await setup();
  const mk = (units, finals) => ({ term: 1, units, finals });
  const U = [{ title: "พยัญชนะไทย", hours: 10, task: "ใบงาน", items: [{ code: "ท 1.1 ป.1/1", title: "อ่านออกเสียง", max_score: 15 }, { code: "ท 2.1 ป.1/1", title: "คัดลายมือ", max_score: 20 }] }];
  const F = [{ title: "สอบปลายภาค", max_score: 15, indicators: [{ code: "ท 1.1 ป.1/1", title: "อ่านออกเสียง" }] }];
  await call("t1", "PUT", `/api/courses/${c1.id}/structure`, mk(U, F), { expect: 200 });
  // t1 ไม่ได้สอน ป.1/2 → ไม่มีห้องให้เลือก และส่งตรงก็ไม่ได้
  assert.deepEqual((await call("t1", "GET", `/api/courses/${c1.id}/apply-targets`, null, { expect: 200 })).data.courses, []);
  await call("t1", "POST", `/api/courses/${c1.id}/apply-to`, { target_ids: [c2.id], terms: [1] }, { expect: 403 });
  // ให้ t1 สอนห้อง 2 ด้วย; ห้อง 2 มีโครงสร้างเดิมและคะแนนแล้ว
  await call("admin", "PUT", `/api/admin/courses/${c2.id}/teachers`, { user_ids: [2, 3] }, { expect: 200 });
  let d2 = (await call("t1", "PUT", `/api/courses/${c2.id}/structure`, mk([{ title: "เดิม", items: [{ code: "ท 1.1 ป.1/1", title: "อ่านออกเสียง", max_score: 15 }, { title: "งานเก่า", max_score: 20 }] }], [{ title: "สอบปลายภาค", max_score: 15, indicators: [{ title: "x" }] }]), { expect: 200 })).data;
  const sid = d2.students.find((s) => s.enrollment_status === "enrolled").id;
  const keepId = d2.items.find((i) => i.title === "อ่านออกเสียง").id, oldId = d2.items.find((i) => i.title === "งานเก่า").id;
  await call("t1", "PUT", `/api/courses/${c2.id}/scores`, { changes: [{ item_id: keepId, student_id: sid, score: 12 }, { item_id: oldId, student_id: sid, score: 9 }] }, { expect: 200 });
  const tg = (await call("t1", "GET", `/api/courses/${c1.id}/apply-targets`, null, { expect: 200 })).data.courses;
  assert.deepEqual(tg.map((c) => c.id), [c2.id]);
  assert.equal(tg[0].terms[1].scores, 2);
  await call("t1", "POST", `/api/courses/${c1.id}/apply-to`, { target_ids: [c2.id], terms: [2] }, { expect: 400 }); // ภาค 2 ยังไม่มีโครงสร้าง
  const r = await call("t1", "POST", `/api/courses/${c1.id}/apply-to`, { target_ids: [c2.id], terms: [1] }, { expect: 409 });
  assert.equal(r.data.needs_confirm, true);
  assert.deepEqual(r.data.blocked[0].items, ["งานเก่า"]);
  const ok = (await call("t1", "POST", `/api/courses/${c1.id}/apply-to`, { target_ids: [c2.id], terms: [1], confirm: true }, { expect: 200 })).data;
  assert.deepEqual(ok.applied, ["ป.1/2"]);
  d2 = (await call("t1", "GET", `/api/courses/${c2.id}`, null, { expect: 200 })).data;
  assert.deepEqual(d2.units.map((u) => [u.title, u.task]), [["พยัญชนะไทย", "ใบงาน"]]);
  assert.equal(d2.items.length, 3);
  assert.equal(d2.items.find((i) => i.title === "อ่านออกเสียง").id, keepId); // ช่องชื่อตรงกันใช้ id เดิม
  assert.equal(d2.scores[sid][keepId], 12); // คะแนนที่กรอกไว้ยังอยู่
  assert.equal(d2.scores[sid][oldId], undefined);
  assert.equal(d2.items.find((i) => i.kind === "final").indicators.length, 1);
  assert.ok(!d2.items.some((i) => i.id === oldId));
});

test("ใช้โครงสร้างข้ามปีการศึกษา: ดึงจากปีก่อนเป็นร่าง และแม่แบบของวิชาจากปีก่อนใช้ต่อได้", async () => {
  const { env, call, c1 } = await setup();
  // ปีก่อน 2568: วิชา ท11101 ป.1 ห้อง 1 มีโครงสร้างและแม่แบบ
  await env.DB.prepare("INSERT INTO academic_years (id, year_be, label, start_date, end_date, status) VALUES (9, 2568, 'ปีการศึกษา 2568', '2025-05-01', '2026-03-31', 'closed')").run();
  const tpl = { units: [{ key: 1, term_number: 1, unit_no: 1, title: "หน่วยปีก่อน", hours: 5, task: "ชิ้นงาน" }], items: [{ term_number: 1, kind: "indicator", code: "ท 1.1 ป.1/1", title: "อ่าน", max_score: 35, unit_key: 1, indicators: [] }, { term_number: 1, kind: "final", code: null, title: "สอบ", max_score: 15, unit_key: null, indicators: [] }] };
  const sub = await env.DB.prepare("INSERT INTO gr_subjects (academic_year_id, grade_level, code, name, learning_area, subject_type, hours_per_year, collect_ratio, sort_order, template, template_updated_at) VALUES (9,'ป.1','ท11101','ภาษาไทย','ภาษาไทย','basic',200,70,10,?, '2025-06-01')").bind(JSON.stringify(tpl)).run();
  const old = await env.DB.prepare("INSERT INTO gr_courses (subject_id, classroom) VALUES (?, '1')").bind(sub.meta.last_row_id).run();
  const oc = old.meta.last_row_id;
  const u = await env.DB.prepare("INSERT INTO gr_units (course_id, term_number, unit_no, title, hours, task) VALUES (?,1,1,'หน่วยปีก่อน',5,'ชิ้นงาน')").bind(oc).run();
  await env.DB.prepare("INSERT INTO gr_items (course_id, term_number, kind, code, title, max_score, sort_order, unit_id) VALUES (?,1,'indicator','ท 1.1 ป.1/1','อ่าน',35,10,?)").bind(oc, u.meta.last_row_id).run();
  // หน้าใช้โครงสร้างจากห้องอื่น/ปีก่อน เห็นห้องปีก่อน และดึงโครงสร้างได้ (ครูไม่ได้สอนวิชาปีก่อนก็ดึงได้ เพราะรหัสวิชาและชั้นเดียวกัน)
  const sib = (await call("t1", "GET", `/api/courses/${c1.id}/siblings`, null, { expect: 200 })).data.courses;
  const s = sib.find((x) => x.id === oc);
  assert.equal(s.year_be, 2568); assert.equal(s.t1_items, 1); assert.equal(s.t2_items, 0);
  const st = (await call("t1", "GET", `/api/courses/${c1.id}/source-structure?source=${oc}`, null, { expect: 200 })).data;
  assert.equal(st.source.year_be, 2568);
  assert.equal(st.units[0].task, "ชิ้นงาน");
  assert.equal(st.items[0].unit_key, st.units[0].key);
  // วิชาอื่นดึงไม่ได้
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const math = courses.find((c) => c.code === "ค11101" && c.classroom === "1");
  await call("t1", "GET", `/api/courses/${c1.id}/source-structure?source=${math.id}`, null, { expect: 403 });
  // ปีนี้ยังไม่ตั้งแม่แบบ → ใช้แม่แบบปีก่อน
  const d = (await call("t1", "GET", `/api/courses/${c1.id}`, null, { expect: 200 })).data;
  assert.equal(d.course.has_template, 1); assert.equal(d.course.template_inherited, 1);
  assert.equal((await call("t1", "GET", `/api/courses/${c1.id}/template`, null, { expect: 200 })).data.from_year, 2568);
  const ap = (await call("t1", "POST", `/api/courses/${c1.id}/apply-template`, { terms: [1] }, { expect: 200 })).data;
  assert.equal(ap.units[0].title, "หน่วยปีก่อน");
  assert.equal(ap.items.length, 2);
});
