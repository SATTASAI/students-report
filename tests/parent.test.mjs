import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";

const ORIGIN = "http://school.test";
async function call(env, method, path, body, cookie, ip = "1.1.1.1") {
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": ip, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function setup() {
  const env = await makeEnv();
  const res = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "admin@test.local", password: PASSWORD }) }), env);
  const admin = (res.headers.get("Set-Cookie") || "").split(";")[0];
  const s = (await call(env, "GET", "/api/admin/settings", null, admin)).data.settings;
  const st = await env.DB.prepare("SELECT s.id, s.student_code, s.national_id FROM students s JOIN student_enrollments e ON e.student_id = s.id WHERE e.grade_level = 'ป.4' LIMIT 1").first();
  const kinder = await env.DB.prepare("SELECT s.student_code, s.national_id FROM students s JOIN student_enrollments e ON e.student_id = s.id WHERE e.grade_level = 'อ.3' LIMIT 1").first();
  return { env, admin, s, st, kinder };
}

test("ผู้ปกครองดู ปพ.6: ปิดอยู่ไม่ได้ · เปิดแล้วเห็นเฉพาะคนเดียว · ข้อมูลผิดไม่บอกว่ามีเลขประจำตัว · อนุบาลไม่ได้", async () => {
  const { env, admin, s, st, kinder } = await setup();
  const body = { student_code: st.student_code, password: st.national_id.slice(-8) };
  assert.equal((await call(env, "POST", "/api/parent/pp6", body)).status, 403);
  assert.equal((await call(env, "PUT", "/api/admin/settings", { ...s, parent_pp6_term: 1 }, admin)).status, 200);
  const ok = await call(env, "POST", "/api/parent/pp6", body);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.term, 1);
  assert.equal(ok.data.report.students.length, 1);
  assert.equal(ok.data.report.students[0].id, st.id);
  const bad = await call(env, "POST", "/api/parent/pp6", { ...body, password: "00000000" }, null, "2.2.2.2");
  const none = await call(env, "POST", "/api/parent/pp6", { ...body, student_code: "nope" }, null, "2.2.2.2");
  assert.equal(bad.status, 404); assert.equal(none.status, 404); assert.equal(bad.data.error, none.data.error);
  assert.equal((await call(env, "POST", "/api/parent/pp6", { student_code: kinder.student_code, password: kinder.national_id.slice(-8) }, null, "3.3.3.3")).status, 404);
  assert.equal((await call(env, "POST", "/api/parent/pp6", { ...body, password: "123" })).status, 400);
});

test("ผู้ปกครองดู ปพ.6: ผิด 5 ครั้งต่อ IP ถูกล็อก แม้ข้อมูลถูกก็รอ", async () => {
  const { env, admin, s, st } = await setup();
  await call(env, "PUT", "/api/admin/settings", { ...s, parent_pp6_term: 2 }, admin);
  for (let i = 0; i < 5; i++) assert.equal((await call(env, "POST", "/api/parent/pp6", { student_code: st.student_code, password: "00000000" }, null, "4.4.4.4")).status, 404);
  assert.equal((await call(env, "POST", "/api/parent/pp6", { student_code: st.student_code, password: st.national_id.slice(-8) }, null, "4.4.4.4")).status, 429);
  const other = await call(env, "POST", "/api/parent/pp6", { student_code: st.student_code, password: st.national_id.slice(-8) }, null, "5.5.5.5");
  assert.equal(other.status, 200); assert.equal(other.data.term, 2);
});
