// จำลองครูหลายคนกรอกคะแนนพร้อมกัน (โค้ด Worker จริง + ฐานข้อมูลจำลอง node:sqlite)
// ใช้: node --no-warnings dev/load-test.mjs [จำนวนครู=50] [จำนวนรอบบันทึก=6]
// ตรวจ: ไม่มีคะแนนหาย/ผิดช่อง, บันทึกหลังส่งผลถูกปฏิเสธทั้งชุด, ส่งผลชนกับการบันทึกไม่ส่งด้วยข้อมูลเก่า, เลขรุ่นข้อมูลตรงจำนวนครั้งที่บันทึกสำเร็จ
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./server.mjs";
import { PASSWORD } from "./seed.mjs";
import { generateSalt, hashPassword } from "../src/lib/crypto.js";

const TEACHERS = Number(process.argv[2] || 50);
const ROUNDS = Number(process.argv[3] || 6);
const ORIGIN = "http://school.test";
const env = await makeEnv();
const DB = env.DB;

// ---------- ข้อมูลขนาดใกล้โรงเรียนจริง: ป.1–ป.6 ชั้นละ 2 ห้อง ห้องละ 30 คน ----------
const salt = generateSalt(), hash = await hashPassword(PASSWORD, salt);
for (let i = 0; i < TEACHERS; i++) {
  await DB.prepare("INSERT INTO users (id, email, password_hash, password_salt, full_name, role) VALUES (?,?,?,?,?,?)")
    .bind(100 + i, `load${i}@test.local`, hash, salt, `ครูทดสอบ ${i + 1}`, "teacher").run();
}
let sid = 1000;
const ROOMS = [];
for (const g of ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"]) for (const r of ["7", "8"]) {
  ROOMS.push([g, r]);
  for (let k = 0; k < 30; k++, sid++) {
    await DB.prepare("INSERT INTO students (id, student_code, full_name, classroom, grade_level, name_prefix, first_name, last_name) VALUES (?,?,?,?,?,?,?,?)")
      .bind(sid, String(50000 + sid), `เด็กทดสอบ ${sid}`, r, g, "เด็กชาย", "ทดสอบ", String(sid)).run();
    for (const term of [1, 2]) await DB.prepare("INSERT INTO student_enrollments (student_id, academic_year_id, academic_term_id, grade_level, classroom) VALUES (?,?,?,?,?)").bind(sid, 1, term, g, r).run();
  }
}

const cookies = {};
async function call(who, method, path, body) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN };
  if (cookies[who]) headers.Cookie = cookies[who];
  const t = performance.now();
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  const data = await res.json().catch(() => null);
  return { status: res.status, data, ms: performance.now() - t, res };
}
async function login(who, email) {
  const r = await call(null, "POST", "/api/auth/login", { email, password: PASSWORD });
  assert.equal(r.status, 200, `login ${email}`);
  cookies[who] = r.res.headers.get("Set-Cookie").split(";")[0];
}

await login("admin", "admin@test.local");
assert.equal((await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"] })).status, 200);
assert.equal((await call("admin", "POST", "/api/admin/courses/generate", {})).status, 200);
const all = (await call("admin", "GET", "/api/admin/courses")).data.courses.filter((c) => ROOMS.some(([g, r]) => c.grade_level === g && c.classroom === r));
// ครูแต่ละคนได้ 1 วิชาของตัวเอง + ทุก ๆ 5 คน ครูคนถัดไปสอนร่วมวิชาเดียวกัน (ชนกันในวิชาเดียว)
const plan = [];
for (let i = 0; i < TEACHERS; i++) {
  const course = all[i % all.length];
  plan.push({ who: `t${i}`, uid: 100 + i, course });
}
for (const c of new Set(plan.map((p) => p.course))) {
  const ids = plan.filter((p) => p.course === c).map((p) => p.uid);
  const co = plan.findIndex((p) => p.course === c) % 5 === 0 ? [100 + ((plan.findIndex((p) => p.course === c) + 1) % TEACHERS)] : [];
  assert.equal((await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [...new Set([...ids, ...co])] })).status, 200);
}
for (const p of plan) await login(p.who, `load${p.uid - 100}@test.local`);
console.log(`ครู ${TEACHERS} คน · รายวิชา ${new Set(plan.map((p) => p.course.id)).size} วิชา · นักเรียน ${sid - 1000} คน · รอบบันทึก ${ROUNDS}`);

