import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { logColumns } from "../public/js/logbook-data.js";

// Exercise the actual page renderer, including its calendar helper, without a browser.
async function render({ end = "2026-07-31", allHoliday = false } = {}) {
  const terms = [{ term_number: 1, start_date: "2026-07-01", end_date: end }];
  const days = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`)
    .filter((d) => d <= end && ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && d !== "2026-07-15");
  const holidays = [{ holiday_date: "2026-07-15", name: 'หยุด <ทดสอบ> "โรงเรียน"' }];
  if (allHoliday) for (const d of days) holidays.push({ holiday_date: d, name: "วันหยุดโรงเรียน" });
  const sheet = { month: "2026-07", months: ["2026-07"], days: allHoliday ? [] : days, terms, holidays,
    today: "2026-07-03", records: { 1: { "2026-07-03": "ข", "2026-07-04": "ข", "2026-07-15": "ข" } } };
  const source = readFileSync(new URL("../public/js/homeroom.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("async function renderAttendance()"), source.lastIndexOf("\nrenderTabs();"));
  const view = { innerHTML: "" };
  const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const run = new Function("view", "api", "logColumns", "esc", "document", `
    let att, attMonth;
    const q = '', grade = 'ป.4', room = '1', me = {}, T = 1;
    const termMonth = m => m, monthsOfTerm = m => m, monthName = m => m;
    const inTermDay = d => d >= '${terms[0].start_date}' && d <= '${end}';
    const WD = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
    const ATT = { 'ข': 'ขาด', 'ล': 'ลา', 'ป': 'ป่วย', 'ส': 'สาย' };
    const data = { students: [{ id: 1, name: 'นักเรียนหนึ่ง', number: 1, enrollment_status: 'enrolled' }, { id: 2, name: 'นักเรียนสอง', number: 2, enrollment_status: 'enrolled' }] };
    ${fn}
    return renderAttendance();
  `);
  await run(view, async () => sheet, logColumns, esc, { getElementById: (id) => id === "sheet" ? null : {} });
  return view.innerHTML;
}

test("attendance shows all dates, red weekends and named holidays without editable holiday cells", async () => {
  const html = await render();
  assert.equal([...html.matchAll(/<th class="col-head att-day /g)].length, 31);
  assert.equal([...html.matchAll(/<th class="col-head att-day log-off/g)].length, 9);
  assert.match(html, /<td class="log-off" rowspan="2"[^>]*><span>วันเสาร์<\/span>/);
  assert.match(html, /<td class="log-off" rowspan="2"[^>]*><span>วันอาทิตย์<\/span>/);
  assert.match(html, /หยุด &lt;ทดสอบ&gt; &quot;โรงเรียน&quot;/);
  assert.doesNotMatch(html, /<input data-date="2026-07-(04|05|15)"/);
  assert.match(html, /<input data-date="2026-07-03" value="ข"/);
  // Old records on dates subsequently marked as holidays must not inflate the monthly total.
  assert.match(html, /data-n="ข">1<\/td>/);
});

test("attendance excludes dates outside the selected term", async () => {
  const html = await render({ end: "2026-07-10" });
  assert.equal([...html.matchAll(/<th class="col-head att-day /g)].length, 10);
  assert.doesNotMatch(html, /data-date="2026-07-13"/);
});

test("a month with no school days still displays its holiday columns", async () => {
  const html = await render({ allHoliday: true });
  assert.equal([...html.matchAll(/<th class="col-head att-day log-off/g)].length, 31);
  assert.doesNotMatch(html, /<input data-date=/);
  assert.match(html, /id="sheet"/);
});
