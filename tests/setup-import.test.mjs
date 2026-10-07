import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { parseGrid, gridToRows } from "../public/js/paste.js";
import { computeStudentResult, indicatorResult } from "../public/js/grading.js";
import { SCHEMA_VERSION } from "../src/lib/schema.js";

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
  return { env, call };
}

test("วางตารางจาก Excel: Tab, CSV มีเครื่องหมายคำพูด, มี/ไม่มีหัวตาราง", () => {
  const tsv = "ห้อง\tรหัสวิชา\tชื่อวิชา\tครูผู้สอน\nป.4/1\tท14101\tภาษาไทย\tครูสมใจ ใจดี, ครูมานะ ขยันสอน\n\n";
  const a = gridToRows("teachers", parseGrid(tsv));
  assert.equal(a.header, true);
  assert.deepEqual(a.rows, [{ room: "ป.4/1", code: "ท14101", name: "ภาษาไทย", teachers: "ครูสมใจ ใจดี, ครูมานะ ขยันสอน" }]);
  const csv = 'ป.4/1,ค14101,"ครูสมใจ ใจดี, ครูมานะ ขยันสอน"';
  const b = gridToRows("teachers", parseGrid(csv));
  assert.equal(b.header, false);
  assert.equal(b.rows[0].teachers, "ครูสมใจ ใจดี, ครูมานะ ขยันสอน");
  assert.equal(b.rows[0].code, "ค14101");
  // หัวตารางสลับคอลัมน์ก็จับตามชื่อหัว
  const c = gridToRows("homerooms", parseGrid("ครูประจำชั้น\tห้อง\nครูสมใจ ใจดี\tป.4/1"));
  assert.deepEqual(c.rows, [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }]);
});

test("อัปเกรดตารางจาก gr-1 เป็น gr-2 โดยข้อมูลเดิมไม่หาย", async () => {
  const { env, call } = await setup();
  await call("admin", "GET", "/api/admin/settings", null, { expect: 200 });
  // จำลองฐานข้อมูลรุ่นเก่า: ตาราง settings ไม่มีคอลัมน์ใหม่
  env.DB.exec(`DROP TABLE gr_settings; CREATE TABLE gr_settings (academic_year_id INTEGER PRIMARY KEY, collect_ratio INTEGER NOT NULL DEFAULT 70,
    indicator_pass_pct INTEGER NOT NULL DEFAULT 50, attendance_pass_pct INTEGER NOT NULL DEFAULT 80, school_name TEXT, school_area TEXT, director_name TEXT,
    academic_head_name TEXT, measurement_head_name TEXT, entry_open INTEGER NOT NULL DEFAULT 1, roster_order TEXT NOT NULL DEFAULT 'gender', updated_by INTEGER, updated_at TEXT);
    INSERT INTO gr_settings (academic_year_id, indicator_pass_pct, director_name) VALUES (1, 60, 'ผอ.เดิม');
    UPDATE system_settings SET setting_value = 'gr-1' WHERE setting_key = 'students_report_schema';`);
  const { ensureSchema } = await import("../src/lib/schema.js");
  const fresh = { ...env }; // env ใหม่ = Worker เริ่มทำงานใหม่หลัง deploy
  fresh.DB = Object.create(env.DB);
  await ensureSchema(fresh);
  const cols = env.DB.raw.prepare("SELECT name FROM pragma_table_info('gr_settings')").all().map((r) => r.name);
  for (const c of ["indicator_pass_pct_t2", "deputy_director_name", "affiliation", "pilot_rooms"]) assert.ok(cols.includes(c), c);
  const row = env.DB.raw.prepare("SELECT indicator_pass_pct, director_name FROM gr_settings").get();
  assert.equal(row.indicator_pass_pct, 60);
  assert.equal(row.director_name, "ผอ.เดิม");
  assert.equal(env.DB.raw.prepare("SELECT setting_value v FROM system_settings WHERE setting_key='students_report_schema'").get().v, SCHEMA_VERSION);
  // เรียกซ้ำ (Worker อีกตัว) ต้องไม่พังและไม่เพิ่มคอลัมน์ซ้ำ
  env.DB.exec("UPDATE system_settings SET setting_value = 'gr-1' WHERE setting_key = 'students_report_schema'");
  await ensureSchema({ DB: Object.create(env.DB) });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM pragma_table_info('gr_settings') WHERE name = 'pilot_rooms'").get().n, 1);
});

