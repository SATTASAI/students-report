import test from "node:test";
import assert from "node:assert/strict";
import { parseIndicatorLines } from "../public/js/indicators.js";

test("แยกรหัสตัวชี้วัดจากข้อความที่วางจากหลักสูตร", () => {
  const rows = parseIndicatorLines(`ท 1.1 ป.1/1 ออกเสียงคำ คำคล้องจอง
1. ค 1.1 ป.1/2 เปรียบเทียบจำนวนนับ

ท ๑.๑ ป.๑/๓ ตอบคำถามจากเรื่องที่อ่าน
งานกลุ่มประดิษฐ์ของเล่น`);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { code: "ท 1.1 ป.1/1", title: "ออกเสียงคำ คำคล้องจอง" });
  assert.equal(rows[1].code, "ค 1.1 ป.1/2");
  assert.equal(rows[2].code, "ท ๑.๑ ป.๑/๓");
  assert.deepEqual(rows[3], { code: "", title: "งานกลุ่มประดิษฐ์ของเล่น" });
});
