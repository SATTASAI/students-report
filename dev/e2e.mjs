// ทดสอบหน้าเว็บแบบใช้งานจริงด้วย Playwright (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน)
// node dev/e2e.mjs <โฟลเดอร์เก็บภาพ>
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");

const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function newPage(viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: "th-TH" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.googleapis|cdnjs|ERR_|Failed to load resource/.test(m.text())) errors.push(`console ${page.url()}: ${m.text()}`); });
  page.on("dialog", (d) => d.accept());
  return page;
}
async function login(page, email) {
  await page.goto(`${BASE}/login.html`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', "test-password-1");
  await page.click("#go");
  await page.waitForURL(`${BASE}/`);
  await page.waitForSelector("#main:not([hidden])");
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const okDialog = async (page) => { await page.click('dialog[open] button[value=ok]'); await page.waitForSelector("dialog[open]", { state: "detached" }); };

// ---------- ผู้ดูแล: เริ่มต้นปี ----------
const admin = await newPage();
await login(admin, "admin@test.local");
await admin.goto(`${BASE}/admin.html`);
await admin.click('#tabs button[data-tab=start]');
await admin.waitForSelector("#tplBtn");
await admin.click("#tplBtn"); await okDialog(admin);
await admin.waitForSelector("#genBtn:not([disabled])");
await admin.click("#genBtn");
await admin.waitForFunction(() => document.body.innerText.includes("รายวิชา-ห้อง"));
await shot(admin, "01-admin-start");
// มอบหมายครูสมใจให้สอนทุกวิชาของ ป.1/1
await admin.click('#tabs button[data-tab=courses]');
await admin.waitForSelector("#assignAll");
await admin.click('[data-room="ป.1/1"]');
await admin.waitForSelector("#assignAll");
await admin.click("#assignAll");
await admin.selectOption('dialog[open] select[name=user_id]', { label: "ครูสมใจ ใจดี" });
await okDialog(admin);
await admin.waitForFunction(() => document.body.innerText.includes("ครูสมใจ"));
await shot(admin, "02-admin-courses");
await admin.click('#tabs button[data-tab=homerooms]');
await admin.waitForSelector("#importHr");
await admin.click("#importHr");
await admin.waitForFunction(() => [...document.querySelectorAll("td")].some((t) => t.textContent.includes("ครูสมใจ")));
// เพิ่มคลังตัวชี้วัดภาษาไทย ป.1
await admin.click('#tabs button[data-tab=bank]');
await admin.waitForSelector("#bankForm");
await admin.fill("#bankForm textarea", "ท 1.1 ป.1/1 ออกเสียงคำ คำคล้องจอง และข้อความสั้น ๆ\nท 1.1 ป.1/2 บอกความหมายของคำและข้อความที่อ่าน\nท 2.1 ป.1/1 คัดลายมือตัวบรรจงเต็มบรรทัด");
await admin.click("#bankForm button");
await admin.waitForFunction(() => document.body.innerText.includes("เพิ่ม 3 ตัวชี้วัด"));

// ---------- ครู: ตั้งโครงสร้างและกรอกคะแนน ----------
const t = await newPage();
await login(t, "teacher1@test.local");
await shot(t, "03-teacher-home");
const href = await t.locator('a.course-row', { hasText: "ท11101" }).getAttribute("href");
await t.goto(BASE + href);
await t.waitForSelector("#main:not([hidden])");
await t.click('#tabs button[data-tab=setup]');
await t.click('[data-bank="1"]');
await t.waitForSelector("dialog[open] input[type=checkbox]");
for (const c of await t.$$('dialog[open] input[type=checkbox]:not([disabled])')) await c.check();
await t.fill('dialog[open] input[name=max]', "20");
await okDialog(t);
await t.waitForFunction(() => document.querySelectorAll(".item").length === 3);
await t.click('[data-add="1"][data-kind="final"]');
await t.fill('dialog[open] input[name=max_score]', "30");
await okDialog(t);
await t.click('[data-paste="2"]');
await t.fill("dialog[open] textarea", "ท 1.1 ป.1/3 ตอบคำถามเกี่ยวกับเรื่องที่อ่าน\nท 3.1 ป.1/1 ฟังคำแนะนำ คำสั่งง่าย ๆ และปฏิบัติตาม");
await t.fill('dialog[open] input[name=max]', "15");
await okDialog(t);
await t.click('[data-add="2"][data-kind="final"]');
await t.fill('dialog[open] input[name=max_score]', "20");
await okDialog(t);
await t.waitForFunction(() => document.querySelectorAll(".item").length === 6);
await shot(t, "04-setup");

await t.click('#tabs button[data-tab=t1]');
await t.waitForSelector("#sheet");
const first = t.locator("#sheet tbody input").first();
await first.click();
await t.keyboard.type("18"); await t.keyboard.press("Enter");
await t.keyboard.type("25"); // เกินคะแนนเต็ม → ไม่บันทึก
await t.waitForTimeout(200);
const invalid = await t.locator("td.cell.invalid").count();
if (invalid !== 1) errors.push(`คาดว่ามีช่องผิด 1 ช่อง แต่พบ ${invalid}`);
await t.keyboard.press("Escape");
// วางคะแนนจาก Excel: 3 แถว × 4 คอลัมน์ ที่ช่องบนซ้าย
await first.click();
await t.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "20\t18\t15\t28\n12\t10\t9\t20\n5\t4\t3\t9\n");
  document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await t.waitForFunction(() => document.getElementById("saveState").textContent === "บันทึกแล้ว", null, { timeout: 5000 });
await shot(t, "05-sheet-term1");
// มือถือ
const m = await newPage({ width: 390, height: 844 });
await login(m, "teacher1@test.local");
await m.goto(BASE + href);
await m.waitForSelector("#sheet");
await shot(m, "06-mobile-sheet");

// ตรวจกับเซิร์ฟเวอร์ว่าคะแนนที่วางถูกบันทึกจริง
const saved = await t.evaluate(async (h) => (await (await fetch(`/api/courses/${new URLSearchParams(h.split("?")[1]).get("id")}`)).json()), href);
const row0 = saved.scores[saved.students[0].id] || {};
const t1items = saved.items.filter((i) => i.term_number === 1);
const got = t1items.map((i) => row0[i.id]);
if (JSON.stringify(got) !== JSON.stringify([20, 18, 15, 28])) errors.push(`คะแนนที่วางไม่ตรง: ${JSON.stringify(got)}`);

// ภาค 2 + สรุป
await t.click('#tabs button[data-tab=t2]');
await t.waitForSelector("#sheet");
await t.locator("#sheet tbody input").first().click();
await t.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "15\t14\t19\n");
  document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await t.waitForFunction(() => document.getElementById("saveState").textContent === "บันทึกแล้ว");