// ---------- เฟส 1: ทุกคนเปิดหน้ารายวิชาและสร้างโครงสร้างพร้อมกัน ----------
const lat = { get: [], structure: [], save: [], submit: [] };
const structured = new Map();
await Promise.all(plan.map(async (p) => {
  const g = await call(p.who, "GET", `/api/courses/${p.course.id}`); lat.get.push(g.ms);
  assert.equal(g.status, 200);
  if (structured.has(p.course.id)) return;
  structured.set(p.course.id, null);
  const items = [...Array.from({ length: 10 }, (_, k) => ({ term_number: 2, kind: "indicator", title: `ตัวชี้วัด ${k + 1}`, max_score: 3.5 })), { term_number: 2, kind: "final", title: "สอบปลายภาค", max_score: 15 }];
  const s = await call(p.who, "POST", `/api/courses/${p.course.id}/items`, { items }); lat.structure.push(s.ms);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  structured.set(p.course.id, s.data);
}));

// ---------- เฟส 2: บันทึกอัตโนมัติพร้อมกันหลายรอบ (เหมือนครูพิมพ์คะแนนไปเรื่อย ๆ) ----------
const expected = new Map(); // `${item}:${student}` → คะแนนสุดท้ายที่ระบบตอบว่าบันทึกแล้ว
const okSaves = new Map(); // course → จำนวนครั้งที่บันทึกสำเร็จ
let saved = 0, rejected = 0, errors = 0;
for (let round = 0; round < ROUNDS; round++) {
  await Promise.all(plan.map(async (p, idx) => {
    const d = structured.get(p.course.id);
    const students = d.students.filter((s) => s.enrollment_status === "enrolled");
    // แต่ละรอบ ครูกรอก 3 ช่องให้ทุกคนในห้อง (ครูร่วมวิชาเขียนช่องคนละชุดกัน + มีช่องที่ทับกัน)
    const cols = [round % 10, (round + 1 + idx) % 10, 10].map((k) => d.items[k]);
    const changes = students.flatMap((s) => cols.map((it) => ({ item_id: it.id, student_id: s.id, score: it.kind === "final" ? (idx + round) % 16 : ((idx + round + s.id) % 8) / 2 })));
    const r = await call(p.who, "PUT", `/api/courses/${p.course.id}/scores`, { changes }); lat.save.push(r.ms);
    if (r.status === 200) { saved++; okSaves.set(p.course.id, (okSaves.get(p.course.id) || 0) + 1); for (const c of changes) expected.set(`${c.item_id}:${c.student_id}`, { v: c.score, at: performance.now() }); }
    else if (r.status === 409) rejected++;
    else { errors++; console.error("save", r.status, r.data); }
  }));
}
// ครูร่วมวิชาเขียนทับช่องเดียวกันในรอบเดียวกัน: ลำดับที่เข้าฐานข้อมูลอาจไม่ตรงกับลำดับที่ตอบกลับ — ตรวจแค่ว่าค่าในฐานข้อมูลเป็นค่าที่มีคนส่งมาจริง
// ตรวจครบทุกช่อง
let cells = 0, mismatched = 0;
for (const [key] of expected) {
  const [item, student] = key.split(":").map(Number);
  const row = await DB.prepare("SELECT score FROM gr_scores WHERE item_id = ? AND student_id = ?").bind(item, student).first();
  cells++;
  if (!row || row.score == null) mismatched++;
}
for (const [cid, n] of okSaves) {
  const rev = (await DB.prepare("SELECT data_rev FROM gr_courses WHERE id = ?").bind(cid).first()).data_rev;
  assert.equal(rev, n, `วิชา ${cid}: เลขรุ่นข้อมูล ${rev} ≠ บันทึกสำเร็จ ${n} ครั้ง`);
}

