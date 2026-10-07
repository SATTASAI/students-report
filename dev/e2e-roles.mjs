// ทดสอบเมนูซ้ายและการสลับบทบาท บนคอม/แท็บเล็ต/มือถือ
// node dev/e2e-roles.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน)
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:8787", OUT = process.argv[2] || "/tmp";
const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function login(email, viewport) {
  const p = await (await browser.newContext({ viewport, locale: "th-TH" })).newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await p.goto(`${BASE}/login.html`);
  await p.fill("input[name=email]", email); await p.fill("input[name=password]", "test-password-1"); await p.click("#go");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  await p.waitForSelector("#main:not([hidden])");
  return p;
}
const roleOptions = (p) => p.$$eval("#roleSel option", (o) => o.map((x) => x.value));
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ครู: มีบทบาทเดียว เห็นเฉพาะเมนูครู
const t = await login("teacher1@test.local", { width: 1366, height: 860 });
if (JSON.stringify(await roleOptions(t)) !== '["teacher"]') errors.push("ครูควรมีบทบาทเดียว");
await t.screenshot({ path: `${OUT}/role-teacher.png` });

// ผู้ดูแลระบบ: ทุกบทบาท, เข้าแล้วไปหน้าของบทบาทตัวเอง
const a = await login("admin@test.local", { width: 1366, height: 860 });
const opts = await roleOptions(a);
if (opts.join() !== "teacher,measure,exec,admin") errors.push(`ผู้ดูแลควรมี 4 บทบาท ได้ ${opts}`);
await a.screenshot({ path: `${OUT}/role-measure.png` });
await a.selectOption("#roleSel", "exec");
await a.waitForURL(/reports\.html#progress/);
await a.waitForSelector("#main:not([hidden])");
await a.click('.side-nav a[href="/admin.html#approve"]');
await a.waitForFunction(() => document.getElementById("pageTitle")?.textContent === "อนุมัติผลการเรียน");
await a.screenshot({ path: `${OUT}/role-exec-approve.png` });
await a.selectOption("#roleSel", "admin");
await a.waitForURL(/admin\.html#people/);
await a.click('.side-nav a[href="/admin.html#audit"]');
await a.waitForFunction(() => document.getElementById("pageTitle")?.textContent === "ประวัติการใช้งาน");
await a.screenshot({ path: `${OUT}/role-admin-audit.png` });
// สลับกลับครู
await a.selectOption("#roleSel", "teacher");
await a.waitForURL(`${BASE}/`);
await a.waitForSelector("#main:not([hidden])");
if (await a.$eval("#roleSel", (s) => s.value) !== "teacher") errors.push("สลับเป็นครูไม่สำเร็จ");

// แท็บเล็ตและมือถือ: เมนูเป็นลิ้นชัก
for (const [name, vp] of [["tablet", { width: 820, height: 1180 }], ["mobile", { width: 390, height: 844 }]]) {
  const m = await (await browser.newContext({ viewport: vp, locale: "th-TH", storageState: await a.context().storageState() })).newPage();
  m.on("pageerror", (e) => errors.push(`pageerror ${name}: ${e.message}`));
  await m.goto(`${BASE}/admin.html#courses`);
  await m.waitForSelector("#main:not([hidden])");
  if (await m.isVisible("#sidebar .side-nav")) {
    const box = await m.$eval("#sidebar", (el) => el.getBoundingClientRect().right);
    if (box > 1) errors.push(`${name}: เมนูควรซ่อนอยู่`);
  }
  await m.screenshot({ path: `${OUT}/${name}-closed.png` });
  await m.click("#menuBtn");
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${OUT}/${name}-open.png` });
  await m.click('.side-nav a[href="/admin.html#subjects"]');
  await m.waitForFunction(() => document.getElementById("pageTitle")?.textContent === "รายวิชา");
  if (await m.evaluate(() => document.body.classList.contains("nav-open"))) errors.push(`${name}: กดเมนูแล้วลิ้นชักควรปิด`);
  const o = await overflow(m);
  if (o > 2) errors.push(`${name}: เลื่อนแนวนอน ${o}px`);
}
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-roles ok");
