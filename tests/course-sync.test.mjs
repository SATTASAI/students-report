import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";

const ORIGIN = "http://school.test";
async function setup() {
  const env = await makeEnv();
  const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "admin@test.local", password: PASSWORD }) }), env);
  const cookie = r.headers.get("Set-Cookie").split(";")[0];
  const call = async (method, path, body) => {
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    const data = await res.json().catch(() => null);
    assert.ok(res.status < 300, `${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  return { env, call };
}

test("รายวิชาที่เพิ่มในหน้ารายวิชา ขึ้นในหน้าครูผู้สอนทุกห้องของชั้นทันที", async () => {
  const { call } = await setup();
  const { rooms } = await call("GET", "/api/admin/rooms?year=1");
  const p4 = rooms.filter((r) => r.grade_level === "ป.4");
  assert.ok(p4.length > 0);
  const { id } = await call("POST", "/api/admin/subjects", { year: 1, grade_level: "ป.4", code: "ส14299", name: "วิชาทดสอบลิงก์", learning_area: "สังคมศึกษา ศาสนาและวัฒนธรรม", subject_type: "additional", hours_per_year: 40, collect_ratio: 70, sort_order: 999 });
  const { courses } = await call("GET", "/api/admin/courses?year=1");
  const mine = courses.filter((c) => c.subject_id === id);
  assert.deepEqual(mine.map((c) => c.classroom).sort(), p4.map((r) => r.classroom).sort());
  const { subjects } = await call("GET", "/api/admin/subjects?year=1");
  assert.equal(subjects.find((s) => s.id === id).course_count, p4.length);
  // แก้ชื่อในหน้ารายวิชา → หน้าครูผู้สอนเห็นชื่อใหม่
  await call("PUT", `/api/admin/subjects/${id}`, { grade_level: "ป.4", code: "ส14299", name: "ชื่อใหม่", learning_area: "สังคมศึกษา ศาสนาและวัฒนธรรม", subject_type: "additional", hours_per_year: 40, collect_ratio: 70, sort_order: 999 });
  const after = (await call("GET", "/api/admin/courses?year=1")).courses.filter((c) => c.subject_id === id);
  assert.ok(after.every((c) => c.name === "ชื่อใหม่"));
  // ลบรายวิชา → หายจากหน้าครูผู้สอน
  await call("DELETE", `/api/admin/subjects/${id}`);
  assert.equal((await call("GET", "/api/admin/courses?year=1")).courses.filter((c) => c.subject_id === id).length, 0);
});

const AREA = "สังคมศึกษา ศาสนาและวัฒนธรรม";
const subj = (o) => ({ year: 1, grade_level: "ป.4", learning_area: AREA, subject_type: "basic", hours_per_year: 40, collect_ratio: 70, ...o });

test("ลำดับรายวิชา: เพิ่มใหม่ต่อท้าย, นำเข้าซ้ำไม่ย้ายลำดับเดิม, พื้นฐานก่อนเพิ่มเติมทุกหน้า", async () => {
  const { call } = await setup();
  await call("POST", "/api/admin/subjects/template", { grades: ["ป.4"] });
  // วิชาเพิ่มเติมเพิ่มก่อน แต่ต้องแสดงหลังวิชาพื้นฐานเสมอ
  await call("POST", "/api/admin/subjects", subj({ code: "ส14201", name: "หน้าที่พลเมือง", subject_type: "additional" }));
  const { id: lateId } = await call("POST", "/api/admin/subjects", subj({ code: "ส14103", name: "วิชาพื้นฐานที่เพิ่มทีหลัง" }));
  const list = (await call("GET", "/api/admin/subjects?year=1")).subjects.filter((s) => s.grade_level === "ป.4");
  assert.equal(list.at(-1).code, "ส14201", "เพิ่มเติมอยู่ท้าย");
  assert.equal(list.at(-2).id, lateId, "วิชาพื้นฐานที่เพิ่มใหม่ต่อท้ายวิชาพื้นฐานเดิม ไม่แทรกกลาง");
  const before = list.map((s) => s.code);
  // นำเข้าซ้ำแถวเดียว (ไม่มีคอลัมน์ลำดับ) ต้องไม่ย้ายวิชานั้นขึ้นไปบนสุด
  await call("POST", "/api/admin/import/subjects", { year: 1, rows: [{ grade_level: "ป.4", code: before[4], name: "แก้ชื่อ", learning_area: "สังคมศึกษา ศาสนาและวัฒนธรรม", subject_type: "พื้นฐาน", hours_per_year: "80" }] });
  const after = (await call("GET", "/api/admin/subjects?year=1")).subjects.filter((s) => s.grade_level === "ป.4").map((s) => s.code);
  assert.deepEqual(after, before);
  // หน้าครูผู้สอนใช้ลำดับเดียวกัน
  const courses = (await call("GET", "/api/admin/courses?year=1")).courses.filter((c) => c.grade_level === "ป.4" && c.classroom === "1").map((c) => c.code);
  assert.deepEqual(courses, before);
});

test("แก้รหัสวิชา → คะแนนยกมาตามไป · เปลี่ยนชั้นได้เมื่อยังไม่มีใครใช้", async () => {
  const { env, call } = await setup();
  const { id } = await call("POST", "/api/admin/subjects", subj({ code: "ส14299", name: "ทดสอบ" }));
  env.DB.raw.prepare("INSERT INTO gr_carryover (academic_year_id, student_id, subject_code, term_number, total) VALUES (1, 30, 'ส14299', 1, 40)").run();
  await call("PUT", `/api/admin/subjects/${id}`, subj({ code: "ส14300", name: "ทดสอบ" }));
  assert.equal(env.DB.raw.prepare("SELECT subject_code FROM gr_carryover WHERE student_id = 30").get().subject_code, "ส14300");
  // วิชาที่มีคะแนนยกมาลบไม่ได้
  const r = await worker.fetch(new Request(ORIGIN + `/api/admin/subjects/${id}`, { method: "DELETE", headers: { Origin: ORIGIN, Cookie: (await loginCookie(env)) } }), env);
  assert.equal(r.status, 409);
  // วิชาที่ยังไม่มีใครใช้ ย้ายชั้นได้ และห้องของชั้นใหม่ถูกสร้างให้
  const { id: id2 } = await call("POST", "/api/admin/subjects", subj({ code: "ส14555", name: "ผิดชั้น" }));
  await call("PUT", `/api/admin/subjects/${id2}`, subj({ grade_level: "ป.1", code: "ส11555", name: "ผิดชั้น" }));
  const rooms = (await call("GET", "/api/admin/courses?year=1")).courses.filter((c) => c.subject_id === id2).map((c) => `${c.grade_level}/${c.classroom}`).sort();
  assert.deepEqual(rooms, ["ป.1/1", "ป.1/2"]);
});

test("ช่องคะแนนเรียงตามหน่วยการเรียนรู้ทั้งหน้าโครงสร้าง หน้ากรอกคะแนน และ ปพ.5", async () => {
  const { call } = await setup();
  await call("POST", "/api/admin/subjects/template", { grades: ["ป.4"] });
  const course = (await call("GET", "/api/admin/courses?year=1")).courses.find((c) => c.grade_level === "ป.4");
  let d = await call("POST", `/api/courses/${course.id}/units`, { term_number: 1, unit_no: 2, title: "หน่วยสอง" });
  d = await call("POST", `/api/courses/${course.id}/units`, { term_number: 1, unit_no: 1, title: "หน่วยหนึ่ง" });
  const u = Object.fromEntries(d.units.map((x) => [x.unit_no, x.id]));
  await call("POST", `/api/courses/${course.id}/items`, { term_number: 1, kind: "final", title: "ปลายภาค", max_score: 15 });
  await call("POST", `/api/courses/${course.id}/items`, { term_number: 1, title: "ไม่สังกัดหน่วย", max_score: 5 });
  await call("POST", `/api/courses/${course.id}/items`, { term_number: 1, title: "ข้อของหน่วย 2", max_score: 10, unit_id: u[2] });
  d = await call("POST", `/api/courses/${course.id}/items`, { term_number: 1, title: "ข้อของหน่วย 1 (เพิ่มทีหลัง)", max_score: 20, unit_id: u[1] });
  assert.deepEqual(d.items.map((i) => i.title), ["ข้อของหน่วย 1 (เพิ่มทีหลัง)", "ข้อของหน่วย 2", "ไม่สังกัดหน่วย", "ปลายภาค"]);
});

test("ย้ายห้องหลังเปิดภาค: ได้เลขที่ต่อท้ายห้องใหม่ เลขที่ของคนเดิมไม่เลื่อน", async () => {
  const { env, call } = await setup();
  env.DB.raw.prepare("UPDATE academic_terms SET start_date = '2026-01-01' WHERE id = 2").run(); // ภาคที่มีรายชื่อเปิดแล้ว
  const room = async (r) => (await call("GET", `/api/roster?year=1&grade=ป.1&room=${r}`)).students;
  const before = await room("2");
  const mover = (await room("1")).find((s) => s.name.includes("เด็กชาย"));
  await call("PUT", `/api/roster/${mover.id}?year=1`, { grade_level: "ป.1", classroom: "2" });
  const after = await room("2");
  for (const s of before) assert.equal(after.find((x) => x.id === s.id).number, s.number, `${s.name} เลขที่ต้องไม่เลื่อน`);
  assert.equal(after.find((x) => x.id === mover.id).number, Math.max(...before.map((s) => s.number)) + 1);
  assert.equal(after.at(-1).id, mover.id);
});

test("นำเข้าครูประจำชั้นอนุบาลเขียนห้องได้หลายแบบ", async () => {
  const { normRoom } = await import("../src/routes/admin.js");
  assert.equal(normRoom("อ3/1"), "อ.3/1");
  assert.equal(normRoom("อนุบาล 3/1"), "อ.3/1");
  assert.equal(normRoom("ป 4/2"), "ป.4/2");
  assert.equal(normRoom("4/2"), "ป.4/2");
});

async function loginCookie(env) {
  const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "admin@test.local", password: PASSWORD }) }), env);
  return r.headers.get("Set-Cookie").split(";")[0];
}

test("ย้ายออกหลังเปิดภาค: เว้นเลขที่ไว้ เพื่อนไม่เลื่อน · ยกเลิก/รับกลับได้เลขเดิม · เรียงใหม่ทั้งห้องได้", async () => {
  const { env, call } = await setup();
  env.DB.raw.prepare("UPDATE academic_terms SET start_date = '2026-01-01' WHERE id = 2").run();
  const room = async () => (await call("GET", "/api/roster?year=1&grade=ป.4&room=1")).students;
  const before = await room();
  const leaver = before[3]; // เลขที่ 4
  const num = Object.fromEntries(before.map((s) => [s.id, s.number]));
  await call("POST", "/api/moves/out?year=1", { student_id: leaver.id, reason: "transfer" });
  let now = await room();
  // คนที่ออกแสดงท้ายห้องพร้อมเลขที่เดิม เพื่อนทุกคนเลขที่เดิม
  assert.equal(now.at(-1).id, leaver.id);
  assert.equal(now.at(-1).enrollment_status, "transferred");
  for (const s of now) assert.equal(s.number, num[s.id], `${s.name} ต้องได้เลขที่เดิม`);
  assert.equal(now.filter((s) => s.number === leaver.number).length, 1, "ไม่มีใครได้เลขที่ซ้ำกับคนที่ออก");
  // ย้ายห้องภายในโรงเรียน: ห้องเดิมเว้นเลขเช่นกัน
  const mover = now[5];
  await call("PUT", `/api/roster/${mover.id}?year=1`, { grade_level: "ป.1", classroom: "1" });
  now = await room();
  for (const s of now) assert.equal(s.number, num[s.id]);
  // หน้ากรอกคะแนน: คนที่ออกอยู่ท้ายรายชื่อ เลขที่เดิม และแก้คะแนนไม่ได้ (ข้ามโดยไม่ทำให้ทั้งชุดล้ม)
  await call("POST", "/api/admin/subjects/template", { grades: ["ป.4"] });
  const course = (await call("GET", "/api/admin/courses?year=1")).courses.find((c) => c.grade_level === "ป.4");
  const d = await call("POST", `/api/courses/${course.id}/items`, { term_number: 2, title: "ตัวชี้วัด", max_score: 10 });
  assert.equal(d.students.filter((s) => s.enrollment_status !== "moved").at(-1).id, leaver.id);
  assert.equal(d.students.find((s) => s.id === leaver.id).number, leaver.number);
  const itemId = d.items[0].id, friend = d.students[0].id;
  await call("PUT", `/api/courses/${course.id}/scores`, { changes: [{ item_id: itemId, student_id: friend, score: 8 }, { item_id: itemId, student_id: leaver.id, score: 9 }] });
  const after = await call("GET", `/api/courses/${course.id}`);
  assert.equal(after.scores[friend][itemId], 8);
  assert.equal(after.scores[leaver.id]?.[itemId], undefined);
  // ปพ.6 / ประจำชั้น: อยู่ท้ายห้อง เลขที่เดิม
  const rep = await call("GET", "/api/reports/room?year=1&grade=ป.4&room=1");
  assert.equal(rep.students.at(-1).id, leaver.id);
  const hr = await call("GET", "/api/homeroom?year=1&grade=ป.4&room=1");
  assert.equal(hr.students.at(-1).number, leaver.number);
  // ยกเลิกการย้ายออก → ได้เลขที่เดิม
  const { moves } = await call("GET", "/api/moves?year=1");
  await call("POST", `/api/moves/${moves.find((m) => m.student_id === leaver.id).id}/undo?year=1`, {});
  now = await room();
  assert.equal(now.find((s) => s.id === leaver.id).number, leaver.number);
  // ออกอีกครั้งแล้วรับกลับห้องเดิม → เลขที่เดิม
  await call("POST", "/api/moves/out?year=1", { student_id: leaver.id, reason: "dropout" });
  await call("POST", "/api/moves/in?year=1", { student_id: leaver.id, grade_level: "ป.4", classroom: "1" });
  assert.equal((await room()).find((s) => s.id === leaver.id).number, leaver.number);
  // เรียงใหม่ทั้งห้อง → เลขที่ต่อเนื่อง 1..n ไม่มีช่องว่าง
  await call("POST", "/api/roster/renumber?year=1", { grade_level: "ป.4", classroom: "1" });
  now = await room();
  assert.deepEqual(now.map((s) => s.number), now.map((_, i) => i + 1));
});

test("ย้ายออกก่อนเปิดภาค: เรียงเลขที่ใหม่ตามปกติ", async () => {
  const { env, call } = await setup();
  env.DB.raw.prepare("UPDATE academic_terms SET start_date = '2099-01-01' WHERE id = 2").run();
  const room = async () => (await call("GET", "/api/roster?year=1&grade=ป.4&room=1")).students;
  const before = await room();
  await call("POST", "/api/moves/out?year=1", { student_id: before[0].id, reason: "transfer" });
  const now = await room();
  assert.deepEqual(now.map((s) => s.number), now.map((_, i) => i + 1));
});
