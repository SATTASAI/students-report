// แบบบันทึกประจำวันของครูประจำชั้น (ดื่มนม แปรงฟัน อาหารกลางวัน เขตรับผิดชอบ + ตรวจสุขภาพรายสัปดาห์) และปฏิทินวันหยุดแบบดูอย่างเดียว
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { weeksOf } from "../src/routes/homeroom.js";

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
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"], ["t2", "teacher2@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie")?.split(";")[0];
  }
  await call("admin", "POST", "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] }, { expect: 200 });
  return { call };
}

test("ปฏิทินวันหยุด: ครูประจำชั้นดูได้แต่แก้ไม่ได้ ครูที่ไม่ได้ประจำชั้นดูไม่ได้", async () => {
  const { call } = await setup();
  await call("admin", "POST", "/api/calendar", { from: "2026-11-02", name: "หยุดชดเชย" }, { expect: 200 });
  const c = (await call("t1", "GET", "/api/calendar", null, { expect: 200 })).data;
  assert.equal(c.can_edit, false);
  assert.equal(c.holidays.length, 1);
  assert.equal((await call("admin", "GET", "/api/calendar", null, { expect: 200 })).data.can_edit, true);
  await call("t1", "POST", "/api/calendar", { from: "2026-11-04", name: "x" }, { expect: 403 });
  await call("t1", "DELETE", "/api/calendar/2026-11-02", null, { expect: 403 });
  await call("t2", "GET", "/api/calendar", null, { expect: 403 });
});

test("แบบบันทึกประจำวัน: วันตามปฏิทินวันหยุด ติ๊ก/ล้าง ขาดเรียนแสดงในตาราง และวันหยุดใหม่ล้างบันทึกวันนั้น", async () => {
  const { call } = await setup();
  await call("admin", "POST", "/api/calendar", { from: "2026-11-02", name: "หยุดชดเชย" }, { expect: 200 });
  const sid = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students[0].id;
  const g = (await call("t1", "GET", `/api/homeroom/logs?${Q}&type=milk&month=2026-11`, null, { expect: 200 })).data;
  assert.ok(!g.days.includes("2026-11-02") && g.days[0] === "2026-11-03");
  assert.ok(g.days.every((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())));
  assert.ok(g.months.length >= 10);
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [
    { student_id: sid, type: "milk", date: "2026-11-03", value: "1" },
    { student_id: sid, type: "brush", date: "2026-11-03", value: "1" },
    { student_id: sid, type: "duty", date: "2026-11-04", value: "1" },
  ] }, { expect: 200 });
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [{ student_id: sid, type: "milk", date: "2026-11-02", value: "1" }] }, { expect: 400 }); // วันหยุด
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [{ student_id: sid, type: "milk", date: "2026-11-05", value: "x" }] }, { expect: 400 });
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [{ student_id: sid, type: "coffee", date: "2026-11-05", value: "1" }] }, { expect: 400 });
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, { changes: [{ student_id: sid, date: "2026-11-05", code: "ป" }] }, { expect: 200 });
  let m = (await call("t1", "GET", `/api/homeroom/logs?${Q}&type=milk&month=2026-11`, null, { expect: 200 })).data;
  assert.deepEqual(m.records[sid], { milk: { "2026-11-03": "1" } }); // เฉพาะแบบบันทึกที่ขอ
  assert.equal(m.absent[sid]["2026-11-05"], "ป");
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [{ student_id: sid, type: "milk", date: "2026-11-03", value: "" }] }, { expect: 200 });
  m = (await call("t1", "GET", `/api/homeroom/logs?${Q}&type=milk&month=2026-11`, null, { expect: 200 })).data;
  assert.equal(m.records[sid], undefined);
  // ตั้งวันหยุดย้อนหลัง → บันทึกวันนั้นถูกล้าง
  await call("admin", "POST", "/api/calendar", { from: "2026-11-04", name: "หยุดพิเศษ" }, { expect: 200 });
  const d = (await call("t1", "GET", `/api/homeroom/logs?${Q}&type=duty&month=2026-11`, null, { expect: 200 })).data;
  assert.equal(d.records[sid], undefined);
  await call("t2", "GET", `/api/homeroom/logs?${Q}&type=milk`, null, { expect: 403 });
});

test("ตรวจสุขภาพ: 4 สัปดาห์ × เล็บ ฟัน ผม มือ ค่า สะอาด/ไม่สะอาด", async () => {
  const { call } = await setup();
  const sid = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students[0].id;
  const h = (await call("t1", "GET", `/api/homeroom/logs?${Q}&type=health&month=2026-11`, null, { expect: 200 })).data;
  assert.equal(h.weeks.length, 4);
  assert.deepEqual(Object.values(h.health_items), ["เล็บ", "ฟัน", "ผม", "มือ"]);
  assert.equal(h.weeks[0].from, "2026-11-02");
  assert.equal(h.weeks[0].to, "2026-11-06");
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [
    { student_id: sid, type: "h_nail", date: "2026-11-w1", value: "no" },
    { student_id: sid, type: "h_teeth", date: "2026-11-w1", value: "ok" },
    { student_id: sid, type: "h_hand", date: "2026-11-w4", value: "ok" },
  ] }, { expect: 200 });
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [{ student_id: sid, type: "h_hair", date: "2026-11-w5", value: "ok" }] }, { expect: 400 });
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [{ student_id: sid, type: "h_hair", date: "2026-11-w2", value: "1" }] }, { expect: 400 });
  const r = (await call("t1", "GET", `/api/homeroom/logs?${Q}&type=health&month=2026-11`, null, { expect: 200 })).data.records[sid];
  assert.deepEqual(r, { h_nail: { "2026-11-w1": "no" }, h_teeth: { "2026-11-w1": "ok" }, h_hand: { "2026-11-w4": "ok" } });
  assert.equal((await call("t1", "GET", `/api/homeroom/logs?${Q}&type=milk&month=2026-11`, null, { expect: 200 })).data.records[sid], undefined);
});

test("weeksOf: แบ่งวันเรียนเป็นสัปดาห์ จันทร์–ศุกร์ เติมให้ครบ 4", () => {
  const w = weeksOf(["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"]);
  assert.deepEqual(w.map((x) => [x.from, x.to]), [["2026-10-29", "2026-10-30"], ["2026-11-02", "2026-11-03"], [null, null], [null, null]]);
  assert.equal(weeksOf(Array.from({ length: 23 }, (_, i) => new Date(Date.UTC(2026, 11, 1 + i)).toISOString().slice(0, 10)).filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))).length, 4);
});
