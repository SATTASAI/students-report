// กดเมนูแล้วโหลดเฉพาะเนื้อหาใน iframe (เมนูซ้ายไม่ถูกโหลดใหม่) + ปฏิทินวันหยุดเปลี่ยนสีตามภาค
// node dev/e2e-frame-nav.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน — ข้อมูลสะอาด)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };
const browser = await chromium.launch();

async function login(email, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "th-TH" });
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
const frameReady = async (page) => {
  await page.waitForFunction(() => { const fs = document.querySelectorAll("iframe.sr-frame"), f = fs[0]; return fs.length === 1 && !f.classList.contains("loading") && f.contentWindow.location.pathname === location.pathname && f.contentDocument?.querySelector("#main:not([hidden])"); });
  return page.frames().find((f) => f.parentFrame() && !f.isDetached() && f.url().startsWith(BASE));
};

const admin = await login("admin@test.local");
await api(admin, "/api/admin/import/homerooms", "POST", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] });

for (const vp of [{ width: 1400, height: 900 }, { width: 390, height: 800 }]) {
  const t = await login("teacher1@test.local", vp);
  const mobile = vp.width < 1024;
  await t.evaluate(() => { window.__sameDoc = 1; });
  const openMenu = async () => { if (mobile) await t.click("#menuBtn"); };
  // หน้าแรกเป็นหน้ารายภาค → มีสีภาค
  check(await t.evaluate(() => document.documentElement.dataset.term), `${vp.width}: หน้าแรกไม่มีสีภาค`);
  await openMenu();
  await t.click('.side-nav a[href="/calendar.html"]');
  await t.waitForURL((u) => u.pathname === "/calendar.html");
  const cal = await frameReady(t);
  check(await t.evaluate(() => window.__sameDoc === 1), `${vp.width}: กดเมนูแล้วโหลดทั้งหน้า`);
  check(await t.locator('.side-nav a[href="/calendar.html"][aria-current="page"]').count() === 1, `${vp.width}: เมนูปฏิทินไม่ถูกเลือก`);
  check(await t.evaluate(() => document.documentElement.dataset.term), `${vp.width}: หน้าต่างหลักไม่มีสีภาคที่ปฏิทิน`);
  check(await cal.evaluate(() => document.documentElement.dataset.term), `${vp.width}: ปฏิทินไม่เปลี่ยนสีตามภาค`);
  check(await cal.locator("#termBand").count() === 1, `${vp.width}: ปฏิทินไม่มีแถบภาค`);
  check(await cal.locator(".sidebar").count() === 0, `${vp.width}: iframe มีเมนูซ้ายซ้อน`);
  check(await t.locator(mobile ? ".mobilebar .term-toggle.mini" : ".term-top").isVisible(), `${vp.width}: ไม่เห็นสวิตช์ภาคที่ปฏิทิน`);
  check(await t.title() === await cal.title(), `${vp.width}: ชื่อหน้าไม่ตาม`);
  await t.screenshot({ path: `${OUT}/frame-calendar-${vp.width}.png` });

  // หน้าประจำชั้น
  await openMenu();
  await t.click('.side-nav a[href^="/homeroom.html"]');
  await t.waitForURL((u) => u.pathname === "/homeroom.html");
  await frameReady(t);
  check(await t.evaluate(() => window.__sameDoc === 1), `${vp.width}: ไปประจำชั้นแล้วโหลดทั้งหน้า`);
  check(await t.locator("iframe.sr-frame").count() === 1, `${vp.width}: iframe เก่าไม่ถูกลบ`);

  // ปุ่มย้อนกลับ
  await t.goBack();
  await t.waitForURL((u) => u.pathname === "/calendar.html");
  await frameReady(t);
  check(await t.evaluate(() => window.__sameDoc === 1 && !!document.documentElement.dataset.term), `${vp.width}: ย้อนกลับไม่ถูกต้อง`);

  // สลับภาคจากแถบใน iframe → โหลดทั้งหน้าที่ปฏิทินภาคใหม่
  const before = await t.evaluate(() => document.documentElement.dataset.term);
  const c2 = await frameReady(t);
  await c2.click("#termBand button");
  await t.waitForURL((u) => u.pathname === "/calendar.html" && u.searchParams.has("term"));
  await t.waitForSelector("#main:not([hidden])");
  check(await t.evaluate((b) => window.__sameDoc !== 1 && document.documentElement.dataset.term !== b, before), `${vp.width}: สลับภาคไม่โหลดทั้งหน้า/สีไม่เปลี่ยน`);
  check(await t.locator("iframe.sr-frame").count() === 0, `${vp.width}: หลังสลับภาคไม่ควรมี iframe`);
  await t.screenshot({ path: `${OUT}/calendar-term-${vp.width}.png` });
  await t.context().close();
}

// เจ้าหน้าที่วัดผล: หน้าไม่ใช่รายภาค → สีภาค/สวิตช์หายจากเมนู · หน้าเดิมเปลี่ยนแค่แท็บ (#)
await admin.evaluate(() => { localStorage.setItem("sr-role", "measure"); window.__x = 0; });
await admin.goto(`${BASE}/logs.html`);
await admin.waitForSelector("#main:not([hidden])");
await admin.evaluate(() => { window.__sameDoc = 1; });
check(await admin.evaluate(() => !!document.documentElement.dataset.term), "admin: บันทึกประจำวันไม่มีสีภาค");
await admin.click('.side-nav a[href="/admin.html#subjects"]');
await admin.waitForURL((u) => u.pathname === "/admin.html" && u.hash === "#subjects");
await frameReady(admin);
check(!(await admin.evaluate(() => document.documentElement.dataset.term)), "admin: หน้ารายวิชายังมีสีภาค");
check(!(await admin.locator(".term-top").isVisible()), "admin: หน้ารายวิชายังเห็นสวิตช์ภาค");
await admin.click('.side-nav a[href="/admin.html#courses"]');
await admin.waitForURL((u) => u.hash === "#courses");
check(await admin.locator('.side-nav a[href="/admin.html#courses"][aria-current="page"]').count() === 1, "admin: เมนูแท็บไม่ตาม");
check(await admin.evaluate(() => window.__sameDoc === 1 && document.querySelectorAll("iframe.sr-frame").length === 1), "admin: เปลี่ยนแท็บแล้วโหลดใหม่");
await admin.screenshot({ path: `${OUT}/frame-admin.png` });

await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("frame-nav ok");