await t.click('#tabs button[data-tab=sum]');
await t.waitForSelector("table.list");
const firstGrade = await t.locator("table.list tbody tr").first().locator("td").nth(9).innerText();
// 20+18+15+15+14 = 82/85 ×70 = 67.52 ; 28+19 = 47/50 ×30 = 28.2 → 95.72 → 4
if (firstGrade.trim() !== "4") errors.push(`เกรดคนแรกควรเป็น 4 แต่ได้ ${firstGrade}`);
await t.locator("table.list tbody tr").nth(1).locator("[data-hours]").fill("150");
await t.locator("table.list tbody tr").nth(1).locator("[data-hours]").dispatchEvent("change");
await t.waitForFunction(() => document.querySelector("table.list tbody tr:nth-child(2)").innerText.includes("มส"));
await shot(t, "07-summary");

// ครูประจำชั้น
await t.goto(`${BASE}/homeroom.html?grade=${encodeURIComponent("ป.1")}&room=1`);
await t.waitForSelector("#sheet");
await t.selectOption('select[data-fill="trait_1"]', "2");
await t.waitForFunction(() => document.getElementById("saveState").textContent === "บันทึกแล้ว");
await shot(t, "08-homeroom");
await t.click('#tabs button[data-tab=absence]');
await t.click("[data-add]");
await okDialog(t);
await t.waitForSelector("a[href*='absence-letter']");

// เอกสารพิมพ์
for (const [name, path] of [
  ["09-pp5", href.replace("/course.html?id=", "/print/pp5.html?course=").replace(/&year=\d+/, "")],
  ["10-pp6", `/print/pp6.html?grade=${encodeURIComponent("ป.1")}&room=1`],
  ["11-letter", await t.getAttribute("a[href*='absence-letter']", "href")],
]) {
  const pp = await t.context().newPage();
  pp.on("pageerror", (e) => errors.push(`pageerror ${name}: ${e.message}`));
  await pp.goto(BASE + path);
  await pp.waitForSelector(".sheet");
  await pp.screenshot({ path: `${OUT}/${name}.png` });
  await pp.pdf({ path: `${OUT}/${name}.pdf`, preferCSSPageSize: true }).catch((e) => errors.push(`pdf ${name}: ${e.message}`));
}
for (const [name, path] of [["12-summary", "/print/summary.html"], ["13-pp1", "/print/pp1.html?grade=ป.6&room=1"]]) {
  const pp = await admin.context().newPage();
  pp.on("pageerror", (e) => errors.push(`pageerror ${name}: ${e.message}`));
  await pp.goto(BASE + path);
  await pp.waitForSelector(".sheet");
  await pp.screenshot({ path: `${OUT}/${name}.png` });
}
await admin.goto(`${BASE}/reports.html`);
await admin.waitForSelector("table.list");
await shot(admin, "14-reports");

await browser.close();
if (errors.length) { console.log("ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("E2E OK");