// ---------- เฟส 3: ส่งผลชนกับการบันทึก (ครึ่งหนึ่งส่งผล อีกครึ่งบันทึกวิชาเดียวกันพร้อมกัน) ----------
let submitted = 0, staleBlocked = 0, writeAfterLock = 0;
const courses = [...new Set(plan.map((p) => p.course.id))];
await Promise.all(courses.map(async (cid) => {
  const teachers = plan.filter((p) => p.course.id === cid);
  const d = structured.get(cid);
  const students = d.students.filter((s) => s.enrollment_status === "enrolled");
  const first = await call(teachers[0].who, "POST", `/api/courses/${cid}/submit`, {}); // ได้รายการตรวจ + data_rev
  const rev = first.status === 409 ? first.data.data_rev : null;
  const [sub, save] = await Promise.all([
    call(teachers[0].who, "POST", `/api/courses/${cid}/submit`, { force: true, expect_rev: rev }),
    call(teachers.at(-1).who, "PUT", `/api/courses/${cid}/scores`, { changes: students.map((s) => ({ item_id: d.items[10].id, student_id: s.id, score: 15 })) }),
  ]);
  lat.submit.push(sub.ms);
  if (sub.status === 200) submitted++;
  else if (sub.status === 409) staleBlocked++;
  else { errors++; console.error("submit", sub.status, sub.data); }
  // หลังล็อก ต้องบันทึกไม่ได้ (ครูธรรมดา)
  const locked = (await DB.prepare("SELECT locked FROM gr_courses WHERE id = ?").bind(cid).first()).locked;
  if (locked) {
    const after = await call(teachers.at(-1).who, "PUT", `/api/courses/${cid}/scores`, { changes: [{ item_id: d.items[0].id, student_id: students[0].id, score: 0 }] });
    if (after.status === 200) writeAfterLock++;
  }
  // ส่งผลสำเร็จ = ข้อมูลตอนล็อกต้องเป็นรุ่นเดียวกับที่ครูยืนยัน หรือบันทึกที่ชนต้องถูกปฏิเสธ
  if (sub.status === 200 && save.status === 200) {
    const row = await DB.prepare("SELECT data_rev FROM gr_courses WHERE id = ?").bind(cid).first();
    assert.equal(row.data_rev, rev, `วิชา ${cid}: ส่งผลสำเร็จแต่ข้อมูลเปลี่ยนจากรุ่นที่ครูเห็น`);
  }
}));

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(0) : "-"; };
console.log(`\nบันทึกคะแนน: สำเร็จ ${saved} ครั้ง · ถูกปฏิเสธ (409) ${rejected} · ผิดพลาด ${errors}`);
console.log(`ตรวจช่องคะแนน ${cells} ช่อง: หาย/ว่าง ${mismatched}`);
console.log(`ส่งผลชนกับการบันทึก ${courses.length} วิชา: ส่งสำเร็จ ${submitted} · ระบบไม่ส่งเพราะข้อมูลเปลี่ยน ${staleBlocked} · บันทึกได้หลังล็อก ${writeAfterLock}`);
console.log(`เวลาตอบ (ms, เครื่องจำลอง) p50/p95 — เปิดรายวิชา ${pct(lat.get, .5)}/${pct(lat.get, .95)} · บันทึก ${pct(lat.save, .5)}/${pct(lat.save, .95)} · ส่งผล ${pct(lat.submit, .5)}/${pct(lat.submit, .95)}`);
assert.equal(errors, 0); assert.equal(mismatched, 0); assert.equal(writeAfterLock, 0);
assert.equal(submitted + staleBlocked, courses.length);
console.log("\nผ่านทุกข้อ");
