// ข้อมูลที่ใช้ร่วมกับระบบทะเบียน: แก้ที่ระบบเกรดที่เดียว แล้วสะท้อนไปตารางของระบบทะเบียน · superadmin ดึงข้อมูลเดิมจากระบบทะเบียนได้
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
    return { status: res.status, data };
  }
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"], ["t2", "teacher2@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie").split(";")[0];
  }
  return { env, call, raw: env.DB.raw };
}

test("ครูประจำชั้นและน้ำหนักส่วนสูงที่แก้ในระบบเกรด สะท้อนไปตารางของระบบทะเบียน", async () => {
  const { call, raw } = await setup();
  await call("admin", "PUT", "/api/admin/homerooms", { grade_level: "ป.4", classroom: "1", user_ids: [2] }, { expect: 200 });
  const rows = raw.prepare("SELECT academic_term_id, teacher_user_id FROM learner_class_assignments WHERE grade_level = 'ป.4' AND classroom = '1' ORDER BY academic_term_id").all();
  assert.deepEqual(rows.map((r) => [r.academic_term_id, r.teacher_user_id]), [[1, 2], [2, 2]]);
  await call("admin", "PUT", "/api/admin/homerooms", { grade_level: "ป.4", classroom: "1", user_ids: [3] }, { expect: 200 });
  assert.deepEqual(raw.prepare("SELECT DISTINCT teacher_user_id AS u FROM learner_class_assignments WHERE grade_level = 'ป.4' AND classroom = '1'").all().map((r) => r.u), [3]);
  // น้ำหนักส่วนสูงครั้งล่าสุด → student_details
  await call("admin", "PUT", "/api/admin/homerooms", { grade_level: "ป.4", classroom: "1", user_ids: [2] }, { expect: 200 });
  const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;
  const sid = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students[0].id;
  await call("t1", "PUT", `/api/homeroom/body?${Q}`, { changes: [{ student_id: sid, round: 1, weight: 30, height: 130 }, { student_id: sid, round: 2, weight: 31.5, height: 132 }] }, { expect: 200 });
  const d = raw.prepare("SELECT weight_kg, height_cm FROM student_details WHERE student_id = ?").get(sid);
  assert.deepEqual([d.weight_kg, d.height_cm], [31.5, 132]);
});

test("ดึงข้อมูลจากระบบทะเบียน: เฉพาะ superadmin · ครูประจำชั้นแทนที่ทั้งปี · น้ำหนักส่วนสูงเติมเฉพาะคนที่ยังไม่มี", async () => {
  const { call, raw } = await setup();
  raw.prepare("INSERT INTO gr_staff_roles (user_id, role) VALUES (2, 'grade_admin')").run();
  await call("t1", "GET", "/api/admin/sync", null, { expect: 403 }); // ทีมวัดผลไม่ใช่ superadmin
  raw.prepare("INSERT INTO learner_class_assignments (academic_term_id, grade_level, classroom, teacher_user_id, assigned_by) VALUES (2, 'ป.4', '1', 3, 1)").run();
  raw.prepare("UPDATE student_details SET weight_kg = 25, height_cm = 120 WHERE student_id IN (SELECT student_id FROM student_enrollments WHERE grade_level = 'ป.4')").run();
  const pre = (await call("admin", "GET", "/api/admin/sync", null, { expect: 200 })).data;
  assert.ok(pre.homerooms.registry >= 1);
  assert.equal(pre.body.fill, 14);
  await call("admin", "POST", "/api/admin/sync", { what: "homerooms" }, { expect: 200 });
  const hr = (await call("admin", "GET", "/api/admin/homerooms", null, { expect: 200 })).data.rooms.find((r) => r.grade_level === "ป.4");
  assert.deepEqual(hr.teachers.map((t) => t.id), [3]);
  assert.equal((await call("admin", "POST", "/api/admin/sync", { what: "body" }, { expect: 200 })).data.rows, 14);
  assert.equal((await call("admin", "GET", "/api/admin/sync", null, { expect: 200 })).data.body.fill, 0);
});

