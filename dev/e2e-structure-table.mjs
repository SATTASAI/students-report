// ตารางโครงสร้างรายวิชา: เลือกจากคลังทีเดียวหลายหน่วย (ตามมาตรฐาน) · วางจาก Excel · เพิ่มหลายแถว · บันทึก
// node dev/e2e-structure-table.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน — ข้อมูลสะอาด)
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
  await ctx.addInitScript(() => localStorage.setItem("sr-full-nav", "1"));
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
const okDialog = async (p) => { await p.click("dialog[open] button[value=ok]"); await p.waitForSelector("dialog[open]", { state: "detached" }); };

const admin = await login("admin@test.local");
await api(admin, "/api/admin/pilot", "PUT", { rooms: ["ป.4/1"] });
await api(admin, "/api/admin/import/subjects", "POST", { rows: [{ grade_level: "ป.4", code: "ท14101", name: "ภาษาไทย", learning_area: "ภาษาไทย", subject_type: "พื้นฐาน", hours_per_year: "160" }] });
await api(admin, "/api/admin/import/teachers", "POST", { rows: [{ room: "ป.4/1", code: "ท14101", teachers: "ครูสมใจ ใจดี" }] });
const { courses } = await api(admin, "/api/admin/courses");
const cid = courses.find((c) => c.code === "ท14101").id;

const t = await login("teacher1@test.local");
const bank = (await api(t, `/api/courses/${cid}/bank`)).indicators;
check(bank.length > 5, `คลัง ท14101 ควรมีตัวชี้วัด ได้ ${bank.length}`);
await t.goto(`${BASE}/course.html?id=${cid}&term=2`);
await t.waitForSelector("#main:not([hidden])");
await t.click('#tabs button[data-tab="setup"]');
await t.click('[data-build="2"]');
await t.waitForSelector(".b-table");
check(await t.locator(".b-table tbody tr.b-row").count() === 1, "เริ่มต้นควรมี 1 แถว");

// 1) เลือกจากคลัง: มาตรฐาน ท 1.1 → หน่วยที่ 1, ท 2.1 → หน่วยใหม่
await t.click("#bBank");
await t.waitForSelector("dialog[open] .pick-std");
check((await t.locator("dialog[open] .pick-strand").first().innerText()) === "สาระที่ 1 การอ่าน", "ควรมีหัวสาระที่ 1 การอ่าน");
check((await t.locator("dialog[open] .std-text").first().innerText()).startsWith("ใช้กระบวนการอ่านสร้างความรู้"), "ควรแสดงข้อความมาตรฐาน ท 1.1");
const stdBox = (code) => t.locator("dialog[open] .pick-std", { has: t.locator(`.pick-head > b:text-is("มาตรฐาน ${code}")`) });
const n11 = await stdBox("ท 1.1").locator("select[name]").count();
const n21 = await stdBox("ท 2.1").locator("select[name]").count();
check(n11 > 0 && n21 > 0, `ควรมีกลุ่มมาตรฐาน ท 1.1 (${n11}) และ ท 2.1 (${n21})`);
await stdBox("ท 1.1").locator("select[data-gset]").selectOption("u0");
await stdBox("ท 2.1").locator("select[data-gset]").selectOption("new");
// ค้นหาแล้วเลือกรายข้อ: ท 3.1 ข้อแรก → หน่วยที่ 1
const firstT3 = bank.find((b) => b.code.startsWith("ท 3.1"));
await t.fill("dialog[open] .pick-find", firstT3.code);
check(await t.locator("dialog[open] [data-row]:visible").count() === 1, "ค้นหารหัสควรเหลือ 1 ข้อ");
await t.locator("dialog[open] [data-row]:visible select").selectOption("u0");
await t.screenshot({ path: `${OUT}/st-bank.png` });
await okDialog(t);
await t.waitForFunction(() => document.querySelectorAll(".b-table tbody tr.b-row").length === 2, null, { timeout: 5000 }).catch(() => errors.push("หลังเลือกควรมี 2 หน่วย"));
check(await t.locator(".b-row").nth(0).locator(".b-ind").count() === n11 + 1, "หน่วยที่ 1 ควรมี ท 1.1 ทั้งมาตรฐาน + ท 3.1 1 ข้อ");
check((await t.locator(".b-row").nth(0).locator(".c-std").innerText()).includes("ท 3.1"), "คอลัมน์มาตรฐานควรแสดง ท 3.1");
check(await t.locator(".b-row").nth(1).locator(".b-ind").count() === n21, "หน่วยใหม่ควรมี ท 2.1 ทั้งมาตรฐาน");
await t.fill('[data-uf="0:title"]', "การอ่าน");
await t.fill('[data-uf="1:title"]', "การเขียน");

