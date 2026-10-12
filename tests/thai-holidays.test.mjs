// วันหยุดราชการที่ระบบคำนวณเอง เทียบกับวันที่ประกาศจริง
import test from "node:test";
import assert from "node:assert/strict";
import { buddhistHolidays, governmentHolidays } from "../src/lib/thai-holidays.js";

test("วันพระใหญ่ตามจันทรคติ ตรงกับวันหยุดที่ประกาศจริง 2566–2569 (รวมปีอธิกมาส)", () => {
  const want = {
    2023: ["2023-03-06", "2023-06-03", "2023-08-01", "2023-08-02"], // อธิกมาส
    2024: ["2024-02-24", "2024-05-22", "2024-07-20", "2024-07-21"],
    2025: ["2025-02-12", "2025-05-11", "2025-07-10", "2025-07-11"],
    2026: ["2026-03-03", "2026-05-31", "2026-07-29", "2026-07-30"], // อธิกมาส
  };
  for (const [y, v] of Object.entries(want)) {
    const b = buddhistHolidays(Number(y));
    assert.deepEqual([b.makha, b.visakha, b.asalha, b.lent], v, y);
  }
});

test("วันหยุดชดเชย: เสาร์/อาทิตย์ → วันทำการถัดไป, ข้ามปีได้, เข้าพรรษาไม่ชดเชย, สงกรานต์ชดเชย 1 วัน", () => {
  const dates = (y) => governmentHolidays(y).map((h) => h.date);
  const d24 = dates(2024), d26 = dates(2026), d18 = dates(2018);
  for (const d of ["2024-01-02", "2024-02-26", "2024-04-08", "2024-04-16", "2024-05-06", "2024-07-22", "2024-07-29", "2024-10-14"]) assert.ok(d24.includes(d), d);
  assert.ok(!d24.includes("2024-04-17") && !d24.includes("2024-07-23"));
  for (const d of ["2026-06-01", "2026-12-07"]) assert.ok(d26.includes(d), d);
  assert.ok(d18.includes("2018-04-16") && !d18.includes("2018-04-17") && d18.includes("2018-07-30"));
  const jun23 = governmentHolidays(2023).filter((h) => h.date.startsWith("2023-06"));
  assert.equal(jun23.filter((h) => h.date === "2023-06-03").length, 1); // 2 วันสำคัญวันเดียวกัน = รายการเดียว ชดเชย 1 วัน
  assert.equal(jun23.filter((h) => /ชดเชย/.test(h.name)).length, 1);
  assert.ok(governmentHolidays(2026).every((h) => !/พืชมงคล|แรงงาน/.test(h.name)));
});
