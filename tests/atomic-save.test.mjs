// บันทึกคะแนนแบบทั้งชุด (atomic) และกันการส่งผลด้วยข้อมูลที่เปลี่ยนไประหว่างตรวจ — gr-22
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { guardedBatch, batchAll, HttpError } from "../src/lib/http.js";

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
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"], ["t2", "teacher2@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie").split(";")[0];
  }
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.4"] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const c = courses.find((x) => x.code === "ท14101");
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2, 3] }, { expect: 200 });
  return { env, call, c };
}

const rev = async (env, id) => (await env.DB.prepare("SELECT data_rev FROM gr_courses WHERE id = ?").bind(id).first()).data_rev;

test("บันทึกคะแนนทั้งตาราง (หลายร้อยช่อง) ในครั้งเดียว แล้วลบทั้งหมดได้ คะแนนแก้ตัวไม่หาย", async () => {
  const { env, call, c } = await setup();
  // 20 ช่องระหว่างภาค + สอบ = 21 ช่อง × นักเรียนทั้งห้อง
  const items = [...Array.from({ length: 20 }, (_, i) => ({ term_number: 2, kind: "indicator", title: `ตัวชี้วัด ${i + 1}`, max_score: 1.75 })),
    { term_number: 2, kind: "final", title: "สอบ", max_score: 15 }];
  const d = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items }, { expect: 200 })).data;
  const s = d.students.filter((x) => x.enrollment_status === "enrolled");
  const all = s.flatMap((x) => d.items.map((it) => ({ item_id: it.id, student_id: x.id, score: it.kind === "final" ? 10 : 1.5 })));
  assert.ok(all.length >= 200, `ทดสอบด้วย ${all.length} ช่อง`);
  const before = await rev(env, c.id);
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: all }, { expect: 200 });
  assert.equal(await rev(env, c.id), before + 1, "บันทึกหนึ่งครั้ง = เลขรุ่นเพิ่ม 1");
  let n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores WHERE item_id IN (SELECT id FROM gr_items WHERE course_id = ?) AND score IS NOT NULL").bind(c.id).first();
  assert.equal(n.n, all.length);
  // คะแนนแก้ตัวของคนแรก แล้วลบคะแนนทั้งตาราง → แถวที่มีคะแนนแก้ตัวยังอยู่ (score = NULL)
  const ind = d.items[0];
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: s[0].id, score: 0.5 }] }, { expect: 200 });
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: s[0].id, remedial: 1 }] }, { expect: 200 });
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: all.map((x) => ({ ...x, score: null })) }, { expect: 200 });
  n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores WHERE item_id IN (SELECT id FROM gr_items WHERE course_id = ?)").bind(c.id).first();
  assert.equal(n.n, 1, "เหลือเฉพาะแถวที่มีคะแนนแก้ตัว");
  const kept = await env.DB.prepare("SELECT score, remedial FROM gr_scores WHERE item_id = ? AND student_id = ?").bind(ind.id, s[0].id).first();
  assert.deepEqual({ ...kept }, { score: null, remedial: 1 });
});

test("ชุดคะแนนที่มีช่องผิด → ไม่บันทึกเลยแม้แต่ช่องที่ถูก", async () => {
  const { env, call, c } = await setup();
  const d = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [{ term_number: 2, kind: "indicator", title: "อ่าน", max_score: 35 }, { term_number: 2, kind: "final", title: "สอบ", max_score: 15 }] }, { expect: 200 })).data;
  const [ind, fin] = d.items, sid = d.students[0].id;
  const r = await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: ind.id, student_id: sid, score: 20 }, { item_id: fin.id, student_id: sid, score: 99 }] }, { expect: 400 });
  assert.equal(r.data.errors.length, 1);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores WHERE student_id = ?").bind(sid).first();
  assert.equal(n.n, 0);
});

test("guardedBatch: สถานะเปลี่ยนระหว่างทาง → ยกเลิกทั้งชุดและตอบ 409", async () => {
  const { env, c } = await setup();
  await env.DB.prepare("UPDATE gr_courses SET locked = 1 WHERE id = ?").bind(c.id).run();
  const write = env.DB.prepare("UPDATE gr_courses SET return_note = 'ไม่ควรถูกบันทึก' WHERE id = ?").bind(c.id);
  await assert.rejects(
    guardedBatch(env, [{ sql: "SELECT 1 FROM gr_courses WHERE id = ? AND locked IS NOT ?", values: [c.id, 0] }], [write], "เปลี่ยนแล้ว"),
    (e) => e instanceof HttpError && e.status === 409 && e.message === "เปลี่ยนแล้ว");
  const row = await env.DB.prepare("SELECT return_note FROM gr_courses WHERE id = ?").bind(c.id).first();
  assert.equal(row.return_note, null);
  const g = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_guard").first();
  assert.equal(g.n, 0, "ไม่มีแถวค้างในตารางกันชน");
  // เงื่อนไขยังเหมือนเดิม → บันทึกตามปกติ
  await guardedBatch(env, [{ sql: "SELECT 1 FROM gr_courses WHERE id = ? AND locked IS NOT ?", values: [c.id, 1] }], [write], "เปลี่ยนแล้ว");
  assert.equal((await env.DB.prepare("SELECT return_note FROM gr_courses WHERE id = ?").bind(c.id).first()).return_note, "ไม่ควรถูกบันทึก");
});

