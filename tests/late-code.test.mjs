// gr-18: รหัสมาสาย "มส" → "ส" (มส ใช้เฉพาะ หมดสิทธิ์สอบ) — ย้ายข้อมูลเดิมให้เอง
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "../dev/server.mjs";
import { migrateLateCode } from "../src/lib/schema.js";

test("ย้ายรหัสมาสายเดิม มส → ส และตารางใหม่ไม่รับ มส", async () => {
  const env = await makeEnv();
  // จำลองฐานข้อมูลรุ่นเก่า (CHECK ยังเป็น มส)
  await env.DB.prepare("DROP TABLE IF EXISTS gr_attendance").run();
  await env.DB.prepare(`CREATE TABLE gr_attendance (academic_year_id INTEGER NOT NULL, student_id INTEGER NOT NULL, att_date TEXT NOT NULL,
    code TEXT NOT NULL CHECK (code IN ('ข','ล','ป','มส')), recorded_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (student_id, att_date))`).run();
  await env.DB.prepare("INSERT INTO gr_attendance (academic_year_id, student_id, att_date, code) VALUES (1,1,'2026-11-03','มส'), (1,1,'2026-11-04','ข'), (1,2,'2026-11-03','ป')").run();
  await migrateLateCode(env);
  const { results } = await env.DB.prepare("SELECT student_id, att_date, code FROM gr_attendance ORDER BY student_id, att_date").all();
  assert.deepEqual(results.map((r) => r.code), ["ส", "ข", "ป"]);
  await assert.rejects(env.DB.prepare("INSERT INTO gr_attendance (academic_year_id, student_id, att_date, code) VALUES (1,3,'2026-11-03','มส')").run());
  await migrateLateCode(env); // ทำซ้ำไม่มีผล
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_attendance").first()).n, 3);
});
