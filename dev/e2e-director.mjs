// ตำแหน่งใต้ลายเซ็นผู้อำนวยการต้องมีชื่อโรงเรียน ("ผู้อำนวยการโรงเรียน…") ในทุกเอกสารที่พิมพ์ได้
// node dev/e2e-director.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน — ข้อมูลสะอาด)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "th-TH" });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
await page.goto(`${BASE}/login.html`);
const form = (await page.locator("#loginForm").count()) ? "#loginForm " : "";
await page.fill(`${form}input[name=email]`, "admin@test.local");
await page.fill(`${form}input[name=password]`, "test-password-1");
await page.click(form ? "#loginForm button.primary" : "#go");
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
await page.waitForSelector("#main:not([hidden])");
const api = (path, method = "GET", body) => page.evaluate(async ([path, method, body]) => {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + " " + JSON.stringify(j)); return j;
}, [path, method, body]);

const settings = (await api("/api/admin/settings")).settings;
const SCHOOL = settings.school_name || "";
const WANT = `ผู้อำนวยการโรงเรียน${SCHOOL.replace(/^โรงเรียน\s*/, "")}`;
await api("/api/admin/settings", "PUT", { ...settings, director_name: "นายทดสอบ ผู้บริหาร" });
for (const room of ["ป.4/1", "ป.6/1", "อ.3/1"]) await api("/api/admin/import/homerooms", "POST", { rows: [{ room, teachers: "ครูสมใจ ใจดี" }] });
await api("/api/admin/subjects/template", "POST", { grades: ["ป.4"] });
await api("/api/admin/courses/generate", "POST", {});
const course = (await api("/api/admin/courses")).courses.find((c) => c.grade_level === "ป.4" && c.classroom === "1");
const q = (g, r) => `year=1&grade=${encodeURIComponent(g)}&room=${r}`;
const kid = (await api(`/api/homeroom?${q("ป.4", 1)}`)).students[0];
await api(`/api/homeroom/attendance?${q("ป.4", 1)}`, "PUT", { changes: [{ student_id: kid.id, date: "2026-09-01", code: "ข" }] });

const pages = [
  ["ปพ.6", `/print/pp6.html?${q("ป.4", 1)}`],
  ["ปพ.6 ภาค 1", `/print/pp6.html?${q("ป.4", 1)}&term=1`],
  ["ปพ.5 (รายวิชา)", `/print/pp5.html?course=${course.id}`],
  ["ปพ.1", `/print/pp1.html?${q("ป.6", 1)}`],
  ["น้ำหนัก ส่วนสูง", `/print/body.html?${q("ป.4", 1)}`],
  ["รายงานพัฒนาการอนุบาล", `/print/kinder.html?${q("อ.3", 1)}`],
  ["สรุปผลอนุบาลทั้งห้อง", `/print/kinder.html?${q("อ.3", 1)}&mode=room`],
  ["หนังสือแจ้งผู้ปกครอง", `/print/absence-letter.html?${q("ป.4", 1)}&student=${kid.id}`],
  ["บันทึกประจำวัน", `/print/logs.html?${q("ป.4", 1)}&types=milk&months=2026-09`],
];
for (const [name, url] of pages) {
  await page.goto(BASE + url);
  await page.waitForFunction(() => !document.querySelector("#doc .status") || document.querySelectorAll("section, .sheet, .page").length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const text = await page.locator("body").innerText();
  const titles = text.split("\n").map((l) => l.trim()).filter((l) => /^ผู้อำนวยการ/.test(l) || /\)\s*ผู้อำนวยการ/.test(l));
  if (!titles.length) { errors.push(`${name}: ไม่พบตำแหน่งผู้อำนวยการ`); continue; }
  const bad = titles.filter((l) => !l.includes(WANT));
  if (bad.length) errors.push(`${name}: ${JSON.stringify(bad)}`);
  if (!text.includes("นายทดสอบ ผู้บริหาร")) errors.push(`${name}: ไม่มีชื่อผู้อำนวยการ`);
  console.log(`✓ ${name}: ${titles.length} ตำแหน่ง`);
  await page.screenshot({ path: `${OUT}/director-${name.replace(/[^\p{L}\p{N}]+/gu, "-")}.png`, fullPage: true });
}
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`e2e-director ok (${WANT})`);
