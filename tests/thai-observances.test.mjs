import test from "node:test";
import assert from "node:assert/strict";
import { importantDaysBetween } from "../src/lib/thai-observances.js";
import { governmentHolidays } from "../src/lib/thai-holidays.js";

test("วันสำคัญปี 2570: วันเด็ก วันครู วันภาษาไทย และวันตามจันทรคติ", () => {
  const list = importantDaysBetween("2027-01-01", "2027-12-31");
  const days = Object.fromEntries(list.map((d) => [d.date, d.name]));
  assert.equal(days["2027-01-09"], "วันเด็กแห่งชาติ");
  assert.equal(days["2027-01-16"], "วันครู");
  assert.equal(days["2027-06-26"], "วันสุนทรภู่ / วันต่อต้านยาเสพติดโลก");
  assert.equal(days["2027-07-29"], "วันภาษาไทยแห่งชาติ");
  assert.equal(days["2027-08-18"], "วันวิทยาศาสตร์แห่งชาติ");
  assert.equal(days["2027-10-15"], "วันออกพรรษา");
  assert.equal(days["2027-11-13"], "วันลอยกระทง");
  assert.equal(days["2027-12-25"], "วันคริสต์มาส");
  assert.deepEqual(list.map((d) => d.date), Object.keys(days).sort());
  const holidays = new Set(governmentHolidays(2027).map((d) => d.date));
  assert.ok(list.every((d) => !holidays.has(d.date))); // วันสำคัญไม่ถูกเพิ่มเป็นวันหยุดราชการ
  assert.ok(!holidays.has("2027-01-18")); // ไม่มีการชดเชยวันครูอัตโนมัติ
});

test("กรองตามช่วงปีการศึกษา ข้ามปี และวันเด็กเปลี่ยนวันที่ทุกปี", () => {
  const days = importantDaysBetween("2026-11-01", "2027-03-31");
  assert.equal(days.find((d) => d.name === "วันลอยกระทง").date, "2026-11-24");
  assert.equal(days.find((d) => d.name === "วันเด็กแห่งชาติ").date, "2027-01-09");
  assert.deepEqual(importantDaysBetween("2027-07-29", "2027-07-29"), [{ date: "2027-07-29", name: "วันภาษาไทยแห่งชาติ" }]);
  assert.equal(importantDaysBetween("2026-01-01", "2026-01-31").find((d) => d.name === "วันเด็กแห่งชาติ").date, "2026-01-10");
});
