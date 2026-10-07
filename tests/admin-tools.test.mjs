// เครื่องมือฝ่ายวัดผล: ปฏิทินวันหยุด + มส อัตโนมัติจากการมาเรียน, รายชื่อนักเรียน (แก้ชื่อ เพศ ห้อง เลขที่)
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
  return { env, call, c };
}
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;

test("ปฏิทินวันหยุด: ตารางมาเรียนไม่แสดงวันหยุด บันทึกขาดวันหยุดไม่ได้ และเพิ่มวันหยุดแล้วล้างบันทึกวันนั้น", async () => {
  const { call } = await setup();
  const sid = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students[0].id;
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, { changes: [{ student_id: sid, date: "2026-11-02", code: "ข" }] }, { expect: 200 });
  await call("t1", "POST", "/api/calendar", { from: "2026-11-02", name: "หยุด" }, { expect: 403 });
  await call("admin", "POST", "/api/calendar", { from: "2026-11-02", to: "2026-11-03", name: "" }, { expect: 400 });
  const add = (await call("admin", "POST", "/api/calendar", { from: "2026-10-30", to: "2026-11-03", name: "หยุดชดเชย" }, { expect: 200 })).data;
  assert.equal(add.added, 3); // ศ. 30 ต.ค. (นอกภาค แต่บันทึกไว้), จ. 2, อ. 3 (เสาร์อาทิตย์ไม่นับ)
  const cal = (await call("admin", "GET", "/api/calendar", null, { expect: 200 })).data;
  assert.equal(cal.holidays.length, 3);
  const g = (await call("t1", "GET", `/api/homeroom/attendance?${Q}&month=2026-11`, null, { expect: 200 })).data;
  assert.ok(!g.days.includes("2026-11-02") && !g.days.includes("2026-11-03"));
  assert.equal(g.days[0], "2026-11-04");
  assert.equal(g.records[sid], undefined); // บันทึกขาดวันหยุดถูกล้าง
  assert.equal(g.holidays.length, 2);
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, { changes: [{ student_id: sid, date: "2026-11-03", code: "ข" }] }, { expect: 400 });
  await call("admin", "DELETE", "/api/calendar/2026-11-03", null, { expect: 200 });
  assert.ok((await call("t1", "GET", `/api/homeroom/attendance?${Q}&month=2026-11`, null, { expect: 200 })).data.days.includes("2026-11-03"));
});

test("มส อัตโนมัติ: มาเรียนต่ำกว่าเกณฑ์ (นับวันขาด/ลา ไม่นับมาสาย) → ผลการเรียน มส ทั้งหน้ารายวิชาและ ปพ.6", async () => {
  const { call, c } = await setup();
  const kids = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students;
  const [a, b] = kids;
  // ขาด 40 วันทำการแรกของภาค 1 (พ.ค.–มิ.ย. 2569) → ต่ำกว่า 80% แน่นอนเมื่อดูถึงวันนี้
  const days = [];
  for (let d = new Date("2026-05-01T00:00:00Z"); days.length < 40; d.setUTCDate(d.getUTCDate() + 1)) if (![0, 6].includes(d.getUTCDay())) days.push(d.toISOString().slice(0, 10));
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, { changes: days.map((date, i) => ({ student_id: a.id, date, code: i % 2 ? "ล" : "ข" })) }, { expect: 200 });
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, { changes: days.map((date) => ({ student_id: b.id, date, code: "มส" })) }, { expect: 200 }); // มาสายทั้งหมด = มาเรียน
  const cd = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  const ra = cd.attendance[a.id].rate, rb = cd.attendance[b.id].rate;
  assert.equal(ra.absent, 40);
  assert.ok(ra.pct < 80, `pct ${ra.pct}`);
  assert.equal(rb.absent, 0);
  assert.equal(rb.pct, 100);
  assert.equal(cd.computed[a.id].low_attendance, true);
  assert.equal(cd.computed[a.id].original_grade, "มส");
  assert.equal(cd.computed[b.id].low_attendance, false);
  const rep = (await call("t1", "GET", `/api/reports/room?${Q}`, null, { expect: 200 })).data;
  assert.equal(rep.students.find((x) => x.id === a.id).subjects.find((x) => x.code === "ท14101").grade, "มส");
  // วันขาดที่กลายเป็นวันหยุดไม่นับ
  await call("admin", "POST", "/api/calendar", { from: days[0], to: days[39], name: "ปิดโรงเรียนกรณีพิเศษ" }, { expect: 200 });
  const cd2 = (await call("t1", "GET", `/api/courses/${c.id}`, null, { expect: 200 })).data;
  assert.equal(cd2.attendance[a.id].rate.absent, 0);
  assert.equal(cd2.computed[a.id].low_attendance, false);
});

