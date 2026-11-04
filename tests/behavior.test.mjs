// คะแนนพฤติกรรม (repo publicservice) → กิจกรรมเพื่อสังคมและสาธารณประโยชน์ ใน ปพ.6
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "../dev/server.mjs";
import { assessmentsFor, behaviorScores } from "../src/lib/data.js";
import { ensureSchema } from "../src/lib/schema.js";

test("ยังไม่มีตาราง ps_behavior_records = ไม่กระทบผลกิจกรรม", async () => {
  const env = await makeEnv();
  await ensureSchema(env);
  assert.deepEqual(await behaviorScores(env, 1, [1, 2]), {});
  assert.deepEqual(await assessmentsFor(env, 1, [1]), {});
});

test("คะแนนพฤติกรรมต่ำกว่า 50 ในภาคใด = กิจกรรมเพื่อสังคมฯ ภาคนั้นไม่ผ่าน (ยกเลิกแล้วไม่นับ, ไม่เกิน 100)", async () => {
  const env = await makeEnv();
  await ensureSchema(env);
  env.DB.exec(`CREATE TABLE ps_behavior_records (id INTEGER PRIMARY KEY, academic_year_id INTEGER, term_number INTEGER, student_id INTEGER,
    points INTEGER, reason TEXT, incident_date TEXT, created_by INTEGER, created_at TEXT, cancelled_at TEXT, cancelled_by INTEGER, cancel_reason TEXT);
    INSERT INTO ps_behavior_records (academic_year_id, term_number, student_id, points, reason, cancelled_at) VALUES
      (1, 2, 1, -30, 'a', NULL), (1, 2, 1, -21, 'b', NULL),
      (1, 1, 2, -50, 'c', NULL), (1, 1, 2, -30, 'd', datetime('now')),
      (1, 1, 3, 20, 'e', NULL), (1, 1, 3, -60, 'f', NULL)`);
  assert.deepEqual(await behaviorScores(env, 1, [1, 2, 3]), { 1: { 2: 49 }, 2: { 1: 50 }, 3: { 1: 40 } });
  const a = await assessmentsFor(env, 1, [1, 2, 3]);
  assert.equal(a[1].act_social_o2, "มผ");
  assert.equal(a[1].act_social_o1, undefined);
  assert.equal(a[2]?.act_social_o1, undefined); // 50 = ผ่าน
  assert.equal(a[3].act_social_o1, "มผ"); // บวกเกิน 100 ไม่สะสม: 100 → 40
});
