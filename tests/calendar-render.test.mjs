import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importantDaysBetween } from "../src/lib/thai-observances.js";
import { governmentHolidays } from "../src/lib/thai-holidays.js";

// ตรวจ HTML ของ renderer จริงด้วย DOM stub: เส้นทางครูและฝ่ายวัดผลใช้ renderer เดียวกัน
async function render({ editable = false, customHoliday = false } = {}) {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, { innerHTML: "", dataset: {}, querySelector: () => null, addEventListener() {}, scrollIntoView() {} });
    return elements.get(key);
  };
  const source = readFileSync(new URL("../public/js/holiday-calendar.js", import.meta.url), "utf8")
    .replace(/^import .*;$/m, "").replace("export async function", "async function");
  const holidays = governmentHolidays(2027).map((h) => ({ holiday_date: h.date, name: h.name, gov: 1 }));
  if (customHoliday) holidays.push({ holiday_date: "2027-07-29", name: "หยุดตามประกาศโรงเรียน", gov: 0 });
  holidays.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  const data = { can_edit: editable, holidays, important_days: importantDaysBetween("2027-01-01", "2027-12-31"), terms: [{ term_number: 1, start_date: "2027-05-01", end_date: "2027-10-10" }], school_days: 100 };
  const renderer = new Function("api", "esc", "sessionStorage", "document", source + "; return renderHolidayCalendar;")(
    async () => data,
    (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    { getItem: () => "2027-07", setItem() {} },
    { getElementById: element },
  );
  const view = { innerHTML: "", querySelectorAll: () => [], querySelector: element };
  await renderer(view, "year=2", () => {});
  return { html: view.innerHTML, grid: element("calGrid").innerHTML };
}

function cell(grid, date) {
  const tag = grid.match(new RegExp(`<[^>]+data-d="${date}"[^>]*>`))?.[0];
  assert.ok(tag, date);
  return { classes: tag.match(/class="([^"]*)"/)[1].split(" "), tag };
}

test("ปฏิทินครู: วันสำคัญมี class สีเหลือง วันหยุดราชการและเสาร์อาทิตย์ใช้สีแดง", async () => {
  const { html, grid } = await render();
  assert.ok(cell(grid, "2027-07-29").classes.includes("important"));
  assert.ok(cell(grid, "2027-07-01").classes.includes("important"));
  assert.ok(cell(grid, "2027-07-28").classes.includes("hol"));
  assert.ok(!cell(grid, "2027-07-28").classes.includes("important"));
  assert.ok(cell(grid, "2027-07-03").classes.includes("we"));
  assert.match(cell(grid, "2027-07-29").tag, /วันภาษาไทยแห่งชาติ/);
  assert.match(html, /วันสำคัญที่ไม่ใช่วันหยุด/);
});

test("วันสำคัญตรงวันหยุดโรงเรียน: ใช้สีแดงและยังแสดงชื่อวันสำคัญ", async () => {
  const { grid } = await render({ customHoliday: true });
  const day = cell(grid, "2027-07-29");
  assert.ok(day.classes.includes("hol"));
  assert.ok(!day.classes.includes("important"));
  assert.match(day.tag, /หยุดตามประกาศโรงเรียน/);
  assert.match(day.tag, /วันภาษาไทยแห่งชาติ/);
});
