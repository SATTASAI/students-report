// ทดสอบหน้าเว็บ: ย้ายออก/ออกกลางคัน (soft delete) → รับกลับ, นักเรียนย้ายเข้าใหม่ → ครูประจำชั้นกรอกคะแนนยกมา → หน้ากรอกคะแนนแสดง "ยกมา"
// node dev/e2e-moves.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน)
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:8787", OUT = process.argv[2] || "/tmp";
const errors = [];
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
const post = (p, path, body, method = "POST") => p.evaluate(async ([path, body, method]) => {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}, [path, body, method]);
const api = (p, path) => p.evaluate(async (path) => (await fetch(path)).json(), path);
const okDialog = async (p) => { await p.click("dialog[open] button[value=ok]"); await p.waitForSelector("dialog[open]", { state: "detached" }); };

const a = await login("admin@test.local");
await post(a, "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] });
await post(a, "/api/admin/subjects/template", { grades: ["ป.4"] });
await post(a, "/api/admin/courses/generate", {});
const { courses } = await api(a, "/api/admin/courses");
const c = courses.find((x) => x.code === "ท14101" && x.classroom === "1");
await post(a, `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] }, "PUT");

const t = await login("teacher1@test.local");
await post(t, `/api/courses/${c.id}/items`, { items: [
  { term_number: 2, kind: "indicator", title: "อ่าน", max_score: 35 }, { term_number: 2, kind: "final", title: "สอบ 2", max_score: 15 },
] });
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;
const before = (await api(t, `/api/homeroom?${Q}`)).students;
const leaver = before[3];

// ---------- วัดผล: ออกกลางคัน ----------
await a.goto(`${BASE}/admin.html`);
await a.click('.side-nav a[href="/admin.html#moves"]');
await a.waitForSelector("#findForm");
await a.fill("#findForm input[name=q]", leaver.student_code);
await a.click("#findForm button");
await a.waitForSelector('[data-reason="dropout"]');
await a.click('[data-reason="dropout"]');
await a.fill("dialog[open] input[name=note]", "ขาดเรียนต่อเนื่อง ติดตามไม่ได้");
await okDialog(a);
await a.waitForSelector("[data-back]");
await a.screenshot({ path: `${OUT}/m1-dropout.png` });
let hr = (await api(t, `/api/homeroom?${Q}`)).students;
if (hr.some((s) => s.id === leaver.id)) errors.push("คนที่ออกกลางคันต้องหายจากรายชื่อห้อง");
if (hr.length !== before.length - 1) errors.push("จำนวนนักเรียนในห้องไม่ลดลง");

// ---------- รับกลับเข้าเรียน (เลขประจำตัวเดิม) ----------
await a.click("[data-back]");
await a.selectOption("dialog[open] select[name=room]", "ป.4|1");
await okDialog(a);
await a.waitForSelector('[data-reason="transfer"]');
hr = (await api(t, `/api/homeroom?${Q}`)).students;
const back = hr.find((s) => s.id === leaver.id);
if (!back || back.student_code !== leaver.student_code) errors.push("รับกลับแล้วต้องได้เลขประจำตัวเดิม");
if (back && back.number !== hr.length) errors.push(`คนที่กลับเข้าระหว่างปีต้องได้เลขที่ท้ายห้อง ได้ ${back?.number}`);

// ---------- นักเรียนย้ายเข้าใหม่ ภาค 2 ----------
await a.click("#newKid");
await a.fill("dialog[open] input[name=first_name]", "ย้ายมา");
await a.fill("dialog[open] input[name=last_name]", "ใหม่เอี่ยม");
await a.selectOption("dialog[open] select[name=name_prefix]", "เด็กหญิง");
await a.selectOption("dialog[open] select[name=room]", "ป.4|1");
await a.selectOption("dialog[open] select[name=term_number]", "2");
await a.fill("dialog[open] input[name=school]", "โรงเรียนบ้านเดิม");
await okDialog(a);
await a.waitForFunction(() => document.body.innerText.includes("ย้ายเข้า (นักเรียนใหม่)"));
await a.screenshot({ path: `${OUT}/m2-moves.png`, fullPage: true });

// ---------- ครูประจำชั้น: คะแนนยกมาจาก ปพ.6 ----------
await t.goto(`${BASE}/homeroom.html?${Q}#carry`);
await t.waitForSelector("[data-save]");
const panel = t.locator(".panel[data-st]", { hasText: "ย้ายมา ใหม่เอี่ยม" });
const row = panel.locator('tr[data-code="ท14101"]');
await row.locator('[data-f="collect"]').fill("28.5");
await row.locator('[data-f="final"]').fill("11");
if ((await row.locator('[data-f="total"]').inputValue()) !== "39.5") errors.push("รวมคะแนนยกมาอัตโนมัติไม่ถูก");
await panel.locator("[data-save]").click();
await t.waitForFunction(() => document.body.innerText.includes("บันทึกคะแนนยกมาแล้ว"));
await t.screenshot({ path: `${OUT}/m3-carry.png`, fullPage: true });

// ---------- ครูผู้สอน: ภาค 1 แสดง "ยกมา" ภาค 2 กรอกต่อ แล้วได้เกรด ----------
await t.goto(`${BASE}/course.html?id=${c.id}`);
await t.waitForSelector("#tabs");
const cd = await api(t, `/api/courses/${c.id}`);
const kid = cd.students.find((s) => s.transfer_in_term === 2 && s.id !== leaver.id);
if (!kid || kid.number !== cd.students.filter((s) => s.number).length) errors.push("นักเรียนย้ายเข้าต้องอยู่ท้ายห้อง");
await t.click('#tabs button[data-tab=t2]');
await t.waitForSelector("#sheet");
const kr = t.locator(`#sheet tr[data-sid="${kid.id}"]`);
await kr.locator("input").first().fill("30");
await kr.locator("input").nth(1).fill("12");
await t.waitForFunction(() => document.getElementById("saveState").textContent === "บันทึกแล้ว");
const grade = await kr.locator("[data-grade]").innerText();
if (grade.trim() !== "4") errors.push(`เกรดนักเรียนย้ายเข้าควรเป็น 4 (39.5 + 42) ได้ ${grade}`);
await t.screenshot({ path: `${OUT}/m4-sheet.png` });

// มือถือ: หน้าคะแนนยกมาไม่ล้นจอ
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await t.context().storageState() })).newPage();
await m.goto(`${BASE}/homeroom.html?${Q}#carry`);
await m.waitForSelector("[data-save]");
await m.screenshot({ path: `${OUT}/m5-mobile-carry.png` });
const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (over > 2) errors.push(`มือถือเลื่อนแนวนอน ${over}px`);

await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-moves ok");
