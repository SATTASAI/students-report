// ปฐมวัยเปิดใช้เสมอ แม้ตั้งห้องนำร่องไว้เฉพาะชั้นประถม
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";

const ORIGIN = "http://school.test";
test("ห้องนำร่องไม่ปิดชั้นอนุบาล: คลังเอกสารผู้ดูแลเห็น อ. ทั้งห้อง และครูประจำชั้นอนุบาลใช้งานได้", async () => {
  const env = await makeEnv();
  const cookies = {};
  async function call(who, method, path, body, { expect } = {}) {
    const headers = { "Content-Type": "application/json", Origin: ORIGIN };
    if (cookies[who]) headers.Cookie = cookies[who];
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const data = await res.json().catch(() => null);
    if (expect) assert.equal(res.status, expect, JSON.stringify(data));
    return data;
  }
  for (const [who, email] of [["admin", "admin@test.local"], ["k", "teacher3@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("set-cookie").split(";")[0];
  }
  await call("admin", "POST", "/api/admin/import/homerooms", { rows: [{ room: "อ.3/1", teachers: "ครูปิติ ยิ้มแย้ม" }] }, { expect: 200 });
  await call("admin", "PUT", "/api/admin/pilot", { rooms: ["ป.4/1"] }, { expect: 200 });
  const docs = await call("admin", "GET", "/api/reports/docs?year=1", null, { expect: 200 });
  assert.ok(docs.rooms.some((r) => r.grade_level === "อ.3" && r.full && r.kinder));
  await call("k", "GET", `/api/homeroom/kinder?year=1&grade=${encodeURIComponent("อ.3")}&room=1`, null, { expect: 200 });
});