test("batchAll: ไม่เกิน 500 คำสั่งเป็น transaction เดียว — คำสั่งท้ายผิด คำสั่งก่อนหน้าไม่ถูกบันทึก", async () => {
  const { env } = await setup();
  const stmts = Array.from({ length: 300 }, (_, i) => env.DB.prepare("INSERT INTO gr_audit (user_id, action, detail) VALUES (?, 'atomic.test', ?)").bind(1, String(i)));
  stmts.push(env.DB.prepare("INSERT INTO gr_audit (user_id, action) VALUES (1, NULL)")); // action NOT NULL → ล้ม
  await assert.rejects(batchAll(env, stmts));
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_audit WHERE action = 'atomic.test'").first();
  assert.equal(n.n, 0);
});

test("ครูอีกคนบันทึกคะแนนระหว่างที่ครูกำลังยืนยันส่งผล → ระบบไม่ส่ง ให้ตรวจใหม่", async () => {
  const { env, call, c } = await setup();
  const d = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [{ term_number: 2, kind: "indicator", title: "อ่าน", max_score: 35 }, { term_number: 2, kind: "final", title: "สอบ", max_score: 15 }] }, { expect: 200 })).data;
  const [ind, fin] = d.items;
  const s = d.students.filter((x) => x.enrollment_status === "enrolled");
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: s.flatMap((x) => [{ item_id: ind.id, student_id: x.id, score: 30 }, { item_id: fin.id, student_id: x.id, score: 12 }]) }, { expect: 200 });
  // ครู 1 กดส่ง → ระบบให้ตรวจรายการก่อน (ภาค 1 ยังไม่มีคะแนน)
  const check = (await call("t1", "POST", `/api/courses/${c.id}/submit`, {}, { expect: 409 })).data;
  assert.equal(typeof check.data_rev, "number");
  // ระหว่างที่ครู 1 อ่านรายการ ครู 2 แก้คะแนน
  await call("t2", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: fin.id, student_id: s[0].id, score: 0 }] }, { expect: 200 });
  // ครู 1 กดยืนยันจากรายการเดิม → ไม่ส่ง
  const stale = await call("t1", "POST", `/api/courses/${c.id}/submit`, { force: true, expect_rev: check.data_rev }, { expect: 409 });
  assert.match(stale.data.error, /ตรวจอีกครั้ง/);
  assert.equal((await env.DB.prepare("SELECT locked FROM gr_courses WHERE id = ?").bind(c.id).first()).locked, 0);
  // ตรวจใหม่แล้วยืนยัน → ส่งได้
  const again = (await call("t1", "POST", `/api/courses/${c.id}/submit`, {}, { expect: 409 })).data;
  assert.equal(again.data_rev, check.data_rev + 1);
  const ok = (await call("t1", "POST", `/api/courses/${c.id}/submit`, { force: true, expect_rev: again.data_rev }, { expect: 200 })).data;
  assert.equal(ok.course.status, "submitted");
  // ส่งซ้ำซ้อน (อีกแท็บ) ไม่ทำให้สถานะเพี้ยน: ล็อกแล้วบันทึก/ส่งไม่ได้
  await call("t2", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: fin.id, student_id: s[0].id, score: 5 }] }, { expect: 409 });
});

test("ฝ่ายวัดผลแก้รายวิชาที่ส่งแล้ว: ยังบันทึกได้ และเพิ่มเลขรุ่นข้อมูล", async () => {
  const { env, call, c } = await setup();
  const d = (await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [{ term_number: 2, kind: "indicator", title: "อ่าน", max_score: 35 }, { term_number: 2, kind: "final", title: "สอบ", max_score: 15 }] }, { expect: 200 })).data;
  const [ind, fin] = d.items;
  const s = d.students.filter((x) => x.enrollment_status === "enrolled");
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: s.flatMap((x) => [{ item_id: ind.id, student_id: x.id, score: 30 }, { item_id: fin.id, student_id: x.id, score: 12 }]) }, { expect: 200 });
  await call("t1", "POST", `/api/courses/${c.id}/submit`, { force: true }, { expect: 200 });
  const before = await rev(env, c.id);
  await call("admin", "PUT", `/api/courses/${c.id}/scores`, { changes: [{ item_id: fin.id, student_id: s[0].id, score: 13 }] }, { expect: 200 });
  assert.equal(await rev(env, c.id), before + 1);
  assert.equal((await env.DB.prepare("SELECT score FROM gr_scores WHERE item_id = ? AND student_id = ?").bind(fin.id, s[0].id).first()).score, 13);
});
