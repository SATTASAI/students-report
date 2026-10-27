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
  assert.deepEqual(list.map((d) => d.date), list.map((d) => d.date).sort());
  const holidays = new Set(governmentHolidays(2027).map((d) => d.date));
  assert.ok(list.every((d) => !holidays.has(d.date))); // วันสำคัญไม่ถูกเพิ่มเป็นวันหยุดราชการ
  assert.ok(!holidays.has("2027-01-18")); // ไม่มีการชดเชยวันครูอัตโนมัติ
});

test("เทศกาลปี 2570: วันที่จีนตรงตาราง HKO และกินเจครบ 9 วันข้ามเดือน", () => {
  const list = importantDaysBetween("2027-01-01", "2027-12-31");
  const dateOf = (name) => list.find((d) => d.name === name)?.date;
  for (const [name, date] of [
    ["วันจ่าย (ตรุษจีน)", "2027-02-04"], ["วันไหว้ (ตรุษจีน)", "2027-02-05"],
    ["วันตรุษจีน", "2027-02-06"], ["เทศกาลโคมไฟ (หยวนเซียว)", "2027-02-20"],
    ["วันเช็งเม้ง", "2027-04-05"], ["เทศกาลไหว้บ๊ะจ่าง", "2027-06-09"],
    ["วันสารทจีน", "2027-08-16"], ["วันไหว้พระจันทร์", "2027-09-15"],
    ["วันสารทไทย", "2027-09-30"], ["วันตักบาตรเทโว", "2027-10-16"],
    ["วันวาเลนไทน์", "2027-02-14"], ["วันฮาโลวีน", "2027-10-31"],
    ["วันคริสต์มาสอีฟ", "2027-12-24"],
  ]) assert.equal(dateOf(name), date, name);
  assert.deepEqual(list.filter((d) => d.name.startsWith("เทศกาลกินเจ")).map((d) => d.date), [
    "2027-09-30", "2027-10-01", "2027-10-02", "2027-10-03", "2027-10-04",
    "2027-10-05", "2027-10-06", "2027-10-07", "2027-10-08",
  ]);
  assert.equal(list.filter((d) => d.date === "2027-09-30").length, 2); // วันเดียวมีทั้งกินเจและสารทไทย
});

test("เทศกาลไม่ตรึงวันที่ปีก่อน: ปี 2569–2571 และกรองช่วงตรงปลาย", () => {
  const dates = (year, name) => importantDaysBetween(`${year}-01-01`, `${year}-12-31`).filter((d) => d.name === name).map((d) => d.date);
  assert.deepEqual(dates(2026, "วันตรุษจีน"), ["2026-02-17"]);
  assert.deepEqual(dates(2027, "วันตรุษจีน"), ["2027-02-06"]);
  assert.deepEqual(dates(2028, "วันตรุษจีน"), ["2028-01-26"]);
  assert.deepEqual(dates(2028, "เทศกาลไหว้บ๊ะจ่าง"), ["2028-05-28"]); // เดือน 5 แรก ไม่ใช่เดือน 5 อธิกมาส
  assert.deepEqual(dates(2028, "วันเช็งเม้ง"), ["2028-04-04"]);
  assert.deepEqual(dates(2028, "วันไหว้พระจันทร์"), ["2028-10-03"]);
  assert.deepEqual(importantDaysBetween("2027-02-05", "2027-02-06"), [
    { date: "2027-02-05", name: "วันไหว้ (ตรุษจีน)" }, { date: "2027-02-06", name: "วันตรุษจีน" },
  ]);
  assert.equal(importantDaysBetween("2026-11-01", "2027-03-31").filter((d) => d.name === "วันตรุษจีน").length, 1);
  assert.deepEqual(dates(2029, "วันตรุษจีน"), []); // ไม่เดาวันจีนในปีที่ยังไม่มีแหล่งข้อมูลยืนยัน
});

test("กรองตามช่วงปีการศึกษา ข้ามปี และวันเด็กเปลี่ยนวันที่ทุกปี", () => {
  const days = importantDaysBetween("2026-11-01", "2027-03-31");
  assert.equal(days.find((d) => d.name === "วันลอยกระทง").date, "2026-11-24");
  assert.equal(days.find((d) => d.name === "วันเด็กแห่งชาติ").date, "2027-01-09");
  assert.deepEqual(importantDaysBetween("2027-07-29", "2027-07-29"), [{ date: "2027-07-29", name: "วันภาษาไทยแห่งชาติ" }]);
  assert.equal(importantDaysBetween("2026-01-01", "2026-01-31").find((d) => d.name === "วันเด็กแห่งชาติ").date, "2026-01-10");
});
