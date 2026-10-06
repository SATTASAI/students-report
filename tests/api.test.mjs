import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";

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
    return { status: res.status, data, res };
  }
  async function loginAs(who, email) {
    const r = await call(null, "POST", "/api/auth/login", { email, password: PASSWORD }, { expect: 200 });
    cookies[who] = r.res.headers.get("Set-Cookie").split(";")[0];
  }
  await loginAs("admin", "admin@test.local");
  await loginAs("t1", "teacher1@test.local");
  await loginAs("t2", "teacher2@test.local");
  await loginAs("pending", "pending@test.local");
  return { env, call };
}

test("เข้าสู่ระบบ: รหัสผิด / ยังไม่มีสิทธิ์ / ล็อกหลังผิด 5 ครั้ง", async () => {
  const { call } = await setup();
  await call(null, "POST", "/api/auth/login", { email: "teacher1@test.local", password: "wrong" }, { expect: 401 });
  await call(null, "GET", "/api/me", null, { expect: 401 });
  await call("pending", "GET", "/api/me", null, { expect: 403 });
  for (let i = 0; i < 4; i++) await call(null, "POST", "/api/auth/login", { email: "teacher2@test.local", password: "x" }, { expect: 401 });
  await call(null, "POST", "/api/auth/login", { email: "teacher2@test.local", password: "x" }, { expect: 401 });
  await call(null, "POST", "/api/auth/login", { email: "teacher2@test.local", password: PASSWORD }, { expect: 429 });
});

test("กันคำขอข้ามเว็บไซต์ (CSRF)", async () => {
  const { env } = await setup();
  const res = await worker.fetch(new Request(ORIGIN + "/api/auth/logout", { method: "POST", headers: { Origin: "https://evil.example" } }), env);
  assert.equal(res.status, 403);
});

async function prepareYear(call) {
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.1", "ป.4"] }, { expect: 200 });
  const gen = await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  const { data } = await call("admin", "GET", "/api/admin/courses", null, { expect: 200 });
  return { gen: gen.data, courses: data.courses };
}

