// โครงสร้างรายวิชาแบบรายภาค (ไม่แยกหน่วย): เลือกจากคลังทั้งมาตรฐาน · วางจาก Excel · ชั่วโมง/ภาระงานรายภาค · บันทึก
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
await t.waitForSelector(".b-flat");
check(await t.locator(".b-flat [data-max]").count() === 0, "เริ่มต้นควรยังไม่มีตัวชี้วัด");
check(await t.locator("text=ชื่อหน่วยการเรียนรู้").count() === 0, "ไม่ควรมีช่องหน่วยการเรียนรู้");

// 1) เลือกจากคลัง: ทั้งมาตรฐาน ท 1.1 + ค้นหาแล้วติ๊ก ท 2.1 ข้อแรก
await t.click("#bBank");
await t.waitForSelector("dialog[open] .pick-std");
check((await t.locator("dialog[open] .pick-strand").first().innerText()) === "สาระที่ 1 การอ่าน", "ควรมีหัวสาระที่ 1 การอ่าน");
const stdBox = (code) => t.locator("dialog[open] .pick-std", { has: t.locator(`.pick-head > b:text-is("มาตรฐาน ${code}")`) });
const n11 = await stdBox("ท 1.1").locator("input[type=checkbox]").count();
check(n11 > 0, `ควรมีกลุ่มมาตรฐาน ท 1.1 (${n11})`);
await stdBox("ท 1.1").locator("[data-gall]").click();
await stdBox("ท 2.1").locator("input[type=checkbox]").first().check();
await okDialog(t);
{ await t.waitForFunction((n) => document.querySelectorAll(".b-flat [data-max]").length === n, n11 + 1, { timeout: 5000 }).catch(() => {}); const n = await t.locator(".b-flat [data-max]").count(); check(n === n11 + 1, `หลังเลือกควรมี ท 1.1 ทั้งมาตรฐาน + ท 2.1 1 ข้อ: ${n} vs ${n11}+1`); }

// 2) วางจาก Excel ต่อท้าย: รหัสผิด 1 → ไม่เพิ่มเลย · แก้แล้วเพิ่มได้ + คะแนนเต็มตามที่วาง
const t4 = bank.filter((b) => /^ท 4\.1/.test(b.code)).slice(0, 2);
await t.click("#bPaste");
await t.fill("dialog[open] textarea[name=tsv]", `รหัสตัวชี้วัด\tคะแนน\n${t4[0].code}\t5\nท 9.9 ป.4/1\t3`);
await okDialog(t);
await t.waitForSelector("dialog[open]");
check((await t.locator("dialog[open]").innerText()).includes("ท 9.9 ป.4/1"), "ควรแจ้งรหัสที่ไม่พบ");
await t.click("dialog[open] button[value=cancel]");
check(await t.locator(".b-flat [data-max]").count() === n11 + 1, "วางผิดต้องไม่เพิ่มอะไร");
await t.click("#bPaste");
await t.fill("dialog[open] textarea[name=tsv]", `${t4[0].code}\t5\n${t4[1].code}\t4`);
await okDialog(t);
await t.waitForFunction((n) => document.querySelectorAll(".b-flat [data-max]").length === n, n11 + 3, { timeout: 5000 }).catch(() => errors.push("วางแล้วควรเพิ่ม 2 ข้อ"));
check(await t.locator(".b-flat [data-max]").last().inputValue() === "4", "คะแนนเต็มจาก Excel");

// 3) ชั่วโมง/ภาระงานรายภาค
await t.fill("#bHours", "80");
await t.fill("#bTask", "ใบงาน แบบฝึกหัด");
await t.click("#bSplit");
await t.click('[data-fpick="0"]');
await t.click("dialog[open] [data-all]");
await okDialog(t);
await t.screenshot({ path: `${OUT}/st-table.png`, fullPage: true });
await t.click("#bSave");
await t.waitForFunction(() => document.body.innerText.includes("บันทึกโครงสร้างรายวิชาแล้ว"));
if (await t.locator("dialog[open]").count()) await t.click("dialog[open] button[value=cancel]");
const d = await api(t, `/api/courses/${cid}`);
const units = d.units.filter((u) => u.term_number === 2);
check(units.length === 1 && Number(units[0].hours) === 80 && units[0].task === "ใบงาน แบบฝึกหัด", `ชั่วโมง/ภาระงานรายภาค ${JSON.stringify(units)}`);
const collect = d.items.filter((i) => i.term_number === 2 && i.kind !== "final");
check(collect.length === n11 + 3, `จำนวนช่องคะแนน ${collect.length}`);
check(await t.locator("text=ชั่วโมงเรียน 80 ชม.").count() === 1, "หน้าโครงสร้างควรแสดงชั่วโมงเรียนรายภาค");
check(await t.locator("text=หน่วยที่").count() === 0, "หน้าโครงสร้างไม่ควรแสดงหน่วย");

// รายวิชาเก่าที่มีหน่วย: เปิดแก้แล้วบันทึก หน่วยเดิมยังอยู่ ตัวชี้วัดยังผูกหน่วยเดิม
await api(t, `/api/courses/${cid}/structure`, "PUT", { term: 2, units: [{ title: "หน่วยเก่า", hours: 10, task: "รายงาน", items: collect.slice(0, 2).map((i) => ({ id: i.id, code: i.code, title: i.title, max_score: i.max_score })) }],
  loose: collect.slice(2).map((i) => ({ id: i.id, code: i.code, title: i.title, max_score: i.max_score })), finals: d.items.filter((i) => i.term_number === 2 && i.kind === "final").map((i) => ({ id: i.id, code: i.code, title: i.title, max_score: i.max_score, indicators: i.indicators })) });
await t.goto(`${BASE}/course.html?id=${cid}&term=2`); await t.waitForSelector("#main:not([hidden])");
await t.click('#tabs button[data-tab="setup"]');
await t.click('[data-build="2"]');
await t.waitForSelector(".b-flat");
check(await t.locator("#bHours").inputValue() === "10", "รายวิชาเก่า: ชั่วโมงรายภาคตั้งต้นจากผลรวมหน่วยเดิม");
check(await t.locator(".b-flat [data-max]").count() === n11 + 3, "รายวิชาเก่า: เห็นตัวชี้วัดครบ");
await t.click("#bSave");
await t.waitForFunction(() => document.body.innerText.includes("บันทึกโครงสร้างรายวิชาแล้ว"));
if (await t.locator("dialog[open]").count()) await t.click("dialog[open] button[value=cancel]");
const d2 = await api(t, `/api/courses/${cid}`);
const old = d2.units.find((u) => u.title === "หน่วยเก่า");
check(old && d2.items.filter((i) => i.unit_id === old.id).length === 2, "หน่วยเดิมและการผูกตัวชี้วัดต้องยังอยู่");

// มือถือ: หน้าไม่ล้นจอ
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await t.context().storageState() });
const m = await ctx.newPage();
await m.goto(`${BASE}/course.html?id=${cid}&term=2`);
await m.waitForSelector("#main:not([hidden])");
await m.click('#tabs button[data-tab="setup"]');
await m.click('[data-build="2"]');
await m.waitForSelector(".b-flat");
const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(over <= 2, `มือถือหน้าล้นแนวนอน ${over}px`);
await m.screenshot({ path: `${OUT}/st-mobile.png` });

await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("structure-table ok");
