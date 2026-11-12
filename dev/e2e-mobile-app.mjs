// มือถือแบบแอป: แถบล่าง, เมนูเพิ่มเติม (sheet), ปัดสลับแท็บ, ดึงลงรีเฟรช, service worker
// node dev/e2e-mobile-app.mjs <โฟลเดอร์>  (เปิด dev server ที่พอร์ต 8787 ก่อน)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = "http://localhost:8787", OUT = process.argv[2] || "/tmp";
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "th-TH" });
const t = await ctx.newPage();
t.on("pageerror", (e) => errors.push(`pageerror ${t.url()}: ${e.message}`));
await t.goto(`${BASE}/login.html`);
const form = (await t.locator("#loginForm").count()) ? "#loginForm " : "";
await t.fill(`${form}input[name=email]`, "teacher1@test.local");
await t.fill(`${form}input[name=password]`, "test-password-1");
await t.click(form ? "#loginForm button.primary" : "#go");
await t.waitForSelector(".bbar");
await t.waitForTimeout(400);
const tabs = await t.locator(".bbar a.bb-item").count();
check(tabs >= 2 && tabs <= 4, `จำนวนแท็บ ${tabs}`);
check(await t.locator('.bbar a.bb-item[aria-current="page"]').count() === 1, "แท็บแรกไม่ถูกเลือก");
check(!(await t.locator("#menuBtn").isVisible()), "ยังเห็นปุ่มเมนูเดิม");
await t.screenshot({ path: `${OUT}/m-home.png` });

const frame = async () => { await t.waitForFunction(() => { const f = document.querySelector("iframe.sr-frame:not(.loading)"); return f && f.contentDocument?.getElementById("main") && !f.contentDocument.getElementById("main").hidden; }); return t.frameLocator("iframe.sr-frame:not(.loading)"); };
// กดแท็บที่ 2
await t.locator(".bbar a.bb-item").nth(1).click();
await frame();
await t.waitForTimeout(500);
check(await t.locator('.bbar a.bb-item[data-i="1"][aria-current="page"]').count() === 1, "แท็บ 2 ไม่ถูกเลือก");
const fr = await t.evaluate(() => { const r = document.querySelector("iframe.sr-frame").getBoundingClientRect(), b = document.querySelector(".bbar").getBoundingClientRect(); return { bottom: r.bottom, bar: b.top }; });
check(Math.abs(fr.bottom - fr.bar) < 2, `iframe ทับแถบล่าง ${JSON.stringify(fr)}`);
await t.screenshot({ path: `${OUT}/m-tab2.png` });

// ปัดขวา (ไปแท็บก่อนหน้า) ใน iframe
const f = t.frames().find((x) => x !== t.mainFrame() && x.url().includes("homeroom"));
const swipe = async (fr, x0, x1, y0 = 400, y1 = 400) => fr.evaluate(([x0, x1, y0, y1]) => {
  const el = document.elementFromPoint(x0, y0) || document.body;
  const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent("touchstart", { touches: [mk(x0, y0)], bubbles: true, cancelable: true }));
  for (let i = 1; i <= 8; i++) el.dispatchEvent(new TouchEvent("touchmove", { touches: [mk(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8)], bubbles: true, cancelable: true }));
  el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [mk(x1, y1)], bubbles: true, cancelable: true }));
}, [x0, x1, y0, y1]);
if (f) {
  await swipe(f, 60, 300);
  await t.waitForURL((u) => u.pathname === "/");
  await frame();
  await t.waitForTimeout(500);
  check(await t.locator('.bbar a.bb-item[data-i="0"][aria-current="page"]').count() === 1, "ปัดขวาแล้วไม่กลับแท็บแรก");
} else errors.push("ไม่พบ iframe ประจำชั้น");

// เมนูเพิ่มเติม = sheet จากด้านล่าง
await t.click(".bb-more");
await t.waitForTimeout(450);
const sh = await t.evaluate(() => { const r = document.querySelector(".sidebar").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
check(sh.bottom <= sh.h + 1 && sh.top > 40, `sheet ตำแหน่งผิด ${JSON.stringify(sh)}`);
await t.screenshot({ path: `${OUT}/m-sheet.png` });
await t.click(".scrim", { position: { x: 20, y: 20 } });
await t.waitForTimeout(450);
check(!(await t.evaluate(() => document.body.classList.contains("nav-open"))), "แตะพื้นหลังแล้ว sheet ไม่ปิด");

// ดึงลงรีเฟรช (ใน iframe)
const cur = t.frames().find((x) => x !== t.mainFrame() && new URL(x.url()).pathname === "/");
if (cur) {
  await cur.evaluate(() => { window.__noReload = 1; });
  await swipe(cur, 200, 205, 150, 450);
  await t.waitForTimeout(900);
  const f2 = t.frames().find((x) => x !== t.mainFrame() && new URL(x.url()).pathname === "/");
  check(f2 && !(await f2.evaluate(() => window.__noReload === 1).catch(() => false)), "ดึงลงแล้วไม่รีเฟรช");
} else errors.push("ไม่พบ iframe หน้าแรก");

check(await t.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration?.())), "ไม่ได้ลงทะเบียน service worker");
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("mobile-app ok");
