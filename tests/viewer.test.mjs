import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";

const ORIGIN = "http://school.test";
async function call(env, method, path, body, cookie) {
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function viewerEnv() {
  const env = await makeEnv();
  const login = async (email) => {
    const res = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    return (res.headers.get("Set-Cookie") || "").split(";")[0];
  };
  const admin = await login("admin@test.local");
  await call(env, "GET", "/api/me", null, admin); // ensure schema
  const t = await env.DB.prepare("SELECT id FROM users WHERE email = 'teacher2@test.local'").first();
  await env.DB.prepare("UPDATE users SET role = NULL WHERE id = ?").bind(t.id).run();
  await env.DB.prepare("INSERT INTO viewer_accounts (user_id) VALUES (?)").bind(t.id).run();
  return { env, admin, viewer: await login("teacher2@test.local"), viewerId: t.id };
}

test("ผู้ชมภายนอก: ดูรายงานภาพรวมได้ ไม่เห็นชื่อนักเรียน และแก้ไขอะไรไม่ได้", async () => {
  const { env, viewer, admin } = await viewerEnv();
  const me = await call(env, "GET", "/api/me", null, viewer);
  assert.equal(me.status, 200); assert.equal(me.data.user.role, "viewer"); assert.equal(me.data.user.can_view_all, false);
  const summary = await call(env, "GET", "/api/reports/summary", null, viewer);
  assert.equal(summary.status, 200);
  for (const g of summary.data.ranking) for (const x of g.top) { assert.equal(x.name, "(ซ่อนชื่อนักเรียน)"); assert.equal(x.student_id, undefined); }
  assert.equal((await call(env, "GET", "/api/reports/progress", null, viewer)).status, 200);
  assert.equal((await call(env, "GET", "/api/sar", null, viewer)).status, 200);
  for (const p of ["/api/admin/teachers", "/api/reports/room?grade=ป.1&room=1", "/api/courses", "/api/roster", "/api/backup", "/api/calendar", "/api/reports/docs"])
    assert.equal((await call(env, "GET", p, null, viewer)).status, 403, p);
  const write = await call(env, "PUT", "/api/sar", { values: [] }, viewer);
  assert.equal(write.status, 403); assert.equal(write.data.code, "VIEWER_READ_ONLY");
  // ครูทั่วไปยังใช้รายงานผู้บริหารไม่ได้เหมือนเดิม
  const t1 = await (async () => { const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "teacher1@test.local", password: PASSWORD }) }), env); return r.headers.get("Set-Cookie").split(";")[0]; })();
  assert.equal((await call(env, "GET", "/api/reports/summary", null, t1)).status, 403);
  // ผู้บริหาร/แอดมินยังเห็นชื่อ
  const full = await call(env, "GET", "/api/reports/summary", null, admin);
  for (const g of full.data.ranking) for (const x of g.top) assert.notEqual(x.name, "(ซ่อนชื่อนักเรียน)");
});

test("ผู้ชมภายนอก: หมดอายุแล้วใช้ไม่ได้ · ไม่ถูกเลื่อนเป็นครูอัตโนมัติ · ไม่อยู่ในรายชื่อครู", async () => {
  const { env, viewer, admin, viewerId } = await viewerEnv();
  const teachers = await call(env, "GET", "/api/admin/teachers", null, admin);
  assert(!teachers.data.teachers.some((t) => t.id === viewerId));
  await env.DB.prepare("UPDATE viewer_accounts SET expires_at = '2000-01-01' WHERE user_id = ?").bind(viewerId).run();
  assert.equal((await call(env, "GET", "/api/me", null, viewer)).status, 401);
});