test("ผู้ดูแลสร้างวิชา/รายวิชาตามห้อง และครูเห็นเฉพาะวิชาที่ได้รับมอบหมาย", async () => {
  const { call } = await setup();
  await call("t1", "POST", "/api/admin/subjects/template", {}, { expect: 403 });
  const { gen, courses } = await prepareYear(call);
  // ป.1 มี 2 ห้อง × 9 วิชา + ป.4 1 ห้อง × 9 วิชา = 27 (อ.3 ไม่มีเพราะไม่ใช่ประถม)
  assert.equal(gen.created, 27);
  const again = await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  assert.equal(again.data.created, 0, "สร้างซ้ำต้องไม่เพิ่ม");
  const thai11 = courses.find((c) => c.code === "ท11101" && c.classroom === "1");
  assert.equal(thai11.hours_per_year, 200);
  assert.equal(courses.find((c) => c.code === "ท14101").hours_per_year, 160);
  await call("admin", "PUT", `/api/admin/courses/${thai11.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  const me1 = await call("t1", "GET", "/api/me", null, { expect: 200 });
  assert.deepEqual(me1.data.courses.map((c) => c.id), [thai11.id]);
  await call("t2", "GET", `/api/courses/${thai11.id}`, null, { expect: 403 });
  const detail = await call("t1", "GET", `/api/courses/${thai11.id}`, null, { expect: 200 });
  // ป.1/1 มี 12 คนในภาค 1; ภาค 2 ย้ายห้อง 1 คน → เหลือ 11 (รวมคนที่ย้ายออกจากโรงเรียน 1 คน)
  assert.equal(detail.data.students.length, 11);
  assert.ok(detail.data.students.some((s) => s.enrollment_status === "transferred"));
  // เลขที่: ชายก่อนหญิง และคนที่ย้ายออกอยู่ท้ายสุดโดยไม่มีเลขที่
  const active = detail.data.students.filter((s) => s.enrollment_status === "enrolled");
  const genders = active.map((s) => s.gender).join("");
  assert.match(genders, /^ช+ญ+$/);
  assert.deepEqual(active.map((s) => s.number), active.map((_, i) => i + 1));
  assert.equal(detail.data.students.at(-1).enrollment_status, "transferred");
  assert.equal(detail.data.students.at(-1).number, null);
  // เปลี่ยนเป็นเรียงตามเลขประจำตัว
  const st = (await call("admin", "GET", "/api/admin/settings", null, { expect: 200 })).data.settings;
  await call("admin", "PUT", "/api/admin/settings", { ...st, roster_order: "code" }, { expect: 200 });
  const byCode = (await call("t1", "GET", `/api/courses/${thai11.id}`, null, { expect: 200 })).data.students.filter((s) => s.enrollment_status === "enrolled");
  const codes = byCode.map((s) => Number(s.student_code));
  assert.deepEqual(codes, [...codes].sort((a, b) => a - b));
});

test("กรอกคะแนน ตัดเกรดไม่ปัด และกันคะแนนผิดพลาด", async () => {
  const { call } = await setup();
  const { courses } = await prepareYear(call);
  const c = courses.find((x) => x.code === "ค11101" && x.classroom === "1");
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  const r = await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [
    { term_number: 1, kind: "indicator", code: "ค 1.1 ป.1/1", title: "บอกจำนวน", max_score: 20 },
    { term_number: 1, kind: "final", title: "สอบปลายภาค 1", max_score: 15 },
    { term_number: 2, kind: "indicator", code: "ค 1.1 ป.1/2", title: "บวกลบ", max_score: 50 },
    { term_number: 2, kind: "final", title: "สอบปลายภาค 2", max_score: 15 },
  ] }, { expect: 200 });
  const items = r.data.items;
  const [i1, f1, i2, f2] = [items.find((i) => i.title === "บอกจำนวน"), items.find((i) => i.title === "สอบปลายภาค 1"), items.find((i) => i.title === "บวกลบ"), items.find((i) => i.title === "สอบปลายภาค 2")];
  const s = r.data.students.filter((x) => x.enrollment_status === "enrolled");
  // คนที่ 1: เก็บ 55.9/70 → 55.9/70*70 = 55.9; สอบ 24/30 → 24 → รวม 79.9 → ต้องได้ 3.5 (ไม่ปัด)
  const changes = [
    { item_id: i1.id, student_id: s[0].id, score: 16 }, { item_id: i2.id, student_id: s[0].id, score: 39.9 },
    { item_id: f1.id, student_id: s[0].id, score: 12 }, { item_id: f2.id, student_id: s[0].id, score: 12 },
    // คนที่ 2: เต็มทุกช่อง → 4
    { item_id: i1.id, student_id: s[1].id, score: 20 }, { item_id: i2.id, student_id: s[1].id, score: 50 },
    { item_id: f1.id, student_id: s[1].id, score: 15 }, { item_id: f2.id, student_id: s[1].id, score: 15 },
    // คนที่ 3: ขาดสอบปลายภาค 2 → ร
    { item_id: i1.id, student_id: s[2].id, score: 10 }, { item_id: i2.id, student_id: s[2].id, score: 25 }, { item_id: f1.id, student_id: s[2].id, score: 7 },
  ];
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes }, { expect: 200 });
  // คะแนนเกินเต็ม → ไม่บันทึกทั้งชุด
  const bad = await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: i1.id, student_id: s[3].id, score: 5 }, { item_id: i1.id, student_id: s[4].id, score: 21 }] }, { expect: 400 });
  assert.equal(bad.data.errors.length, 1);
  // นักเรียนนอกห้อง
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: i1.id, student_id: 9999, score: 5 }] }, { expect: 400 });
  const d = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(d.scores[s[3].id], undefined, "ชุดที่ผิดต้องไม่ถูกบันทึกบางส่วน");
  assert.equal(d.computed[s[0].id].total, 79.9);
  assert.equal(d.computed[s[0].id].grade, "3.5");
  assert.equal(d.computed[s[1].id].grade, "4");
  assert.equal(d.computed[s[2].id].grade, "ร");
  assert.ok(d.computed[s[2].id].reason.includes("ไม่ครบ"));
  // ตัวชี้วัดไม่ผ่าน: คนที่ 3 ได้ 10/20 = 50% (ผ่าน), 25/50 = 50% (ผ่าน)
  assert.equal(d.computed[s[2].id].failed_indicators.length, 0);
  // ลดคะแนนเต็มต่ำกว่าคะแนนที่กรอกไม่ได้
  await call("t1", "PUT", `/api/courses/${c.id}/items/${i1.id}`, { term_number: 1, kind: "indicator", title: "บอกจำนวน", max_score: 15 }, { expect: 409 });
  // ลบช่องที่มีคะแนนต้องยืนยัน
  const del = await call("t1", "DELETE", `/api/courses/${c.id}/items/${i1.id}`, null, { expect: 409 });
  assert.equal(del.data.needs_confirm, true);
});

test("เวลาเรียนไม่ถึง 80% → มส, สอบแก้ตัว 0 ได้สูงสุด 1, ยืนยันผลแล้วล็อก", async () => {
  const { call } = await setup();
  const { courses } = await prepareYear(call);
  const c = courses.find((x) => x.code === "ศ11101" && x.classroom === "1"); // 80 ชม.
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  const r = await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [
    { term_number: 1, kind: "indicator", title: "งานปั้น", max_score: 70 },
    { term_number: 2, kind: "final", title: "สอบ", max_score: 30 },
  ] }, { expect: 200 });
  const [ind, fin] = r.data.items;
  const s = r.data.students.filter((x) => x.enrollment_status === "enrolled");
  const all = s.flatMap((st, k) => [{ item_id: ind.id, student_id: st.id, score: k === 0 ? 20 : 60 }, { item_id: fin.id, student_id: st.id, score: k === 0 ? 10 : 25 }]);
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: all }, { expect: 200 });
  let d = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(d.computed[s[0].id].grade, "0");
  // ชั่วโมง 63/80 (< 64) → มส
  d = (await call("t1", "PUT", `/api/courses/${c.id}/results`, { changes: [{ student_id: s[1].id, hours_attended: 63 }] }, { expect: 200 })).data;
  assert.equal(d.computed[s[1].id].grade, "มส");
  d = (await call("t1", "PUT", `/api/courses/${c.id}/results`, { changes: [{ student_id: s[1].id, hours_attended: 64 }] }, { expect: 200 })).data;
  assert.equal(d.computed[s[1].id].grade, "4");
  await call("t1", "PUT", `/api/courses/${c.id}/results`, { changes: [{ student_id: s[1].id, hours_attended: 81 }] }, { expect: 400 });
  // แก้ 0 → 2 ไม่ได้, → 1 ได้
  await call("t1", "PUT", `/api/courses/${c.id}/results`, { changes: [{ student_id: s[0].id, remedial_type: "remedial", remedial_grade: "2" }] }, { expect: 400 });
  // คนได้ 4 สอบแก้ตัวไม่ได้
  await call("t1", "PUT", `/api/courses/${c.id}/results`, { changes: [{ student_id: s[1].id, remedial_type: "remedial", remedial_grade: "1" }] }, { expect: 400 });
  d = (await call("t1", "PUT", `/api/courses/${c.id}/results`, { changes: [{ student_id: s[0].id, remedial_type: "remedial", remedial_grade: "1", remedial_date: "2027-03-20" }] }, { expect: 200 })).data;
  assert.equal(d.computed[s[0].id].original_grade, "0");
  assert.equal(d.computed[s[0].id].grade, "1");
  // ยืนยันผล → ล็อก
  await call("t1", "POST", `/api/courses/${c.id}/submit`, {}, { expect: 200 });
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: s[2].id, score: 1 }] }, { expect: 409 });
  await call("admin", "POST", `/api/admin/courses/${c.id}/lock`, { locked: false }, { expect: 200 });
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: s[2].id, score: 1 }] }, { expect: 200 });
});

test("ครูประจำชั้น: ประเมินคุณลักษณะ, บันทึกขาดเรียน, ปพ.6 และสรุป", async () => {
  const { call } = await setup();
  const { courses } = await prepareYear(call);
  await call("t1", "GET", "/api/homeroom?grade=ป.1&room=1", null, { expect: 403 });
  const imp = await call("admin", "POST", "/api/admin/homerooms/import", {}, { expect: 200 });
  assert.equal(imp.data.added, 1);
  const hr = (await call("t1", "GET", "/api/homeroom?grade=ป.1&room=1", null, { expect: 200 })).data;
  const sid = hr.students[0].id;
  await call("t1", "PUT", "/api/homeroom/assessments?grade=ป.1&room=1", { changes: [{ student_id: sid, item_key: "trait_1", value: "3" }, { student_id: sid, item_key: "act_scout", value: "ผ" }] }, { expect: 200 });
  await call("t1", "PUT", "/api/homeroom/assessments?grade=ป.1&room=1", { changes: [{ student_id: sid, item_key: "trait_1", value: "5" }] }, { expect: 400 });
  await call("t1", "PUT", "/api/homeroom/assessments?grade=ป.1&room=1", { changes: [{ student_id: sid, item_key: "hack", value: "1" }] }, { expect: 400 });
  // นักเรียนห้องอื่น
  await call("t1", "PUT", "/api/homeroom/assessments?grade=ป.1&room=1", { changes: [{ student_id: 25, item_key: "trait_1", value: "1" }] }, { expect: 400 });
  const ab = await call("t1", "POST", "/api/homeroom/absences?grade=ป.1&room=1", { student_id: sid, dates: ["2026-11-03", "2026-11-04"], reason: "unknown" }, { expect: 200 });
  assert.equal(ab.data.absences[sid].length, 2);
  const letter = (await call("t1", "GET", `/api/reports/absence?grade=ป.1&room=1&student=${sid}`, null, { expect: 200 })).data;
  assert.equal(letter.absences.length, 2);
  const room = (await call("t1", "GET", "/api/reports/room?grade=ป.1&room=1", null, { expect: 200 })).data;
  assert.equal(room.students.find((x) => x.id === sid).absent_days, 2);
  assert.equal(room.students[0].subjects.length, 9);
  await call("t2", "GET", "/api/reports/room?grade=ป.1&room=1", null, { expect: 403 });
  const sum = await call("admin", "GET", "/api/reports/summary", null, { expect: 200 });
  assert.ok(sum.data.subjects.length >= 18);
  await call("t1", "GET", "/api/reports/summary", null, { expect: 403 });
  const pp1 = await call("admin", "GET", `/api/reports/pp1?student=${sid}`, null, { expect: 200 });
  assert.equal(pp1.data.years.length, 1);
  assert.ok(courses.length);
});

test("คัดลอกโครงสร้างคะแนนจากห้องอื่น และลบวิชาที่มีคะแนนไม่ได้", async () => {
  const { call } = await setup();
  const { courses } = await prepareYear(call);
  const a = courses.find((x) => x.code === "ท11101" && x.classroom === "1");
  const b = courses.find((x) => x.code === "ท11101" && x.classroom === "2");
  await call("admin", "PUT", `/api/admin/courses/${a.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  await call("admin", "PUT", `/api/admin/courses/${b.id}/teachers`, { user_ids: [3] }, { expect: 200 });
  const r = await call("t1", "POST", `/api/courses/${a.id}/items`, { items: [{ term_number: 1, kind: "indicator", title: "อ่านออกเสียง", max_score: 10 }] }, { expect: 200 });
  const sib = (await call("t2", "GET", `/api/courses/${b.id}/siblings`, null, { expect: 200 })).data;
  assert.equal(sib.courses.length, 1);
  const copied = await call("t2", "POST", `/api/courses/${b.id}/copy-items`, { source_course_id: a.id }, { expect: 200 });
  assert.equal(copied.data.items.length, 1);
  // ป.1/2 มีคนที่ย้ายเข้ามา (id 7) อยู่ในรายชื่อ
  assert.ok(copied.data.students.some((s) => s.id === 7));
  await call("t1", "PUT", `/api/courses/${a.id}/scores`, { changes: [{ item_id: r.data.items[0].id, student_id: r.data.students[0].id, score: 8 }] }, { expect: 200 });
  await call("admin", "DELETE", `/api/admin/subjects/${a.subject_id}`, null, { expect: 409 });
});
