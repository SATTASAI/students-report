// สาระ/มาตรฐาน ป.4–6 (หลักสูตรรวม-69): ตัวชี้วัดในคลังทุกข้อที่มีรหัสต้องหามาตรฐานและสาระเจอ
import test from "node:test";
import assert from "node:assert/strict";
import BANK from "../src/data/indicator-bank-2569.js";
import { standardOf } from "../src/lib/standards.js";

test("ตัวชี้วัด ป.4–6 ทุกข้อมีสาระและข้อความมาตรฐาน", () => {
  const coded = BANK.rows.filter((r) => /ป\.\d\/\d+/.test(r[2]));
  assert.ok(coded.length > 500);
  for (const r of coded) {
    const s = standardOf(r[1], r[2]);
    assert.ok(s.std_text && s.strand, `${r[1]} ${r[2]} ไม่มีมาตรฐาน/สาระ`);
  }
  assert.deepEqual(standardOf("ภาษาไทย", "ท 4.1 ป.4/2"), { std: "ท 4.1", std_text: "เข้าใจธรรมชาติของภาษาและหลักภาษาไทย การเปลี่ยนแปลงของภาษาและพลังของภาษา ภูมิปัญญาของภาษา และรักษาภาษาไทยไว้เป็นสมบัติของชาติ", strand: "สาระที่ 4 หลักการใช้ภาษาไทย" });
  assert.deepEqual(standardOf("ภาษาไทย", "ผลลัพธ์ข้อ 1"), {});
});

test("ประเภทตัวชี้วัดในคลังมีแค่ ระหว่างทาง / ปลายทาง / ผลการเรียนรู้", () => {
  const kinds = new Set(BANK.rows.map((r) => r[5]));
  assert.deepEqual([...kinds].sort(), ["ปลายทาง", "ผลการเรียนรู้", "ระหว่างทาง"].sort());
});
