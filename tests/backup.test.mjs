// สำรอง/กู้คืนข้อมูลเป็น JSON: ครบทุกตาราง gr_*, กู้คืนแล้วข้อมูลตรงไฟล์, อัปโหลดไม่ครบไม่แตะข้อมูลจริง
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { BACKUP_FORMAT } from "../src/routes/backup.js";

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
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie").split(";")[0];
  }
  await call("admin", "POST", "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.4"] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  return { env, call };
}
// เหมือนหน้าเว็บ: ดึงทุกตารางทีละหน้าแล้วรวมเป็นไฟล์เดียว
async function makeBackup(call) {
  const meta = (await call("admin", "GET", "/api/backup/tables", null, { expect: 200 })).data;
  const tables = {};
  for (const t of meta.tables) {
    const rows = []; let after = 0, columns = t.columns;
    for (;;) {
      const r = (await call("admin", "GET", `/api/backup/rows?table=${t.name}&after=${after}`, null, { expect: 200 })).data;
      rows.push(...r.rows); columns = r.columns;
      if (r.next == null) break; after = r.next;
    }
    tables[t.name] = { columns, count: rows.length, rows };
  }
  return { format: meta.format, schema: meta.schema, created_at: new Date().toISOString(), tables };
}
async function restore(call, file, { skipRows = null } = {}) {
  const head = { format: file.format, schema: file.schema, tables: Object.fromEntries(Object.entries(file.tables).map(([k, t]) => [k, { columns: t.columns, count: t.count }])) };
  const st = await call("admin", "POST", "/api/backup/restore/start", head);
  if (st.status !== 200) return st;
  for (const t of st.data.tables) {
    const { columns, rows } = file.tables[t.name];
    const send = skipRows === t.name ? rows.slice(1) : rows;
    for (let i = 0; i < send.length; i += 500) await call("admin", "POST", "/api/backup/restore/rows", { table: t.name, columns, rows: send.slice(i, i + 500) }, { expect: 200 });
  }
  return call("admin", "POST", "/api/backup/restore/finish", {});
}

test("สำรองและกู้คืนข้อมูล JSON: ข้อมูลกลับมาตรงไฟล์ทุกตาราง", async () => {
  const { env, call } = await setup();
  const sid = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students[0].id;
  await call("t1", "PUT", `/api/homeroom/assessments?${Q}`, { changes: [{ student_id: sid, item_key: "trait_1", value: "3" }] }, { expect: 200 });
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [{ student_id: sid, type: "milk", date: "2026-11-03", value: "1" }] }, { expect: 200 });
  await call("t1", "GET", "/api/backup/tables", null, { expect: 403 });
  const file = await makeBackup(call);
  assert.equal(file.format, BACKUP_FORMAT);
  assert.ok(file.tables.gr_subjects.count > 5 && file.tables.gr_courses.count > 5);
  assert.equal(file.tables.gr_daily_logs.count, 1);
  const subjectsBefore = env.DB.raw.prepare("SELECT * FROM gr_subjects ORDER BY id").all();

  // หลังสำรอง: เปลี่ยนข้อมูล (ลบรายวิชา แก้ผลประเมิน เพิ่มบันทึก)
  env.DB.raw.exec("DELETE FROM gr_subjects; UPDATE gr_assessments SET value = '0'");
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [{ student_id: sid, type: "brush", date: "2026-11-03", value: "1" }] }, { expect: 200 });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM gr_courses").get().n, 0); // ลบตามรายวิชา (cascade)

  const r = await restore(call, JSON.parse(JSON.stringify(file)));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(env.DB.raw.prepare("SELECT * FROM gr_subjects ORDER BY id").all(), subjectsBefore);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM gr_courses").get().n, file.tables.gr_courses.count);
  assert.equal(env.DB.raw.prepare("SELECT value FROM gr_assessments WHERE item_key='trait_1'").get().value, "3");
  assert.deepEqual(env.DB.raw.prepare("SELECT log_type FROM gr_daily_logs").all().map((x) => x.log_type), ["milk"]); // ตรงไฟล์พอดี
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'gr\\_\\_restore%' ESCAPE '\\'").get().n, 0); // ลบตารางพักแล้ว
  assert.ok(env.DB.raw.prepare("SELECT 1 FROM gr_audit WHERE action='backup.restore'").get()); // ประวัติเดิมยังอยู่ + บันทึกการกู้คืน
  // ระบบยังใช้ได้ต่อ (เพิ่มรายวิชาใหม่ได้ ไม่ชนเลข id)
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.5"] }, { expect: 200 });
});

test("กู้คืนไม่ครบ / ไฟล์ผิด → ข้อมูลจริงไม่ถูกเปลี่ยน", async () => {
  const { env, call } = await setup();
  const file = await makeBackup(call);
  const before = env.DB.raw.prepare("SELECT COUNT(*) n FROM gr_subjects").get().n;
  env.DB.raw.exec("UPDATE gr_subjects SET name = 'ชื่อใหม่'");
  const r = await restore(call, file, { skipRows: "gr_subjects" });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /อัปโหลดไม่ครบ/);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM gr_subjects WHERE name='ชื่อใหม่'").get().n, before); // ไม่ถูกแตะ
  await call("admin", "POST", "/api/backup/restore/cancel", {}, { expect: 200 });
  assert.equal((await restore(call, { ...file, format: "other" })).status, 400);
  const bad = JSON.parse(JSON.stringify(file)); bad.tables.gr_subjects.columns.push("hacker_col");
  assert.equal((await restore(call, bad)).status, 400);
  await call("admin", "POST", "/api/backup/restore/rows", { table: "gr_subjects", columns: ["id"], rows: [[1]] }, { expect: 400 }); // ยังไม่ได้เริ่ม
  // ไฟล์จากเวอร์ชันเก่าที่ไม่มีบางคอลัมน์ → ใช้ค่าเริ่มต้น
  const old = JSON.parse(JSON.stringify(file));
  const t = old.tables.gr_subjects, drop = t.columns.indexOf("sort_order");
  t.columns.splice(drop, 1); t.rows = t.rows.map((row) => row.filter((_, i) => i !== drop));
  assert.equal((await restore(call, old)).status, 200);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM gr_subjects WHERE sort_order = 0").get().n, t.count);
});
