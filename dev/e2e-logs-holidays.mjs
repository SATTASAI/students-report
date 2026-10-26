// บันทึกประจำวัน 4 แบบ: ตารางมีวันเสาร์ อาทิตย์ และวันหยุดเป็นคอลัมน์สีแดง (หน้าจอ + หน้าพิมพ์) · ตรวจสุขภาพไม่เปลี่ยน
// node dev/e2e-logs-holidays.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน — ข้อมูลสะอาด)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };
const browser = await chromium.launch();

async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "th-TH" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
  await page.goto(`${BASE}/login.html`);
  const form = (await page.locator("#loginForm").count()) ? "#loginForm " : "";
  await page.fill(`${form}input[name=email]`, email);
  await page.fill(`${form}input[name=password]`, "test-password-1");
  await page.click(form ? "#loginForm button.primary" : "#go");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForSelector("#main:not([hidden])");
  return page;
}
const api = (page, path, method = "GET", body) => page.evaluate(async ([path, method, body]) => {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + " " + JSON.stringify(j)); return j;
}, [path, method, body]);

const admin = await login("admin@test.local");
await api(admin, "/api/admin/import/homerooms", "POST", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] });
await api(admin, "/api/calendar", "POST", { from: "2026-07-15", name: "หยุดทดสอบ" });
const t = await login("teacher1@test.local");
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;

for (const [type, month] of [["milk", "2026-07"], ["duty", "2026-10"]]) {
  const d = await api(t, `/api/homeroom/logs?year=1&${Q}&type=${type}&month=${month}`);
  const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const inTerm = (iso) => d.terms.some((x) => iso >= x.start_date && iso <= x.end_date);
  const cols = Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter(inTerm);
  const offs = cols.filter((c) => !d.days.includes(c));
  // หน้าจอ
  await t.goto(`${BASE}/logs.html?term=${month < "2026-11" ? 1 : 2}`);
  await t.waitForSelector("#mSel");
  await t.click(`.log-forms [data-form="${type}"]`);
  await t.waitForSelector("#logSheet table");
  await t.selectOption("#mSel", month);
  await t.waitForFunction((m) => document.querySelector("#mSel")?.value === m && document.querySelector("#logSheet table"), month);
  await t.waitForTimeout(300);
  const heads = await t.locator("#sheet thead th.att-day").count();
  const redHeads = await t.locator("#sheet thead th.att-day.log-off").count();
  check(heads === cols.length, `${type} ${month}: หน้าจอมี ${heads} วัน ต้องเป็น ${cols.length}`);
  check(redHeads === offs.length, `${type} ${month}: หน้าจอวันหยุด ${redHeads} ต้องเป็น ${offs.length}`);
  check(await t.locator("#sheet tbody td.log-off").count() === offs.length, `${type} ${month}: ช่องวันหยุดในตารางต้องรวมเป็นคอลัมน์เดียวต่อวัน`);
  const bg = await t.locator("#sheet thead th.log-off").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  check(bg === "rgb(253, 228, 228)", `${type} ${month}: หัวคอลัมน์วันหยุดต้องเป็นสีแดงอ่อน (${bg})`);
  if (month === "2026-07") check((await t.locator("#sheet tbody td.log-off").allInnerTexts()).some((x) => x.includes("หยุดทดสอบ")), "ต้องแสดงชื่อวันหยุด");
  // ติ๊กวันเรียนยังใช้ได้
  const first = t.locator("#sheet tbody tr").first().locator(".tick").first();
  await first.click();
  await t.waitForFunction(() => document.getElementById("saveState")?.textContent === "บันทึกแล้ว");
  check((await first.innerText()) === "✓", `${type} ${month}: ติ๊กไม่ได้`);
  await t.screenshot({ path: `${OUT}/logs-${type}-${month}.png` });
  // หน้าพิมพ์
  await t.goto(`${BASE}/print/logs.html?year=1&${Q}&types=${type}&months=${month}`);
  await t.waitForSelector(".logbook table");
  check(await t.locator(".logbook thead tr").nth(1).locator("th").count() === cols.length, `${type} ${month}: หน้าพิมพ์จำนวนวันไม่ตรง`);
  check(await t.locator(".logbook thead tr").nth(1).locator("th.off").count() === offs.length, `${type} ${month}: หน้าพิมพ์วันหยุดไม่ตรง`);
  check(await t.locator(".logbook tbody td.off").count() === offs.length, `${type} ${month}: หน้าพิมพ์ช่องวันหยุด`);
  const pdf = await t.pdf({ path: `${OUT}/logs-${type}-${month}.pdf`, preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(pages === 1, `${type} ${month}: หน้าพิมพ์ต้องมี 1 หน้า (ได้ ${pages})`);
  await t.screenshot({ path: `${OUT}/logs-print-${type}-${month}.png`, fullPage: true });
}
// ตรวจสุขภาพไม่มีคอลัมน์วันหยุด
await t.goto(`${BASE}/print/logs.html?year=1&${Q}&types=health&months=2026-07`);
await t.waitForSelector(".logbook table");
check(await t.locator(".logbook .off").count() === 0, "ตรวจสุขภาพต้องไม่มีคอลัมน์วันหยุด");

await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-logs-holidays ok");
