// ทดสอบหน้าเว็บ: ตรวจคำผิดในความคิดเห็นครูประจำชั้น (ป. และอนุบาล)
// - พบคำผิด → ขึ้นตัวแดง "ท่านสะกดคำไม่ถูก" ไม่บันทึก · แตะคำที่ถูก → บันทึก · "+ คำนี้ถูก" → บันทึก
// - "บันทึกทั้งที่มีคำผิด" ต้องยืนยัน 2 รอบ (ยกเลิกรอบ 2 = ยังไม่บันทึก)
// - ออกจากแท็บขณะมีช่องค้าง → ถามก่อน
// node dev/e2e-spell.mjs <โฟลเดอร์>  (เปิด dev server ใหม่ที่พอร์ต 8787 ก่อน)
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:8787", OUT = process.argv[2] || "/tmp";
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function login(email, viewport = { width: 1366, height: 900 }) {
  const p = await (await browser.newContext({ viewport, locale: "th-TH" })).newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await p.goto(`${BASE}/login.html`);
  await p.fill("input[name=email]", email); await p.fill("input[name=password]", "test-password-1"); await p.click("#go");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  await p.waitForSelector("#main:not([hidden])");
  return p;
}
const state = (p) => p.locator("#saveState").innerText();
const waitState = (p, s) => p.waitForFunction((t) => document.getElementById("saveState")?.textContent.includes(t), s, { timeout: 8000 });
const api = (p, path) => p.evaluate(async (path) => (await fetch(path)).json(), path);