test("รายชื่อนักเรียน: ฝ่ายวัดผลแก้ชื่อ เพศ เลขที่ และย้ายห้อง — ครูทั่วไปทำไม่ได้", async () => {
  const { call } = await setup();
  await call("t1", "GET", `/api/roster?${Q}`, null, { expect: 403 });
  let d = (await call("admin", "GET", `/api/roster?${Q}`, null, { expect: 200 })).data;
  assert.ok(d.rooms.some((r) => r.grade_level === "อ.3"));
  const [s1, s2, s3] = d.students;
  await call("admin", "PUT", `/api/roster/${s1.id}`, { first_name: "", last_name: "x" }, { expect: 400 });
  await call("admin", "PUT", `/api/roster/${s1.id}`, { name_prefix: "เด็กชาย", first_name: "แก้ชื่อ", last_name: "แล้ว" }, { expect: 200 });
  await call("admin", "PUT", `/api/roster/${s2.id}`, { gender: "ญ" }, { expect: 200 });
  // ตรึงเลขที่: คนที่ 3 เป็นเลขที่ 1 คนอื่นเลื่อนไปเลขที่ว่าง
  await call("admin", "PUT", `/api/roster/${s3.id}`, { number: 100 }, { expect: 400 });
  await call("admin", "PUT", `/api/roster/${s3.id}`, { number: 1 }, { expect: 200 });
  await call("admin", "PUT", `/api/roster/${s1.id}`, { number: 1 }, { expect: 409 });
  d = (await call("admin", "GET", `/api/roster?${Q}`, null, { expect: 200 })).data;
  assert.equal(d.students[0].id, s3.id);
  assert.equal(d.students[0].number, 1);
  assert.deepEqual(d.students.map((s) => s.number), d.students.map((_, i) => i + 1));
  assert.equal(d.students.find((s) => s.id === s1.id).name, "เด็กชายแก้ชื่อ แล้ว");
  // ครูประจำชั้นเห็นชื่อใหม่และลำดับเดียวกัน
  const hr = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students;
  assert.equal(hr[0].id, s3.id);
  assert.equal(hr.find((s) => s.id === s1.id).name, "เด็กชายแก้ชื่อ แล้ว");
  // ย้ายห้อง (ห้องต้องมีอยู่จริง)
  await call("admin", "PUT", `/api/roster/${s3.id}`, { grade_level: "ป.4", classroom: "9" }, { expect: 400 });
  const mv = (await call("admin", "PUT", `/api/roster/${s3.id}`, { grade_level: "ป.6", classroom: "1" }, { expect: 200 })).data;
  assert.equal(mv.moved, true);
  d = (await call("admin", "GET", `/api/roster?${Q}`, null, { expect: 200 })).data;
  assert.ok(!d.students.some((s) => s.id === s3.id));
  const p6 = (await call("admin", "GET", `/api/roster?grade=${encodeURIComponent("ป.6")}&room=1`, null, { expect: 200 })).data;
  assert.ok(p6.students.some((s) => s.id === s3.id && !s.manual_number));
});