test("เกณฑ์ผ่านตัวชี้วัดแยกภาค และบันทึกผู้ลงนาม", async () => {
  const { call } = await setup();
  const base = (await call("admin", "GET", "/api/admin/settings", null, { expect: 200 })).data.settings;
  const body = { ...base, indicator_pass_pct: 50, indicator_pass_pct_t2: 60, deputy_director_name: "นางสาววริศรา นวมนิ่ม", affiliation: "สพฐ." };
  await call("admin", "PUT", "/api/admin/settings", { ...body, indicator_pass_pct_t2: 101 }, { expect: 400 });
  await call("t1", "PUT", "/api/admin/settings", body, { expect: 403 });
  const s = (await call("admin", "PUT", "/api/admin/settings", body, { expect: 200 })).data.settings;
  assert.equal(s.indicator_pass_pct_t2, 60);
  assert.equal(s.deputy_director_name, "นางสาววริศรา นวมนิ่ม");
  // ล้างเกณฑ์ภาค 2 = ใช้ค่าภาค 1
  const s2 = (await call("admin", "PUT", "/api/admin/settings", { ...body, indicator_pass_pct_t2: "" }, { expect: 200 })).data.settings;
  assert.equal(s2.indicator_pass_pct_t2, null);
  // กติกา: 5/10 = 50% ภาค 1 ผ่าน, ภาค 2 (เกณฑ์ 60) ไม่ผ่าน
  const set = { indicator_pass_pct: 50, indicator_pass_pct_t2: 60 };
  assert.equal(indicatorResult({ max_score: 10, term_number: 1 }, 5, set), "ผ");
  assert.equal(indicatorResult({ max_score: 10, term_number: 2 }, 5, set), "มผ");
  assert.equal(indicatorResult({ max_score: 10, term_number: 2 }, 6, set), "ผ");
  assert.equal(indicatorResult({ max_score: 2.5, term_number: 2 }, 1.5, set), "ผ");
});

test("ห้องนำร่อง: สร้างรายวิชาเฉพาะห้องที่เลือก", async () => {
  const { call } = await setup();
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.1", "ป.4"] }, { expect: 200 });
  await call("admin", "PUT", "/api/admin/pilot", { rooms: ["ป.9/9"] }, { expect: 400 });
  await call("t1", "PUT", "/api/admin/pilot", { rooms: ["ป.4/1"] }, { expect: 403 });
  const p = await call("admin", "PUT", "/api/admin/pilot", { rooms: ["ป.4/1"] }, { expect: 200 });
  assert.deepEqual(p.data.pilot_rooms, ["ป.4/1"]);
  const gen = await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  assert.equal(gen.data.created, 9);
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  assert.ok(courses.every((c) => c.grade_level === "ป.4" && c.classroom === "1"));
  // ยกเลิกนำร่อง → เติมห้องที่เหลือ
  await call("admin", "PUT", "/api/admin/pilot", { rooms: [] }, { expect: 200 });
  assert.equal((await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 })).data.created, 18);
});

