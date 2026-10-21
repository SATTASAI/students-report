import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { CONTENT_SECURITY_POLICY } from "../src/lib/auth-sessions.js";

const ORIGIN = "http://school.test";
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function call(env, method, path, body, { cookie, ua = CHROME_WIN, ip = "203.0.113.5" } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "User-Agent": ua, "CF-Connecting-IP": ip };
  if (cookie) headers.Cookie = cookie;
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, data: await res.json().catch(() => null), res };
}
const login = async (env, email, opts = {}) => {
  const r = await call(env, "POST", "/api/auth/login", { email, password: PASSWORD, ...(opts.body || {}) }, opts);
  return { ...r, cookie: (r.res.headers.get("Set-Cookie") || "").split(";")[0] };
};
const alerts = async (env, email) => (await env.DB.prepare(
  "SELECT n.kind, n.message FROM security_notifications n JOIN users u ON u.id = n.user_id WHERE u.email = ? ORDER BY n.id").bind(email).all()).results;

test("ระบบผลการเรียน: เข้าสู่ระบบสร้าง session รายอุปกรณ์ แจ้งอุปกรณ์ใหม่ และออกจากระบบแล้วใช้ token เดิมไม่ได้", async () => {
  const env = await makeEnv();
  const a = await login(env, "teacher1@test.local");
  assert.equal(a.status, 200);
  const sid = JSON.parse(Buffer.from(a.cookie.split("=")[1].split(".")[1], "base64url")).sid;
  const row = await env.DB.prepare("SELECT app, device_label FROM auth_sessions WHERE id = ?").bind(sid).first();
  assert.equal(row.app, "grades"); assert.equal(row.device_label, "Chrome บน Windows");
  assert.equal((await alerts(env, "teacher1@test.local")).length, 0);
  const b = await login(env, "teacher1@test.local", { ua: SAFARI_IPHONE });
  const [alert] = await alerts(env, "teacher1@test.local");
  assert.equal(alert.kind, "new_device"); assert.match(alert.message, /ระบบรายงานผลการเรียนจากอุปกรณ์ใหม่: Safari บน iPhone/);

  // ออกจากระบบอุปกรณ์จากระบบบริหารโรงเรียน (ตารางเดียวกัน) → ระบบผลการเรียนปฏิเสธทันที
  await env.DB.prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = ?").bind(sid).run();
  assert.equal((await call(env, "GET", "/api/me", null, { cookie: a.cookie })).status, 401);
  assert.equal((await call(env, "GET", "/api/me", null, { cookie: b.cookie })).status, 200);
  await call(env, "POST", "/api/auth/logout", null, { cookie: b.cookie });
  assert.equal((await call(env, "GET", "/api/me", null, { cookie: b.cookie })).status, 401);
});

test("ระบบผลการเรียน: ใส่รหัสผิดจนถูกพักแจ้งเจ้าของบัญชี · Turnstile บังคับเมื่อตั้ง secret", async () => {
  const env = await makeEnv();
  for (let i = 0; i < 5; i++) await call(env, "POST", "/api/auth/login", { email: "teacher2@test.local", password: "x" }, { ip: "192.0.2.1" });
  const lock = await alerts(env, "teacher2@test.local");
  assert.equal(lock.length, 1); assert.match(lock[0].message, /ใส่รหัสผ่านผิด 5 ครั้งที่ระบบรายงานผลการเรียน จาก IP 192\.0\.2\.1/);

  env.TURNSTILE_SECRET_KEY = "secret";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes("turnstile")
    ? new Response(JSON.stringify({ success: init.body.get("response") === "ok-token" })) : realFetch(url, init);
  try {
    assert.equal((await login(env, "teacher1@test.local")).status, 400);
    assert.equal((await login(env, "teacher1@test.local", { body: { turnstile_token: "ok-token" } })).status, 200);
  } finally { globalThis.fetch = realFetch; }
});

test("ระบบผลการเรียน: เปลี่ยนสิทธิ์ทีมวัดผลแจ้งเจ้าของบัญชีและผู้ดูแลระบบ · header ความปลอดภัย", async () => {
  const env = await makeEnv();
  const admin = await login(env, "admin@test.local");
  const target = await env.DB.prepare("SELECT id FROM users WHERE email = 'teacher1@test.local'").first();
  assert.equal((await call(env, "PUT", "/api/admin/staff-roles", { user_id: target.id, grant: true }, { cookie: admin.cookie })).status, 200);
  assert.match((await alerts(env, "teacher1@test.local")).at(-1).message, /ได้รับสิทธิ์ทีมวัดและประเมินผล/);

  const page = await worker.fetch(new Request(ORIGIN + "/login.html"), env);
  assert.equal(page.headers.get("Content-Security-Policy"), CONTENT_SECURITY_POLICY);
  assert.equal(page.headers.get("X-Frame-Options"), "SAMEORIGIN");
  const api = await call(env, "GET", "/api/me", null, { cookie: admin.cookie });
  assert.equal(api.res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(fs.readFileSync("public/login.html", "utf8"), /data-turnstile[\s\S]*onload=onSchoolTurnstile/);
  // โมดูลความปลอดภัยต้องเหมือนกับของระบบบริหารโรงเรียน (ใช้ตารางร่วมกัน)
  const sibling = new URL("../../banpadeng-school-db/src/lib/auth-sessions.js", import.meta.url);
  if (fs.existsSync(sibling)) assert.equal(fs.readFileSync("src/lib/auth-sessions.js", "utf8"), fs.readFileSync(sibling, "utf8"));
});
