// SAR มาตรฐานที่ 1: ตัวชี้วัดคำนวณจากข้อมูลจริงในระบบ + ค่าเป้าหมาย/ค่าที่กรอกเอง/ระดับคุณภาพ
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { evaluateSar, levelOf, SAR_ITEMS, DEFAULT_LEVELS } from "../public/js/sar.js";

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
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const c = courses.find((x) => x.code === "ท14101" && x.classroom === "1");
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] }, { expect: 200 });
  return { env, call, c };
}

test("ระดับคุณภาพและการรวมผลรายมาตรฐาน", () => {
  assert.equal(levelOf(95), "ยอดเยี่ยม"); assert.equal(levelOf(80), "ดีเลิศ"); assert.equal(levelOf(59.99), "กำลังพัฒนา"); assert.equal(levelOf(null), null);
  const r = evaluateSar({ basic: { core3: { num: 9, den: 10 }, all: { num: 3, den: 4 }, milk: { num: 1, den: 2 }, health_clean: { num: 1, den: 1 } } },
    { "1.1.1": { target: 85 }, "1.1.3": { manual_value: 70, target: 75 } });
  assert.deepEqual([r.items["1.1.1"].value, r.items["1.1.1"].met, r.items["1.1.1"].level], [90, true, "ยอดเยี่ยม"]);
  assert.deepEqual([r.items["1.1.3"].value, r.items["1.1.3"].met], [70, false]); // กรอกเอง
  assert.equal(r.items["1.2.4"].value, 75); // เฉลี่ยตัวชี้วัดที่มีข้อมูล (นม 50, ตรวจสุขภาพ 100)
  assert.equal(r.groups["1.1"].value, 78.33); // (90 + 70 + 75) / 3
  assert.equal(r.groups["1.1"].filled, 3);
  assert.ok(SAR_ITEMS.length >= 14);
});