test("นำเข้ารายวิชา ครูผู้สอน และครูประจำชั้นจาก Excel", async () => {
  const { call } = await setup();
  const subjects = [
    { grade_level: "ป.4", code: "ท14101", name: "ภาษาไทย", learning_area: "ภาษาไทย", subject_type: "พื้นฐาน", hours_per_year: "160", collect_ratio: "" },
    { grade_level: "ป.4", code: "ค14101", name: "คณิตศาสตร์", learning_area: "คณิตศาสตร์", subject_type: "พื้นฐาน", hours_per_year: "160", collect_ratio: "70" },
    // ป.1 หลักสูตรใหม่: กลุ่มที่ไม่อยู่ในรายการแกนกลาง
    { grade_level: "ป.1", code: "ส11201", name: "หนูน้อยพอเพียง", learning_area: "สังคมแห่งการเรียนรู้", subject_type: "เพิ่มเติม", hours_per_year: "40", collect_ratio: "" },
  ];
  const bad = await call("admin", "POST", "/api/admin/import/subjects", { rows: [...subjects, { ...subjects[0] }, { grade_level: "ม.1", code: "x", name: "x", learning_area: "x", hours_per_year: "abc" }] }, { expect: 200 });
  assert.equal(bad.data.ok, false);
  assert.deepEqual(bad.data.errors.map((e) => e.row), [4, 5]);
  // ไฟล์มีแถวผิด → ไม่บันทึกแม้ไม่ได้ส่ง dry_run
  await call("admin", "POST", "/api/admin/import/subjects", { rows: [...subjects, { ...subjects[0] }] }, { expect: 200 });
  assert.equal((await call("admin", "GET", "/api/admin/subjects", null, { expect: 200 })).data.subjects.length, 0);
  const dry = await call("admin", "POST", "/api/admin/import/subjects", { rows: subjects, dry_run: true }, { expect: 200 });
  assert.deepEqual(dry.data.summary, { add: 3, update: 0 });
  await call("admin", "POST", "/api/admin/import/subjects", { rows: subjects }, { expect: 200 });
  // นำเข้าซ้ำ = แก้ของเดิม
  const again = await call("admin", "POST", "/api/admin/import/subjects", { rows: [{ ...subjects[0], hours_per_year: "200" }], dry_run: true }, { expect: 200 });
  assert.deepEqual(again.data.summary, { add: 0, update: 1 });
  await call("admin", "POST", "/api/admin/import/subjects", { rows: [{ ...subjects[0], hours_per_year: "200" }] }, { expect: 200 });
  const list = (await call("admin", "GET", "/api/admin/subjects", null, { expect: 200 })).data.subjects;
  assert.equal(list.length, 3);
  assert.equal(list.find((x) => x.code === "ท14101").hours_per_year, 200);
  assert.equal(list.find((x) => x.code === "ส11201").subject_type, "additional");

  // ครูผู้สอน: ชื่อมีคำนำหน้า/ช่องว่างต่างกันได้, ใช้อีเมลได้, สร้างรายวิชาของห้องให้เอง
  const t = await call("admin", "POST", "/api/admin/import/teachers", { rows: [
    { room: "ป.4/1", code: "ท14101", teachers: "นางครูสมใจ  ใจดี" },
    { room: "ป 4/1", code: "ค14101", teachers: "teacher2@test.local, ครูสมใจ ใจดี" },
    { room: "ป.4/9", code: "ท14101", teachers: "ครูสมใจ ใจดี" },
    { room: "ป.4/1", code: "ว14101", teachers: "ครูสมใจ ใจดี" },
    { room: "ป.4/1", code: "ท14101", teachers: "ครูไม่มี ในระบบ" },
  ], dry_run: true }, { expect: 200 });
  assert.deepEqual(t.data.errors.map((e) => e.row), [3, 4, 5]);
  assert.ok(t.data.errors[2].error.includes("ไม่พบบัญชีครู"));
  await call("admin", "POST", "/api/admin/import/teachers", { rows: [
    { room: "ป.4/1", code: "ท14101", teachers: "นางครูสมใจ  ใจดี" },
    { room: "ป 4/1", code: "ค14101", teachers: "teacher2@test.local, ครูสมใจ ใจดี" },
  ] }, { expect: 200 });
  const courses = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data.courses;
  assert.equal(courses.length, 2);
  assert.deepEqual(courses.find((c) => c.code === "ค14101").teachers.map((x) => x.id).sort(), [2, 3]);
  // ครูเห็นเฉพาะวิชาที่ได้รับมอบหมาย
  const mine = (await call("t1", "GET", "/api/my/courses", null)).data;
  if (mine?.courses) assert.equal(mine.courses.length, 2);

  // ครูประจำชั้น
  await call("admin", "POST", "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูปิติ ยิ้มแย้ม" }] }, { expect: 200 });
  const hr = (await call("admin", "GET", "/api/admin/homerooms", null, { expect: 200 })).data.rooms.find((r) => r.grade_level === "ป.4");
  assert.deepEqual(hr.teachers.map((x) => x.id), [5]);
  await call("t1", "POST", "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูปิติ ยิ้มแย้ม" }] }, { expect: 403 });
});

test("ชุดทดสอบการคำนวณ: 0, 49.5, 54.5, 79.5, 100 ไม่ปัดเศษ", () => {
  const items = [
    { id: 1, kind: "indicator", max_score: 35, term_number: 1 }, { id: 2, kind: "final", max_score: 15, term_number: 1 },
    { id: 3, kind: "indicator", max_score: 35, term_number: 2 }, { id: 4, kind: "final", max_score: 15, term_number: 2 },
  ];
  const s = { collect_ratio: 70, hours_per_year: 160, attendance_pass_pct: 80 };
  const cases = [[[0, 0, 0, 0], 0, "0"], [[17.5, 7, 17.5, 7.5], 49.5, "0"], [[20, 7.5, 20, 7], 54.5, "1"], [[30, 10, 29.5, 10], 79.5, "3.5"], [[35, 15, 35, 15], 100, "4"], [[24.5, 10.5, 20.5, 4.5], 60, "2"]];
  for (const [v, total, grade] of cases) {
    const r = computeStudentResult(items, { 1: v[0], 2: v[1], 3: v[2], 4: v[3] }, {}, s);
    assert.equal(r.total, total, `รวม ${v}`);
    assert.equal(r.grade, grade, `เกรด ${total}`);
    assert.equal(r.exact, true);
    assert.equal(r.term_scores[1].total + r.term_scores[2].total, total);
  }
  // ทศนิยมที่บวกกันแล้วคลาด (0.1 + 0.2) ต้องไม่ทำให้ 79.99… กลายเป็นเกรดต่ำลง
  const r = computeStudentResult(items, { 1: 29.7, 2: 10.2, 3: 29.9, 4: 10.2 }, {}, s);
  assert.equal(r.total, 80);
  assert.equal(r.grade, "4");
  // มีแค่ภาค 2 (นำร่อง) ระหว่างปีไม่ออกเกรด
  const t2 = computeStudentResult(items.slice(2), { 3: 30, 4: 12 }, {}, s);
  assert.equal(t2.grade, null);
  assert.equal(t2.term_scores[2].total, 42);
  // มส จากผลพิเศษ
  assert.equal(computeStudentResult(items, { 1: 35, 2: 15, 3: 35, 4: 15 }, { special: "มส" }, s).grade, "มส");
});
