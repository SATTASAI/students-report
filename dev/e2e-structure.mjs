// ทดสอบหน้าเว็บรอบโครงสร้างรายวิชา: หน่วย → ตัวชี้วัด → กรอกคะแนน → แก้ตัว → แม่แบบ
// node dev/e2e-structure.mjs <โฟลเดอร์เก็บภาพ>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน)
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function newPage(viewport = { width: 1366, height: 900 }) {
  const page = await (await browser.newContext({ viewport, locale: "th-TH" })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.googleapis|cdnjs|ERR_|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return page;
}
async function login(p, email) {
  await p.goto(`${BASE}/login.html`);
  await p.fill("input[name=email]", email);
  await p.fill("input[name=password]", "test-password-1");
  await p.click("#go");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
await p.waitForSelector("#main:not([hidden])");
}
const okDialog = async (p) => { await p.click('dialog[open] button[value=ok]'); await p.waitForSelector("dialog[open]", { state: "detached" }); };
const shot = (p, n, full = false) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full });
const text = (p, s) => p.waitForFunction((t) => document.body.innerText.includes(t), s, { timeout: 8000 });
const api = (p, path, method = "GET", body) => p.evaluate(async ([path, method, body]) => {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}, [path, method, body]);

// วิชาการเตรียมวิชา ป.4 + มอบหมายครู
const admin = await newPage();
await login(admin, "admin@test.local");
await api(admin, "/api/admin/pilot", "PUT", { rooms: ["ป.4/1"] });
await api(admin, "/api/admin/import/subjects", "POST", { rows: [{ grade_level: "ป.4", code: "ท14101", name: "ภาษาไทย", learning_area: "ภาษาไทย", subject_type: "พื้นฐาน", hours_per_year: "160" }] });
await api(admin, "/api/admin/import/teachers", "POST", { rows: [{ room: "ป.4/1", code: "ท14101", teachers: "ครูสมใจ ใจดี" }] });
const { courses } = await api(admin, "/api/admin/courses");
const cid = courses[0].id;

// ครู: ตั้งหน่วย + ตัวชี้วัด ภาค 2
const t = await newPage();
await login(t, "teacher1@test.local");
await t.goto(`${BASE}/course.html?id=${cid}`);
await t.waitForSelector("#main:not([hidden])");
await t.click('#tabs button[data-tab="setup"]');
await t.click('[data-uadd="2"]');
await t.fill('dialog[open] input[name=title]', "การอ่านจับใจความ");
await t.fill('dialog[open] input[name=hours]', "20");
await t.fill('dialog[open] input[name=task]', "ใบงาน");
await okDialog(t);
await text(t, "หน่วยที่ 1 การอ่านจับใจความ");
await t.click('[data-unit]');
await t.fill('dialog[open] input[name=max_score]', "20");
await t.fill('dialog[open] input[name=code]', "ท 1.1 ป.4/2");
await t.fill('dialog[open] textarea[name=title]', "อธิบายความหมายของคำ ประโยค และสำนวน");
await okDialog(t);
await t.click('[data-uadd="2"]');
await t.fill('dialog[open] input[name=title]', "การเขียนเรียงความ");
await okDialog(t);
const unit2Btn = t.locator('[data-unit]').nth(1);
await unit2Btn.click();
await t.fill('dialog[open] input[name=max_score]', "15");
await t.fill('dialog[open] textarea[name=title]', "เขียนเรียงความ");
await okDialog(t);
await t.click('[data-add="2"][data-kind="final"]');
await t.fill('dialog[open] input[name=max_score]', "15");
await okDialog(t);
await text(t, "ตัวชี้วัด 35/35 · ปลายภาค 15/15");
await shot(t, "r1-structure", true);

// กรอกคะแนนภาค 2: คนแรกได้ 6/20 (ไม่ผ่าน)
await t.click('#tabs button[data-tab="t2"]');
await t.waitForSelector("#sheet");
const first = t.locator("#sheet tbody tr").first();
await first.locator("input").nth(0).fill("6");
await first.locator("input").nth(1).fill("12.5");
await first.locator("input").nth(2).fill("13");
await t.waitForFunction(() => document.getElementById("saveState")?.textContent === "บันทึกแล้ว");
const termSum = await first.locator("[data-termsum]").innerText();
if (termSum !== "31.5") errors.push(`รวมภาค 2 ควรเป็น 31.5 ได้ ${termSum}`);
const total = await first.locator("[data-total]").innerText();
// ทศนิยม 3 ตำแหน่งไม่รับ
await first.locator("input").nth(1).fill("12.555");
if (!(await first.locator("td.cell").nth(1).getAttribute("class")).includes("invalid")) errors.push("ทศนิยม 3 ตำแหน่งต้องขึ้นสีแดง");
await first.locator("input").nth(1).fill("12.5");
await t.waitForFunction(() => document.getElementById("saveState")?.textContent === "บันทึกแล้ว");
await shot(t, "r2-sheet");

// แก้ตัว: ได้ 18 นับ 10
await t.click('#tabs button[data-tab="rem"]');
await t.waitForSelector(".rem-row[data-item] input");
await t.fill(".rem-row[data-item] input", "18");
await t.press(".rem-row[data-item] input", "Tab");
await text(t, "บันทึกคะแนนแก้ตัวแล้ว");
const counted = await t.locator(".rem-row[data-item] [data-counted]").innerText();
if (counted !== "10") errors.push(`นับคะแนนแก้ตัวควรได้ 10 ได้ ${counted}`);
await shot(t, "r3-remedial");
await t.click('#tabs button[data-tab="t2"]');
await t.waitForSelector("#sheet");
const after = await t.locator("#sheet tbody tr").first().locator("[data-termsum]").innerText();
if (after !== "35.5") errors.push(`รวมภาค 2 หลังแก้ตัวควรเป็น 35.5 ได้ ${after}`);

// ส่งผล: มีช่องว่าง → กล่องตรวจก่อนส่ง → ยกเลิก
await t.click("#submitBtn");
await t.waitForSelector("dialog[open]");
await text(t, "ตรวจก่อนส่งผล");
await text(t, "คะแนนยังไม่ครบ");
await shot(t, "r6-submit-check");
await t.click('dialog[open] button[value=cancel]');
await t.waitForSelector("dialog[open]", { state: "detached" });

// วิชาการบันทึกแม่แบบ
await admin.goto(`${BASE}/course.html?id=${cid}`);
await admin.waitForSelector("#main:not([hidden])");
await admin.click('#tabs button[data-tab="setup"]');
await admin.click("#tplSave");
await okDialog(admin);
await text(admin, "ฝ่ายวิชาการตั้งแม่แบบไว้แล้ว");
await shot(admin, "r4-template", true);
// มือถือ: หน้าโครงสร้างไม่ล้นจอ
const m = await newPage({ width: 390, height: 844 });
await m.context().addCookies(await t.context().cookies());
await m.goto(`${BASE}/course.html?id=${cid}`);
await m.waitForSelector("#main:not([hidden])");
await m.click('#tabs button[data-tab="setup"]');
await text(m, "หน่วยที่ 1");
await shot(m, "r5-mobile-structure", true);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 2) errors.push(`มือถือเลื่อนแนวนอน ${overflow}px`);
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-structure ok", { total });
