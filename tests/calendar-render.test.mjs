import test from "node:test";
import { CALENDAR_TYPES } from "../src/lib/calendar-types.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importantDaysBetween } from "../src/lib/thai-observances.js";
import { governmentHolidays } from "../src/lib/thai-holidays.js";

// ตรวจ HTML ของ renderer จริงด้วย DOM stub: เส้นทางครูและฝ่ายวัดผลใช้ renderer เดียวกัน
async function render({ editable = false, customHoliday = false, month = "2027-07", events = [] } = {}) {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, { innerHTML: "", dataset: {}, value: key === "calType" ? "holiday" : "", listeners: {}, querySelector: () => null, addEventListener(k, fn) { this.listeners[k] = fn; }, scrollIntoView() {}, focus() {} });
    return elements.get(key);
  };
  const source = readFileSync(new URL("../public/js/holiday-calendar.js", import.meta.url), "utf8")
    .replace(/^import .*;$/m, "").replace("export async function", "async function");
  const holidays = governmentHolidays(2027).map((h) => ({ holiday_date: h.date, name: h.name, gov: 1 }));
  if (customHoliday) holidays.push({ holiday_date: "2027-07-29", name: "หยุดตามประกาศโรงเรียน", gov: 0 });
  holidays.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  const data = { can_edit: editable, types: CALENDAR_TYPES, events, holidays, important_days: importantDaysBetween("2027-01-01", "2027-12-31"), terms: [{ term_number: 1, start_date: "2027-05-01", end_date: "2027-10-10" }], school_days: 100 };
  const calls = [];
  const renderer = new Function("api", "esc", "sessionStorage", "document", "window", "matchMedia", "toast", "showError", source + "; return renderHolidayCalendar;")(
    async (path, options) => { calls.push({path, ...options}); return options ? {added:1} : data; },
    (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    { getItem: () => month, setItem() {} },
    { getElementById: element },
    { addEventListener() {} }, () => ({matches:false}), () => {}, (err) => { throw err; },
  );
  const view = { innerHTML: "", querySelectorAll: () => [], querySelector: element };
  await renderer(view, "year=2", () => {});
  return { html: view.innerHTML, grid: element("calGrid").innerHTML, element, calls };
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

test("เทศกาลในปฏิทิน: วันกินเจ/สารทไทยแสดงร่วมกัน สีเหลือง วันตรุษจีนตรงเสาร์คงสีแดง", async () => {
  const sept = await render({ month: "2027-09" });
  const day = cell(sept.grid, "2027-09-30");
  assert.ok(day.classes.includes("important"));
  assert.ok(!day.classes.includes("hol"));
  assert.match(day.tag, /เทศกาลกินเจ/);
  assert.match(day.tag, /วันสารทไทย/);
  const feb = await render({ month: "2027-02" });
  assert.ok(cell(feb.grid, "2027-02-06").classes.includes("we"));
  assert.ok(!cell(feb.grid, "2027-02-06").classes.includes("important"));
  assert.match(cell(feb.grid, "2027-02-06").tag, /วันตรุษจีน/);
});


test("calendar editor uses all seven server categories, displays escaped details and saves non-holidays on weekends", async () => {
  const r = await render({ editable: true, events: [{id:1,event_date:"2027-07-02",name:'กิจกรรม <script>',category:"school_activity",description:'สถานที่ <img onerror=1>'}] });
  for (const t of CALENDAR_TYPES) assert.match(r.html, new RegExp(`value="${t.value}"`));
  assert.match(r.html,/calDescription/);assert.match(r.html,/กิจกรรม &lt;script>/);
  assert.ok(!r.html.includes('<img onerror=1>'));
  const grid=r.element("calGrid");
  grid.listeners.click({target:{closest:()=>({dataset:{d:"2027-07-04"}})}});
  r.element("calType").value="festival";r.element("calType").onchange();
  assert.equal(r.element("calSave").disabled,false);
  assert.match(r.element("calEffect").textContent,/แสดงเฉพาะปฏิทิน/);
  r.element("calName").value="เทศกาลทดสอบ";r.element("calDescription").value="รายละเอียด";
  await r.element("calSave").onclick();
  const req=r.calls.find(x=>x.method==="POST");
  assert.deepEqual(req.body,{from:"2027-07-04",to:"2027-07-04",name:"เทศกาลทดสอบ",category:"festival",description:"รายละเอียด"});
});

test("calendar-only activities appear beside holidays without changing red holiday cells", async () => {
  const {grid,html}=await render({events:[{id:1,event_date:"2027-07-28",name:"งานโรงเรียน",category:"school_activity",description:"ห้องประชุม"},{id:2,event_date:"2027-07-02",name:"งานเปิดเรียน",category:"festival",description:""}]});
  assert.ok(cell(grid,"2027-07-28").classes.includes("hol"));
  assert.match(cell(grid,"2027-07-28").tag,/งานโรงเรียน/);
  assert.ok(cell(grid,"2027-07-02").classes.includes("important"));
  assert.ok(!cell(grid,"2027-07-02").classes.includes("hol"));
  assert.match(html,/ห้องประชุม/);
});


test("attendance screen shows holidays as non-editable columns and normal school days remain editable", async () => {
  const { logColumns } = await import("../public/js/logbook-data.js");
  const source = readFileSync(new URL("../public/js/homeroom.js", import.meta.url), "utf8");
  const start=source.indexOf("async function renderAttendance()"), end=source.indexOf("  const go = async",start);
  const renderSource=source.slice(start,end)+"};return renderAttendance;";
  const view={innerHTML:""};
  const attData={month:"2026-11",months:["2026-11"],days:["2026-11-02","2026-11-04"],today:"2026-11-04",terms:[{term_number:2,start_date:"2026-11-02",end_date:"2026-11-04"}],holidays:[{holiday_date:"2026-11-03",name:"หยุดกิจกรรม"}],records:{1:{"2026-11-04":"ข"}}};
  const renderer=new Function("view","api","termMonth","monthsOfTerm","inTermDay","logColumns","data","esc",`
    let attMonth="2026-11",att; const q="",me={},T=2,ATT={"ข":"ขาด"},WD=["อา.","จ.","อ.","พ.","พฤ.","ศ.","ส."],monthName=x=>x,grade="ป.4",room="1";
    ${renderSource}`)(view,async()=>structuredClone(attData),x=>x,x=>x,()=>true,logColumns,{students:[{id:1,number:1,name:"เด็กทดสอบ",enrollment_status:"enrolled"}]},x=>String(x));
  await renderer();
  assert.match(view.innerHTML,/class="log-off" title="หยุดกิจกรรม"/);
  assert.ok(!view.innerHTML.includes('data-date="2026-11-03"'));
  assert.match(view.innerHTML,/data-date="2026-11-04" value="ข"/);
  assert.match(view.innerHTML,/data-date="2026-11-02"/);
});
