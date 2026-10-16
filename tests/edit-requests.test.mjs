// คำขอแก้ไขหลังปิดการกรอก/ส่งผล: ครูขอ → ฝ่ายวัดผลอนุมัติ → แก้ได้ · ครูประจำชั้นแก้หลังอนุมัติ → รายวิชากลับไปรออนุมัติใหม่
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
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie").split(";")[0];
  }
  await call("admin", "POST", "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.4"] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const c = courses.find((x) => x.code === "ท14101" && x.classroom === "1");
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  const d = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [
    { term_number: 1, kind: "indicator", title: "ก", max_score: 35 }, { term_number: 1, kind: "final", title: "ส", max_score: 15 },
    { term_number: 2, kind: "indicator", title: "ข", max_score: 35 }, { term_number: 2, kind: "final", title: "ส2", max_score: 15 },
  ] }, { expect: 200 })).data;
  const setts = (await call("admin", "GET", "/api/admin/settings", null, { expect: 200 })).data.settings;
  const close = () => call("admin", "PUT", "/api/admin/settings", { ...setts, entry_open: 0, confirm_locked: true }, { expect: 200 });
  return { call, c, d, close };
}
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;

test("ปิดการกรอก: ครูแก้คะแนนไม่ได้ → ขอแก้ → วัดผลอนุมัติ → แก้ได้ → ส่งผลแล้วสิทธิ์หมด", async () => {
  const { call, c, d, close } = await setup();
  const kid = d.students.find((s) => s.enrollment_status === "enrolled");
  const it = d.items[0];
  await close();
  const blocked = await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: it.id, student_id: kid.id, score: 20 }] }, { expect: 409 });
  assert.match(blocked.data.error, /คำขอแก้ไข/);
  await call("t1", "POST", `/api/courses/${c.id}/edit-request`, { reason: "" }, { expect: 400 });
  await call("t1", "POST", `/api/courses/${c.id}/edit-request`, { reason: "กรอกคะแนนผิดคนที่ 1" }, { expect: 200 });
  await call("t1", "POST", `/api/courses/${c.id}/edit-request`, { reason: "ซ้ำ" }, { expect: 409 });
  assert.equal((await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data.edit_request.reason, "กรอกคะแนนผิดคนที่ 1");
  // ครูพิจารณาเองไม่ได้
  const list = (await call("admin", "GET", "/api/admin/edit-requests", null, { expect: 200 })).data.requests;
  assert.equal(list.length, 1);
  await call("t1", "POST", `/api/admin/edit-requests/${list[0].id}/approve`, {}, { expect: 403 });
  await call("admin", "POST", `/api/admin/edit-requests/${list[0].id}/approve`, { note: "ok" }, { expect: 200 });
  await call("admin", "POST", `/api/admin/edit-requests/${list[0].id}/approve`, {}, { expect: 409 });
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: it.id, student_id: kid.id, score: 20 }] }, { expect: 200 });
  await call("t1", "POST", `/api/courses/${c.id}/submit`, { force: true }, { expect: 200 });
  // ส่งผลใหม่แล้ว สิทธิ์จากคำขอหมด — ขอแก้อีกต้องขอใหม่
  const cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(cd.course.edit_granted_at, null);
  await call("t1", "POST", `/api/courses/${c.id}/edit-request`, { reason: "ขอแก้อีกครั้ง" }, { expect: 200 });
  const id2 = (await call("admin", "GET", "/api/admin/edit-requests", null, { expect: 200 })).data.requests.find((r) => r.status === "pending").id;
  await call("admin", "POST", `/api/admin/edit-requests/${id2}/reject`, { note: "" }, { expect: 400 });
  await call("admin", "POST", `/api/admin/edit-requests/${id2}/reject`, { note: "ผลถูกต้องแล้ว" }, { expect: 200 });
  assert.equal((await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data.course.locked, 1);
});

test("ครูประจำชั้น: ปิดการกรอกแล้วแก้การมาเรียนไม่ได้ จนวัดผลอนุมัติ (แก้ได้ชั่วคราว ปิดสิทธิ์ได้)", async () => {
  const { call, d, close } = await setup();
  const kid = d.students.find((s) => s.enrollment_status === "enrolled");
  await close();
  const h = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data;
  assert.equal(h.edit.open, false);
  const att = { changes: [{ student_id: kid.id, date: "2026-11-03", code: "ข" }] };
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, att, { expect: 409 });
  await call("t1", "PUT", `/api/homeroom/assessments?${Q}`, { changes: [{ student_id: kid.id, item_key: "trait_1", value: "3" }] }, { expect: 409 });
  await call("t1", "PUT", "/api/activities", { grade: "ป.4", room: "1", changes: [{ student_id: kid.id, item_key: "act_scout_t", value: "มผ" }] }, { expect: 409 });
  const r = (await call("t1", "POST", `/api/homeroom/edit-request?${Q}`, { reason: "ลืมบันทึกขาดเรียน" }, { expect: 200 })).data;
  assert.ok(r.edit.pending);
  const id = (await call("admin", "GET", "/api/admin/edit-requests", null, { expect: 200 })).data.requests[0].id;
  await call("admin", "POST", `/api/admin/edit-requests/${id}/approve`, {}, { expect: 200 });
  const h2 = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data;
  assert.equal(h2.edit.why, "grant");
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, att, { expect: 200 });
  await call("admin", "POST", `/api/admin/edit-requests/${id}/close`, {}, { expect: 200 });
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, att, { expect: 409 });
});

test("ครูประจำชั้นแก้การมาเรียนหลังอนุมัติ → รายวิชาของห้องกลับไปรอผู้บริหารอนุมัติใหม่ + มีประวัติ", async () => {
  const { call, c, d } = await setup();
  const kids = d.students.filter((s) => s.enrollment_status === "enrolled");
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: kids.flatMap((k) => d.items.map((i) => ({ item_id: i.id, student_id: k.id, score: i.kind === "final" ? 10 : 30 }))) }, { expect: 200 });
  await call("t1", "POST", `/api/courses/${c.id}/submit`, { force: true }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/review", { course_ids: [c.id] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/approve", { course_ids: [c.id] }, { expect: 200 });
  assert.equal((await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data.course.status, "approved");
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, { changes: [{ student_id: kids[0].id, date: "2026-11-03", code: "ข" }] }, { expect: 200 });
  const cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(cd.course.status, "reviewed");
  assert.ok(cd.edits.some((e) => /มาเรียน/.test(e.what)));
});

test("บังคับส่ง (ล็อก) ไม่ได้ถ้าโครงสร้างคะแนนไม่ตรงสัดส่วน", async () => {
  const { call, c } = await setup();
  await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [{ term_number: 1, kind: "indicator", title: "เกิน", max_score: 5 }] }, { expect: 200 });
  const r = await call("admin", "POST", `/api/admin/courses/${c.id}/lock`, { locked: true }, { expect: 400 });
  assert.match(r.data.error, /ภาค 1/);
});
