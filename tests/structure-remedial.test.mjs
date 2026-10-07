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
