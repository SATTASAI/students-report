// ทดสอบหน้าเว็บรอบตั้งค่าวิชาการ: ห้องนำร่อง → นำเข้ารายวิชา/ครูจาก Excel → เกณฑ์แยกภาค
// node dev/e2e-setup.mjs <โฟลเดอร์เก็บภาพ>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน)
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function newPage(viewport) {
  const page = await (await browser.newContext({ viewport, locale: "th-TH" })).newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.googleapis|cdnjs|ERR_|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return page;
}
const okDialog = async (p) => { await p.click('dialog[open] button[value=ok]'); await p.waitForSelector("dialog[open]", { state: "detached" }); };
const shot = (p, n, full = false) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full });
const text = (p, s) => p.waitForFunction((t) => document.body.innerText.includes(t), s);

const p = await newPage({ width: 1366, height: 900 });
await p.goto(`${BASE}/login.html`);
await p.fill("input[name=email]", "admin@test.local");
await p.fill("input[name=password]", "test-password-1");
await p.click("#go");
await p.waitForURL((u) => !u.pathname.startsWith("/login"));
await p.waitForSelector("#main:not([hidden])");
await p.goto(`${BASE}/admin.html`);
await p.click('.side-nav a[href="/admin.html#start"]');
// 1) ห้องนำร่อง
await p.click("#pilotBtn");
await p.check('dialog[open] input[name="ป.4/1"]');
await okDialog(p);
await text(p, "นำร่องเฉพาะ");
await shot(p, "s1-start-pilot");
// 2) นำเข้ารายวิชา (วางจาก Excel ที่มีแถวผิด 1 แถว)
await p.click('.side-nav a[href="/admin.html#import"]');
await p.waitForSelector("#pasteBox");
const subjects = ["ชั้น\tรหัสวิชา\tชื่อวิชา\tกลุ่มสาระ\tประเภท\tชม./ปี\tคะแนนระหว่างภาค (%)",
  "ป.4\tท14101\tภาษาไทย\tภาษาไทย\tพื้นฐาน\t160\t70", "ป.4\tค14101\tคณิตศาสตร์\tคณิตศาสตร์\tพื้นฐาน\t160\t70",
  "ป.4\tว14101\tวิทยาศาสตร์และเทคโนโลยี\tวิทยาศาสตร์และเทคโนโลยี\tพื้นฐาน\tแปดสิบ\t70"].join("\n");
await p.fill("#pasteBox", subjects);
await p.click("#checkBtn");
await text(p, "พบข้อผิดพลาด 1 แถว");
await shot(p, "s2-import-error", true);
await p.fill("#pasteBox", subjects.replace("แปดสิบ", "80"));
await p.click("#checkBtn");
await text(p, "ข้อมูลถูกต้อง 3 แถว");
await p.click("#saveImport");
await text(p, "บันทึกแล้ว 3 แถว");
// 3) นำเข้าครูผู้สอน (รายวิชาของห้องสร้างให้เอง)
await p.click('[data-kind="teachers"]');
await p.waitForSelector("#pasteBox");
await p.fill("#pasteBox", "ป.4/1\tท14101\tภาษาไทย\tครูสมใจ ใจดี\nป.4/1\tค14101\tคณิตศาสตร์\tครูมานะ ขยันสอน, ครูสมใจ ใจดี\nป.4/1\tว14101\tวิทยาศาสตร์\tครูปิติ ยิ้มแย้ม");
await p.click("#checkBtn");
await text(p, "ข้อมูลถูกต้อง 3 แถว");
await shot(p, "s3-import-teachers", true);
await p.click("#saveImport");
await text(p, "บันทึกแล้ว 3 แถว");
// 4) เกณฑ์แยกภาค
await p.click('.side-nav a[href="/admin.html#settings"]');
await p.waitForSelector("input[name=indicator_pass_pct_t2]");
await p.fill("input[name=indicator_pass_pct_t2]", "60");
await p.fill("input[name=deputy_director_name]", "นางสาววริศรา นวมนิ่ม");
await p.click("#setForm button.primary");
await text(p, "บันทึกแล้ว");
await shot(p, "s4-settings", true);
// 5) กลับหน้าเริ่มต้น: ทุกขั้นครบ
await p.click('.side-nav a[href="/admin.html#start"]');
await text(p, "ภาค 2 60%");
await text(p, "ครบทุกรายวิชา");
await shot(p, "s5-start-done", true);
// มือถือ
const m = await newPage({ width: 390, height: 844 });
await m.context().addCookies(await p.context().cookies());
await m.goto(`${BASE}/admin.html`);
await m.goto(`${BASE}/admin.html#start`);
await text(m, "ห้องที่เปิดใช้ระบบ");
await shot(m, "s6-mobile-start", true);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 2) errors.push(`มือถือเลื่อนแนวนอน ${overflow}px`);
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-setup ok");