const a = await login("admin@test.local");
await a.evaluate(() => fetch("/api/admin/import/homerooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] }) }));
const t = await login("teacher1@test.local");
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;
await t.goto(`${BASE}/homeroom.html?${Q}`);
await t.waitForSelector("#tabs button");
await t.click('#tabs button[data-tab="comments"]');
await t.waitForSelector(".cm-row textarea");
await t.waitForFunction(() => document.getElementById("spellBar")?.textContent.includes("ระบบตรวจการสะกดคำอัตโนมัติ"), null, { timeout: 15000 });
const rows = t.locator(".cm-row:not(.inactive)");
const sid = async (i) => Number(await rows.nth(i).getAttribute("data-sid"));
const saved = async (i, f) => (await api(t, `/api/homeroom?${Q}`)).comments[await sid(i)]?.[2]?.[f];

// 1) ข้อความถูกต้อง → บันทึกอัตโนมัติ
await rows.nth(0).locator('textarea[data-f="learn"]').fill("เป็นเด็กดี มีความรับผิดชอบ ตั้งใจเรียน");
await waitState(t, "บันทึกแล้ว");
check(await saved(0, "learn") === "เป็นเด็กดี มีความรับผิดชอบ ตั้งใจเรียน", "ข้อความถูกต้องต้องบันทึก");

// 2) คำผิด → ไม่บันทึก แสดงคำแนะนำ → กดคำแนะนำ → บันทึก
const ta1 = rows.nth(1).locator('textarea[data-f="learn"]');
await ta1.fill("ไฝ่รู้ ตั้งใจเรียน");
await waitState(t, "ยังไม่บันทึก 1 ช่อง");
await t.waitForTimeout(1200);
check(await saved(1, "learn") == null, "พบคำผิดแล้วต้องไม่บันทึก");
check(await rows.nth(1).locator(".sp-issues").first().isVisible(), "ต้องแสดงคำที่อาจผิดใต้ช่อง");
check(await ta1.evaluate((el) => el.classList.contains("sp-bad")), "ช่องที่มีคำผิดต้องเป็นสีแดง");
await t.screenshot({ path: `${OUT}/s1-issue.png` });
check((await rows.nth(1).locator(".sp-issues").first().innerText()).includes("ท่านสะกดคำไม่ถูก"), "ต้องขึ้นว่า ท่านสะกดคำไม่ถูก");
await rows.nth(1).locator('.sp-fix[data-to="ใฝ่"]').click();
await waitState(t, "บันทึกแล้ว");
check(await ta1.inputValue() === "ใฝ่รู้ ตั้งใจเรียน", `แก้แล้วข้อความไม่ถูก: ${await ta1.inputValue()}`);
check(await saved(1, "learn") === "ใฝ่รู้ ตั้งใจเรียน", "แก้คำผิดแล้วต้องบันทึก");

// 2b) คำสะกดถูกแต่ไม่เข้ากับบริบท → ไม่บันทึก → แก้ตามคำแนะนำ
const ta2 = rows.nth(1).locator('textarea[data-f="habit"]');
await ta2.fill("ไม่ตั่งใจเลียน");
await waitState(t, "ยังไม่บันทึก 1 ช่อง");
check((await rows.nth(1).locator(".sp-issues").nth(1).innerText()).includes("ท่านสะกดคำไม่ถูก"), "บริบทผิดต้องขึ้นว่า ท่านสะกดคำไม่ถูก");
await t.screenshot({ path: `${OUT}/s1b-context.png` });
await rows.nth(1).locator('.sp-fix[data-to="ไม่ตั้งใจเรียน"]').click();
await waitState(t, "บันทึกแล้ว");
check(await saved(1, "habit") === "ไม่ตั้งใจเรียน", `แก้แล้วข้อความไม่ถูก: ${await saved(1, "habit")}`);

// 2c) ผิดหลายคำในประโยคเดียว: แก้ทีละคำ ต้องยังไม่บันทึกจนกว่าจะแก้ครบทุกคำ
const ta3 = rows.nth(1).locator('textarea[data-f="other"]');
await ta3.fill("ไม่ตั่งใจเลียน ส่งงานไม่คบ ไม่ทำการบ้าย");
await waitState(t, "ยังไม่บันทึก 1 ช่อง");
check(await rows.nth(1).locator(".sp-issues").nth(3).locator(".sp-item").count() === 3, "ต้องขีดเส้นใต้ครบ 3 จุด");
// แตะคำแนะนำทีละคำ: คำที่เหลือยังขึ้นอยู่ และยังไม่บันทึก
const box3 = rows.nth(1).locator(".sp-issues").nth(3);
for (const [to, left] of [["ไม่ตั้งใจเรียน", 2], ["ส่งงานไม่ครบ", 1]]) {
  await box3.locator(`.sp-fix[data-to="${to}"]`).click();
  await t.waitForTimeout(1500);
  check(await box3.locator(".sp-item").count() === left, `แตะ ${to} แล้วต้องเหลือ ${left} จุด`);
  check((await state(t)).includes("ยังไม่บันทึก 1 ช่อง"), `แก้ยังไม่ครบต้องยังไม่บันทึก (${to})`);
  check(await saved(1, "other") == null, `แก้ยังไม่ครบต้องไม่บันทึก (${to})`);
}
await box3.locator('.sp-fix[data-to="ไม่ทำการบ้าน"]').click();
await waitState(t, "บันทึกแล้ว");
check(await saved(1, "other") === "ไม่ตั้งใจเรียน ส่งงานไม่ครบ ไม่ทำการบ้าน", "แก้ครบแล้วต้องบันทึก");

// 3) คำที่ระบบไม่รู้จัก → "+ คำนี้ถูก" → บันทึก และไม่เตือนคำนั้นอีก
await rows.nth(2).locator('textarea[data-f="habit"]').fill("ปุ๊กปิ๊กชอบช่วยเหลือเพื่อน");
await waitState(t, "ยังไม่บันทึก 1 ช่อง");
await rows.nth(2).locator(".sp-add").click();
await waitState(t, "บันทึกแล้ว");
check(await saved(2, "habit") === "ปุ๊กปิ๊กชอบช่วยเหลือเพื่อน", "เพิ่มคำเข้าพจนานุกรมแล้วต้องบันทึก");
check((await t.locator("#myWords").innerText()).includes("(1)"), "จำนวนคำในพจนานุกรมของฉันไม่อัปเดต");
const mine = (await api(t, "/api/homeroom/spell-words")).spell_words;
check(JSON.stringify(mine) === JSON.stringify(["ปุ๊กปิ๊ก"]), `คำที่เพิ่มต้องเป็นทั้งคำ ได้ ${mine}`);
await rows.nth(3).locator('textarea[data-f="habit"]').fill("ปุ๊กปิ๊กตั้งใจเรียน");
await waitState(t, "บันทึกแล้ว");

// 4) บันทึกทั้งที่มีคำผิด: ยกเลิกรอบ 2 → ยังไม่บันทึก · ยืนยันครบ 2 รอบ → บันทึก
await rows.nth(4).locator('textarea[data-f="health"]').fill("ศรีษะสะอาด");
await waitState(t, "ยังไม่บันทึก 1 ช่อง");
await t.click("#forceSave");
await t.waitForSelector("dialog[open]");
check((await t.locator("dialog[open]").innerText()).includes("ศรีษะ"), "กล่องยืนยันรอบ 1 ต้องแสดงคำที่อาจผิด");
await t.screenshot({ path: `${OUT}/s2-confirm1.png` });
await t.click("dialog[open] button[value=ok]");
await t.waitForFunction(() => document.querySelector("dialog[open] h2")?.textContent === "ยืนยันครั้งที่ 2");
await t.screenshot({ path: `${OUT}/s3-confirm2.png` });
await t.click("dialog[open] button[value=cancel]");
await t.waitForTimeout(1000);
check(await saved(4, "health") == null, "ยกเลิกรอบ 2 ต้องยังไม่บันทึก");
check((await state(t)).includes("ยังไม่บันทึก 1 ช่อง"), "ยกเลิกแล้วต้องยังค้างอยู่");
await t.click("#forceSave");
await t.click("dialog[open] button[value=ok]");
await t.waitForFunction(() => document.querySelector("dialog[open] h2")?.textContent === "ยืนยันครั้งที่ 2");
await t.click("dialog[open] button[value=ok]");
await waitState(t, "บันทึกแล้ว");
check(await saved(4, "health") === "ศรีษะสะอาด", "ยืนยัน 2 รอบแล้วต้องบันทึกแม้มีคำผิด");

// 5) "ใช้กับทั้งห้อง" ด้วยข้อความที่มีคำผิด → ยืนยัน 2 รอบก่อน
await t.click('button[data-all="other"]');
await t.fill("dialog[open] textarea[name=body]", "ควรสังเกตุอาการ");
await t.click("dialog[open] button[value=ok]");
await t.waitForFunction(() => document.querySelector("dialog[open] h2")?.textContent === "ท่านสะกดคำไม่ถูก");
await t.click("dialog[open] button[value=cancel]");
await t.waitForTimeout(800);
check(await saved(0, "other") == null, "ยกเลิกแล้วต้องไม่ใช้กับทั้งห้อง");

// 6) เปลี่ยนแท็บขณะมีช่องค้าง → ถาม · "กลับไปแก้ไข" อยู่หน้าเดิม · "ออกโดยไม่บันทึก" คืนค่าเดิม
await rows.nth(5).locator('textarea[data-f="learn"]').fill("อนุญาติให้ไปเข้าห้องน้ำ");
await waitState(t, "ยังไม่บันทึก 1 ช่อง");
await t.click('#tabs button[data-tab="body"]');
await t.waitForFunction(() => document.querySelector("dialog[open] h2")?.textContent === "ยังไม่ได้บันทึกบางช่อง");
await t.click("dialog[open] button[value=cancel]");
check(await t.locator('#tabs button[data-tab="comments"][aria-selected="true"]').count() === 1, "กลับไปแก้ไขต้องอยู่แท็บเดิม");
await t.click('#tabs button[data-tab="body"]');
await t.click("dialog[open] button[value=ok]");
await t.waitForSelector("#sheet");
await t.click('#tabs button[data-tab="comments"]');
await t.waitForSelector(".cm-row textarea");
check(await rows.nth(5).locator('textarea[data-f="learn"]').inputValue() === "", "ออกโดยไม่บันทึกต้องคืนค่าเดิม");
check(await saved(5, "learn") == null, "ออกโดยไม่บันทึกต้องไม่บันทึก");
// ข้อความที่บันทึกไว้แล้วแต่มีคำผิด: ยังแสดงคำเตือนเมื่อเปิดหน้า (แต่ไม่กักอะไร)
await t.waitForFunction(() => document.querySelectorAll(".sp-issues:not([hidden])").length >= 1, null, { timeout: 8000 });
check((await state(t)) === "บันทึกแล้ว", "เปิดหน้าใหม่ต้องไม่มีช่องค้าง");

// 7) อนุบาล: ความคิดเห็นครูใช้ตัวตรวจเดียวกัน
await a.evaluate(() => fetch("/api/admin/homerooms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade_level: "อ.3", classroom: "1", user_ids: [2] }) }));
const KQ = `grade=${encodeURIComponent("อ.3")}&room=1`;
await t.goto(`${BASE}/homeroom.html?${KQ}`);
await t.waitForSelector("#tabs button");
await t.click('#tabs button[data-tab="kcomments"]');
await t.waitForSelector(".cm-row textarea");
const krow = t.locator(".cm-row:not(.inactive)").first();
await krow.locator("textarea").first().fill("ร่าเลิงแจ่มใส");
await waitState(t, "ยังไม่บันทึก 1 ช่อง");
await krow.locator('.sp-fix[data-to="ร่าเริง"]').click();
await waitState(t, "บันทึกแล้ว");
const kd = await api(t, `/api/homeroom/kinder?${KQ}`);
const ksid = Number(await krow.getAttribute("data-sid"));
check(Object.values(kd.comments[ksid]?.[2] || kd.comments[ksid]?.[1] || {}).includes("ร่าเริงแจ่มใส"), "อนุบาล: แก้คำผิดแล้วต้องบันทึก");

// มือถือ
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await t.context().storageState() })).newPage();
await m.goto(`${BASE}/homeroom.html?${Q}`);
await m.waitForSelector("#tabs button");
await m.click('#tabs button[data-tab="comments"]');
await m.waitForSelector(".cm-row textarea");
await m.locator(".cm-row:not(.inactive)").nth(6).locator('textarea[data-f="learn"]').fill("คำนวนเลขเร็ว รอบครอบ");
await waitState(m, "ยังไม่บันทึก");
await m.locator(".cm-row:not(.inactive)").nth(6).scrollIntoViewIfNeeded();
await m.screenshot({ path: `${OUT}/s4-mobile.png` });
const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(over <= 2, `มือถือเลื่อนแนวนอน ${over}px`);

await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-spell ok");
