// ทดสอบหน้าครูประจำชั้น: เติมทั้งห้อง/ทุกข้อ, ปพ.5.1, ความคิดเห็น+คลัง, น้ำหนักส่วนสูง (คอม + มือถือ)
// node dev/e2e-homeroom.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน)
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:8787", OUT = process.argv[2] || "/tmp";
const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function login(email, viewport = { width: 1366, height: 900 }) {
  const p = await (await browser.newContext({ viewport, locale: "th-TH" })).newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("dialog", (d) => d.accept());
  await p.goto(`${BASE}/login.html`);
  await p.fill("input[name=email]", email); await p.fill("input[name=password]", "test-password-1"); await p.click("#go");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  await p.waitForSelector("#main:not([hidden])");
  return p;
}
const text = (p, s) => p.waitForFunction((t) => document.body.innerText.includes(t), s, { timeout: 8000 });
const saved = (p) => p.waitForFunction(() => document.getElementById("saveState")?.textContent === "บันทึกแล้ว", null, { timeout: 8000 });
const api = (p, path) => p.evaluate(async (path) => (await fetch(path)).json(), path);

const a = await login("admin@test.local");
await a.evaluate(() => fetch("/api/admin/import/homerooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] }) }));
const t = await login("teacher1@test.local");
// เมนูซ้ายมีห้องประจำชั้น
await t.click('.side-nav a[href*="homeroom.html"]');
await t.waitForSelector("#tabs button");
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;

// อ่านคิดฯ: ทั้งห้อง = 2 แล้วคนแรกทุกข้อ = 3
await t.click('#tabs button[data-tab="rtw"]');
await t.waitForSelector("#sheet");
for (let i = 1; i <= 5; i++) await t.selectOption(`select[data-fill="rtw_${i}"]`, "2");
await t.locator("#sheet tbody tr").first().locator("select[data-row]").selectOption("3");
await saved(t);
const sums = await t.$$eval("#sheet tbody tr [data-sum]", (els) => els.slice(0, 2).map((e) => e.textContent));
if (sums[0] !== "3 ดีเยี่ยม" || sums[1] !== "2 ดี") errors.push(`สรุปอ่านคิดฯ ไม่ถูก ${sums}`);
// ชี้ที่หัวคอลัมน์ "ข้อ 2" แล้วต้องเห็นว่าวัดเรื่องอะไร
await t.hover('#sheet thead .tip-btn >> nth=1');
await t.waitForSelector(".tip-pop:not([hidden])");
const tip = await t.innerText(".tip-pop");
if (!tip.startsWith("ข้อ 2:") || !tip.includes("จับประเด็นสำคัญ")) errors.push(`คำอธิบายข้อ 2 ไม่ถูก: ${tip}`);
await t.screenshot({ path: `${OUT}/h1-rtw.png` });
await t.mouse.move(5, 5);

// กิจกรรมพัฒนาผู้เรียน: ครูประจำชั้นบันทึกครบ 4 กิจกรรมจากเมนูซ้าย
await t.click('.side-nav a[href="/activities.html"]');
await t.waitForSelector("#sheet");
const r2 = t.locator("#sheet tbody tr").nth(1);
await r2.locator('input[data-key="act_scout_t"]').uncheck();
await r2.locator('input[data-key="act_club_o"]').uncheck();
await saved(t);
const actSum = await r2.locator("[data-sum]").innerText();
if (actSum !== "ไม่ผ่าน") errors.push(`กิจกรรมควรไม่ผ่าน ได้ ${actSum}`);
if (await t.locator('#sheet input[data-key="act_club_t"]:disabled').count()) errors.push("ฐานการเรียนรู้ต้องแก้ได้");
if (!(await t.innerText("#actCount")).includes("ไม่ผ่าน 1 คน")) errors.push("จำนวนไม่ผ่านไม่อัปเดต");
await t.screenshot({ path: `${OUT}/h2-activity.png` });
// ผลขึ้นในข้อมูล ปพ.6
const rep = await api(t, `/api/reports/room?${Q}`);
const s2 = rep.students.filter((x) => x.enrollment_status === "enrolled")[1];
if (s2.assessments.act_club_o !== "มผ" || s2.assessments.act_scout_t !== "มผ") errors.push("ผลกิจกรรมไม่ขึ้นในข้อมูล ปพ.6");
// ฝ่ายวิชาการเปิดหน้าเดียวกันได้ทุกห้อง
await a.goto(`${BASE}/activities.html?room=${encodeURIComponent("ป.4/1")}`);
await a.waitForSelector("#sheet");
if ((await a.locator("#sheet tbody tr").nth(1).locator("[data-sum]").innerText()) !== "ไม่ผ่าน") errors.push("ฝ่ายวิชาการต้องเห็นผลเดียวกัน");
await a.screenshot({ path: `${OUT}/h2b-academic.png` });
await t.goto(`${BASE}/homeroom.html?${Q}`);
await t.waitForSelector("#tabs button");

// ความคิดเห็น: พิมพ์ เก็บเข้าคลัง ใช้กับทั้งห้อง
await t.click('#tabs button[data-tab="comments"]');
await t.waitForSelector(".cm-row textarea");
const first = t.locator('.cm-row').first().locator('textarea[data-f="learn"]');
await first.fill("ตั้งใจเรียน ส่งงานครบ");
await t.click("#bankSave");
await text(t, "เก็บเข้าคลังแล้ว");
await t.locator('.cm-row').nth(2).locator('textarea[data-f="learn"]').click();
await t.click(".chip-use[data-use]");
await t.click('button[data-all="health"]');
await t.fill("dialog[open] textarea[name=body]", "สุขภาพแข็งแรง");
await t.click("dialog[open] button[value=ok]");
await saved(t);
let d = await api(t, `/api/homeroom?${Q}`);
const st = d.students.filter((x) => x.enrollment_status === "enrolled");
if (d.comments[st[2].id]?.[2]?.learn !== "ตั้งใจเรียน ส่งงานครบ") errors.push("แทรกจากคลังไม่ถูกบันทึก");
if (st.some((x) => d.comments[x.id]?.[2]?.health !== "สุขภาพแข็งแรง")) errors.push("ใช้กับทั้งห้องไม่ครบ");
await t.screenshot({ path: `${OUT}/h3-comments.png` });

// น้ำหนักส่วนสูง
await t.click('#tabs button[data-tab="body"]');
await t.waitForSelector("#sheet");
const row = t.locator("#sheet tbody tr").first();
await row.locator('input[data-r="1"][data-f="weight"]').fill("32.5");
await row.locator('input[data-r="1"][data-f="height"]').fill("135");
await saved(t);
const bmi = await row.locator("[data-bmi]").innerText();
if (bmi !== "17.8") errors.push(`BMI ควรเป็น 17.8 ได้ ${bmi}`);
d = await api(t, `/api/homeroom?${Q}`);
if (d.body[st[0].id]?.[1]?.weight !== 32.5) errors.push("น้ำหนักไม่ถูกบันทึก");
await t.screenshot({ path: `${OUT}/h4-body.png` });

// อนุบาล: ครูประจำชั้นเห็นเฉพาะบันทึกการมาเรียนและน้ำหนักส่วนสูง
await a.evaluate(() => fetch("/api/admin/homerooms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade_level: "อ.3", classroom: "1", user_ids: [2] }) }));
await t.goto(`${BASE}/homeroom.html?grade=${encodeURIComponent("อ.3")}&room=1`);
await t.waitForSelector("#tabs button");
await t.click('#tabs button[data-tab="attend"]');
await t.waitForSelector("#mSel");
const ktabs = await t.$$eval("#tabs button", (b) => b.map((x) => x.dataset.tab));
if (JSON.stringify(ktabs) !== JSON.stringify(["attend", "body"])) errors.push(`แท็บอนุบาลไม่ถูก ${ktabs}`);
await t.selectOption("#mSel", "2026-11");
await t.waitForSelector('#sheet input[data-date="2026-11-02"]');
await t.locator('#sheet tbody tr').first().locator('input[data-date="2026-11-02"]').fill("ล");
await saved(t);
await t.screenshot({ path: `${OUT}/h7-kinder-attendance.png` });

// มือถือ: หน้าความคิดเห็นไม่ล้นจอ
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await t.context().storageState() })).newPage();
await m.goto(`${BASE}/homeroom.html?${Q}`);
await m.waitForSelector("#tabs button");
await m.click('#tabs button[data-tab="comments"]');
await m.waitForSelector(".cm-row");
await m.screenshot({ path: `${OUT}/h5-mobile-comments.png` });
// มือถือ: แตะหัวคอลัมน์อ่านคิดฯ แล้วเห็นคำอธิบาย
await m.click('#tabs button[data-tab="rtw"]');
await m.waitForSelector("#sheet thead .tip-btn");
await m.tap("#sheet thead .tip-btn >> nth=0");
await m.waitForSelector(".tip-pop:not([hidden])");
await m.waitForTimeout(300);
if (await m.evaluate(() => document.querySelector(".tip-pop").hidden)) errors.push("มือถือ: แตะแล้วคำอธิบายหายเอง");
await m.screenshot({ path: `${OUT}/h6-mobile-rtw-tip.png` });
const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (over > 2) errors.push(`มือถือเลื่อนแนวนอน ${over}px`);
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-homeroom ok");