test("SAR จากข้อมูลจริง: ผลการเรียน คุณลักษณะ การมาเรียน แบบบันทึกประจำวัน และค่าที่ฝ่ายวัดผลกรอก", async () => {
  const { call, c } = await setup();
  // ตั้งโครงสร้าง 2 ภาค แล้วให้คนแรกได้ 4 คนที่สองได้ 1
  const items = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [1, 2].flatMap((t) => [
    { term_number: t, kind: "indicator", title: `เก็บ ${t}`, max_score: 35 }, { term_number: t, kind: "final", title: `สอบ ${t}`, max_score: 15 }]) }, { expect: 200 })).data.items;
  const kids = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.students.filter((s) => s.enrollment_status === "enrolled");
  const [a, b] = kids;
  const sc = (sid, pct) => items.map((it) => ({ item_id: it.id, student_id: sid, score: Math.round(it.max_score * pct) }));
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [...sc(a.id, 0.9), ...sc(b.id, 0.55)] }, { expect: 200 });
  // คุณลักษณะ: a ดีเยี่ยมทุกข้อ, b ผ่านทุกข้อ
  const trait = (sid, v) => Array.from({ length: 8 }, (_, i) => ({ student_id: sid, item_key: `trait_${i + 1}`, value: v }));
  await call("t1", "PUT", `/api/homeroom/assessments?${Q}`, { changes: [...trait(a.id, "3"), ...trait(b.id, "1")] }, { expect: 200 });
  // แบบบันทึก: ดื่มนม 2 ครั้ง, ตรวจสุขภาพ สะอาด 3 ไม่สะอาด 1
  await call("t1", "PUT", `/api/homeroom/logs?${Q}`, { changes: [
    { student_id: a.id, type: "milk", date: "2026-11-03", value: "1" }, { student_id: b.id, type: "milk", date: "2026-11-03", value: "1" },
    { student_id: a.id, type: "h_nail", date: "2026-11-w1", value: "ok" }, { student_id: a.id, type: "h_hair", date: "2026-11-w1", value: "ok" },
    { student_id: b.id, type: "h_nail", date: "2026-11-w1", value: "ok" }, { student_id: b.id, type: "h_hand", date: "2026-11-w1", value: "no" },
  ] }, { expect: 200 });

  // น้ำหนักส่วนสูง (อายุ ~9 ปี): a สมส่วน ส่วนสูงตามเกณฑ์ → สูงดีสมส่วน · b อ้วน · ครั้งที่ 2 ของ a ใช้แทนครั้งที่ 1
  await call("t1", "PUT", `/api/homeroom/body?${Q}`, { changes: [
    { student_id: a.id, round: 1, weight: 45, height: 135 }, { student_id: a.id, round: 2, weight: 30.4, height: 135 },
    { student_id: b.id, round: 1, weight: 60, height: 135 },
  ] }, { expect: 200 });
  await call("t1", "GET", "/api/sar", null, { expect: 403 });
  const d = (await call("admin", "GET", "/api/sar", null, { expect: 200 })).data;
  const m = d.metrics.basic;
  assert.deepEqual(m["area:ภาษาไทย"], { num: 1, den: 2 });
  assert.deepEqual(m.core3, { num: 1, den: 2 });
  assert.deepEqual(m.trait_good, { num: 1, den: 2 });
  assert.equal(m.trait_7.den, 2);
  assert.deepEqual(m.health_clean, { num: 3, den: 4 });
  assert.deepEqual(m.milk, { num: 2, den: kids.length }); // เฉพาะวันที่ห้องนี้บันทึกจริง (1 วัน) × นักเรียนที่มาเรียน — ไม่ใช่ทั้งปีทุกห้อง
  assert.deepEqual(m.nut_shape, { num: 1, den: 2 });
  assert.deepEqual(m.nut_height, { num: 2, den: 2 });
  assert.deepEqual(m.nut_good, { num: 1, den: 2 });
  assert.equal(m.brush, undefined); // ยังไม่มีใครบันทึกแปรงฟัน → ไม่คิด
  assert.equal(m.att80, undefined); // ยังไม่มีใครบันทึกขาด/ลา → ไม่คิด (ไม่ใช่ 100% ปลอม)
  assert.ok(d.grade_area.some((g) => g.grade_level === "ป.4" && g.learning_area === "ภาษาไทย" && g.den === 2));
  assert.ok(d.coverage.basic.students >= 2 && d.coverage.kinder.rooms >= 1);

  // ฝ่ายวัดผลตั้งค่าเป้าหมาย กรอกประเด็นที่ไม่มีข้อมูล และปรับเกณฑ์ระดับคุณภาพ
  await call("t1", "PUT", "/api/sar", { values: [{ item_key: "1.1.1", target: 80 }] }, { expect: 403 });
  await call("admin", "PUT", "/api/sar", { values: [{ item_key: "1.1.9", target: 80 }] }, { expect: 400 });
  await call("admin", "PUT", "/api/sar", { values: [{ item_key: "1.1.1", target: 120 }] }, { expect: 400 });
  const levels = [{ min: 85, label: "ยอดเยี่ยม" }, { min: 75, label: "ดีเลิศ" }, { min: 65, label: "ดี" }, { min: 50, label: "ปานกลาง" }, { min: 0, label: "กำลังพัฒนา" }];
  const u = (await call("admin", "PUT", "/api/sar", { values: [{ item_key: "1.1.1", target: 80 }, { item_key: "1.1.3", manual_value: 72.5, note: "โครงงานนวัตกรรม 29 จาก 40 คน" }], levels }, { expect: 200 })).data;
  assert.equal(u.values["1.1.1"].target, 80);
  assert.equal(u.values["1.1.3"].manual_value, 72.5);
  assert.deepEqual(u.levels, levels);
  const ev = evaluateSar(u.metrics, u.values, u.levels);
  assert.deepEqual([ev.items["1.1.1"].value, ev.items["1.1.1"].met], [50, false]);
  assert.equal(ev.items["1.1.3"].level, "ดี");
  // ล้างค่า
  await call("admin", "PUT", "/api/sar", { values: [{ item_key: "1.1.3", manual_value: "" }], levels: null }, { expect: 200 });
  const z = (await call("admin", "GET", "/api/sar", null, { expect: 200 })).data;
  assert.equal(z.values["1.1.3"].manual_value, null);
  assert.deepEqual(z.levels, DEFAULT_LEVELS);
});