test("นักเรียน: นำเข้ารายชื่อจาก Excel (เพิ่มใหม่/ปรับ/รับกลับ) และแก้เลขประจำตัวประชาชน วันเกิด ในระบบเกรด", async () => {
  const { call, raw } = await setup();
  const existing = raw.prepare("SELECT student_code, national_id FROM students WHERE id = 1").get();
  const rows = [
    { student_code: "30001", name_prefix: "เด็กหญิง", first_name: "ใหม่", last_name: "อนุบาล", gender: "ญ", national_id: "1999999999991", birth_date: "2022-05-01", room: "อ.3/1" },
    { student_code: existing.student_code, name_prefix: "เด็กชาย", first_name: "แก้ชื่อ", last_name: "ทดสอบ" },
    { student_code: "30002", first_name: "ซ้ำ", last_name: "บัตร", national_id: existing.national_id, room: "ป.1/1" },
    { student_code: "30003", first_name: "ไม่มี", last_name: "ห้อง" },
  ];
  const dry = (await call("admin", "POST", "/api/roster/import", { rows, dry_run: true }, { expect: 200 })).data;
  assert.equal(dry.ok, false);
  assert.deepEqual(dry.errors.map((e) => e.row), [4]); // คนใหม่ไม่มีห้อง
  // แถว 2 (เลขประจำตัวตรงแต่ชื่อต่าง) และแถว 3 (เลขบัตรเป็นของคนอื่น) ไม่จับคู่จากช่องเดียว → รอผู้ดูแลตรวจ
  assert.deepEqual(dry.review.map((r) => r.row), [2, 3]);
  assert.deepEqual(dry.review[0].candidates[0].conflicts, ["name"]);
  await call("t1", "POST", "/api/roster/import", { rows: rows.slice(0, 2) }, { expect: 403 });
  const ok = (await call("admin", "POST", "/api/roster/import", { rows: rows.slice(0, 2) }, { expect: 200 })).data;
  assert.deepEqual(ok.summary, { add: 1, update: 0, review: 1 });
  const kids = (await call("admin", "GET", `/api/roster?grade=${encodeURIComponent("อ.3")}&room=1`, null, { expect: 200 })).data.students;
  const k = kids.find((x) => x.student_code === "30001");
  assert.equal(k.gender, "ญ");
  assert.equal(k.birth_date, "2022-05-01");
  assert.notEqual(raw.prepare("SELECT first_name FROM students WHERE id = 1").get().first_name, "แก้ชื่อ"); // ยังไม่แก้จนกว่าผู้ดูแลยืนยัน
  const pending = (await call("admin", "GET", "/api/roster/reviews", null, { expect: 200 })).data.reviews;
  assert.equal(pending.length, 1);
  await call("admin", "POST", `/api/roster/reviews/${pending[0].id}`, { action: "match", student_id: 1 }, { expect: 200 });
  assert.equal(raw.prepare("SELECT first_name FROM students WHERE id = 1").get().first_name, "แก้ชื่อ");
  assert.equal((await call("admin", "GET", "/api/roster/reviews", null, { expect: 200 })).data.reviews.length, 0);
  // แก้เลขบัตร/วันเกิดทีละคน — ห้ามเลขบัตรซ้ำ
  await call("admin", "PUT", `/api/roster/${k.id}`, { national_id: existing.national_id }, { expect: 409 });
  await call("admin", "PUT", `/api/roster/${k.id}`, { national_id: "123" }, { expect: 400 });
  await call("admin", "PUT", `/api/roster/${k.id}`, { national_id: "1-9999-99999-99-2", birth_date: "2022-06-02" }, { expect: 200 });
  const st = raw.prepare("SELECT national_id, birth_date FROM students WHERE id = ?").get(k.id);
  assert.deepEqual([st.national_id, st.birth_date], ["1999999999992", "2022-06-02"]);
});

test("นำเข้า DMC: ตรวจหลายช่อง — ตรง ≥3 ช่องไม่ขัดกันจึงจับคู่อัตโนมัติ นอกนั้นแจ้งผู้ดูแลตรวจ", async () => {
  const { call, raw } = await setup();
  const s = raw.prepare("SELECT s.*, d.gender FROM students s JOIN student_details d ON d.student_id = s.id WHERE s.id = 20").get();
  const base = { student_code: s.student_code, name_prefix: s.name_prefix, first_name: s.first_name, last_name: s.last_name, national_id: s.national_id, birth_date: s.birth_date, gender: s.gender };
  const rows = [
    { ...base, room: `${s.grade_level}/${s.classroom}` },                                    // ตรงทุกช่อง → คนเดิม
    { ...base, student_code: "99999", national_id: "", birth_date: "", gender: "", room: "" },  // ชื่อตรงอย่างเดียว → ตรวจ
  ];
  const dry = (await call("admin", "POST", "/api/roster/import", { rows, dry_run: true }, { expect: 200 })).data;
  assert.deepEqual(dry.summary, { add: 0, update: 1, review: 1 });
  const c = dry.review[0].candidates.find((x) => x.id === 20);
  assert.deepEqual(c.matched, ["name", "gender"]); assert.deepEqual(c.conflicts, ["code"]); // เพศจากคำนำหน้า
  // วันเกิดไม่ตรง = ขัดกัน แม้ช่องอื่นตรง
  const bad = (await call("admin", "POST", "/api/roster/import", { rows: [{ ...base, birth_date: "2018-01-01" }], dry_run: true }, { expect: 200 })).data;
  assert.equal(bad.summary.review, 1);
  assert.ok(bad.review[0].candidates[0].conflicts.includes("birth"));
  // บันทึก → รายการรอตรวจ · ยืนยันเป็นคนใหม่ไม่ได้ถ้าเลขซ้ำ · ไม่นำเข้าได้
  await call("admin", "POST", "/api/roster/import", { rows: [{ ...base, birth_date: "2018-01-01" }] }, { expect: 200 });
  const [r] = (await call("admin", "GET", "/api/roster/reviews", null, { expect: 200 })).data.reviews;
  await call("admin", "POST", `/api/roster/reviews/${r.id}`, { action: "create" }, { expect: 409 });
  await call("t1", "POST", `/api/roster/reviews/${r.id}`, { action: "dismiss" }, { expect: 403 });
  await call("admin", "POST", `/api/roster/reviews/${r.id}`, { action: "dismiss" }, { expect: 200 });
  assert.equal(raw.prepare("SELECT birth_date FROM students WHERE id = 20").get().birth_date, s.birth_date);
  // นำเข้าซ้ำ แถวเดิม → แทนที่รายการรอตรวจเดิม ไม่ซ้อน
  await call("admin", "POST", "/api/roster/import", { rows: [rows[1]] }, { expect: 200 });
  await call("admin", "POST", "/api/roster/import", { rows: [rows[1]] }, { expect: 200 });
  assert.equal((await call("admin", "GET", "/api/roster/reviews", null, { expect: 200 })).data.reviews.length, 1);
});