// 2) วางจาก Excel ต่อท้าย: 2 หน่วย, รหัสผิด 1 → ไม่เพิ่มเลย
const t4 = bank.filter((b) => b.code.startsWith("ท 4.1")).slice(0, 2), t5 = bank.find((b) => b.code.startsWith("ท 5.1"));
await t.click("#bPaste");
await t.fill("dialog[open] textarea[name=tsv]", `ชื่อหน่วย\tชั่วโมง\tภาระงาน\tตัวชี้วัด\tคะแนน\nหลักภาษา\t8\t"ใบงาน\nแบบฝึก"\t${t4.map((b) => b.code).join(", ")}\t5, 4\nวรรณคดี\t6\tรายงาน\t${t5.code}, ท 9.9 ป.4/1\t3`);
await t.click("dialog[open] button[value=ok]");
await t.waitForFunction(() => document.querySelector("dialog[open]")?.innerText.includes("ยังเพิ่มไม่ได้"));
check((await t.locator("dialog[open]").innerText()).includes("ไม่พบ ท 9.9 ป.4/1"), "ควรแจ้งรหัสที่ไม่มีในคลัง");
await t.click("dialog[open] button[value=cancel]");
await t.waitForSelector("dialog[open]", { state: "detached" });
check(await t.locator(".b-table tbody tr.b-row").count() === 2, "วางไม่ผ่านต้องไม่เพิ่มอะไร");
await t.click("#bPaste");
await t.fill("dialog[open] textarea[name=tsv]", `หลักภาษา\t8\t"ใบงาน\nแบบฝึก"\t${t4.map((b) => b.code).join(", ")}\t5, 4\nวรรณคดี\t6\tรายงาน\t${t5.code}\t3`);
await okDialog(t);
await t.waitForFunction(() => document.querySelectorAll(".b-table tbody tr.b-row").length === 4, null, { timeout: 5000 }).catch(() => errors.push("วางแล้วควรมี 4 หน่วย"));
check(await t.locator('[data-uf="2:task"]').inputValue() === "ใบงาน\nแบบฝึก", "เซลล์หลายบรรทัดจาก Excel");
check(await t.locator('[data-max="u2:1"]').inputValue() === "4", "คะแนนเต็มรายข้อจากที่วาง");
check(await t.locator('[data-usum="2"]').innerText() === "9", "คะแนนรวมหน่วยที่ 3 ควรเป็น 9");

// 3) เพิ่ม 3 แถวว่าง → บันทึกแล้วแถวว่างหายเอง
await t.fill("#bAddN", "3");
await t.click("#bAddUnit");
check(await t.locator(".b-table tbody tr.b-row").count() === 7, "เพิ่ม 3 แถวควรเป็น 7");
await t.fill('[data-uf="4:title"]', "การฟัง การดู การพูด");
await t.fill('[data-uf="4:hours"]', "4");
await t.click("#bSplit");
await t.click('[data-fpick="0"]');
await t.click("dialog[open] [data-all]");
await okDialog(t);
await t.screenshot({ path: `${OUT}/st-table.png`, fullPage: true });
await t.click("#bSave");
await t.waitForFunction(() => document.body.innerText.includes("บันทึกโครงสร้างรายวิชาแล้ว"));
if (await t.locator("dialog[open]").count()) await t.click("dialog[open] button[value=cancel]");
const d = await api(t, `/api/courses/${cid}`);
const units = d.units.filter((u) => u.term_number === 2).sort((a, b) => a.unit_no - b.unit_no);
check(units.map((u) => u.title).join("|") === "การอ่าน|การเขียน|หลักภาษา|วรรณคดี|การฟัง การดู การพูด", `หน่วยที่บันทึก: ${units.map((u) => u.title).join("|")}`);
const collect = d.items.filter((i) => i.term_number === 2 && i.kind !== "final");
check(collect.length === n11 + 1 + n21 + 3, `จำนวนช่องคะแนน ${collect.length}`);
check(Number(units[2].hours) === 8 && /^ใบงาน\s+แบบฝึก$/.test(units[2].task), `ชั่วโมง/ภาระงานหน่วยที่ 3 ${JSON.stringify(units[2])}`);

// มือถือ: ตารางเลื่อนในกรอบ หน้าไม่ล้นจอ
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await t.context().storageState() });
const m = await ctx.newPage();
await m.goto(`${BASE}/course.html?id=${cid}&term=2`);
await m.waitForSelector("#main:not([hidden])");
await m.click('#tabs button[data-tab="setup"]');
await m.click('[data-build="2"]');
await m.waitForSelector(".b-table");
const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(over <= 2, `มือถือหน้าล้นแนวนอน ${over}px`);
await m.screenshot({ path: `${OUT}/st-mobile.png` });

await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("structure-table ok");
