// สร้างข้อมูลตัวอย่าง (ป.4/1 ภาษาไทย 2 ภาค มีหน่วย แก้ตัว ส่ง อนุมัติ) แล้วพิมพ์ ปพ.5 เป็น PDF
// node dev/e2e-pp5.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน)
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const errors = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 }, locale: "th-TH" })).newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/fonts\.googleapis|cdnjs|ERR_|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${BASE}/login.html`);
await page.fill("input[name=email]", "admin@test.local");
await page.fill("input[name=password]", "test-password-1");
await page.click("#go");
await page.waitForURL(`${BASE}/`);
const api = (path, method = "GET", body) => page.evaluate(async ([path, method, body]) => {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok && r.status !== 409) throw new Error(path + " " + JSON.stringify(j)); return j;
}, [path, method, body]);

await api("/api/admin/settings", "PUT", { ...(await api("/api/admin/settings")).settings, school_area: "สพป.เพชรบุรี เขต 2", director_name: "นางจิราพร สุขวงศ์",
  deputy_director_name: "นางสาววริศรา นวมนิ่ม", measurement_head_name: "นางสาวทดสอบ วัดผล", academic_head_name: "นายทดสอบ วิชาการ", indicator_pass_pct_t2: "" });
await api("/api/admin/import/subjects", "POST", { rows: [
  { grade_level: "ป.4", code: "ท14101", name: "ภาษาไทย", learning_area: "ภาษาไทย", subject_type: "พื้นฐาน", hours_per_year: "160" },
  { grade_level: "ป.4", code: "ค14101", name: "คณิตศาสตร์", learning_area: "คณิตศาสตร์", subject_type: "พื้นฐาน", hours_per_year: "160" }] });
await api("/api/admin/import/teachers", "POST", { rows: [{ room: "ป.4/1", code: "ท14101", teachers: "ครูสมใจ ใจดี" }, { room: "ป.4/1", code: "ค14101", teachers: "ครูมานะ ขยันสอน" }] });
await api("/api/admin/import/homerooms", "POST", { rows: [{ room: "ป.4/1", teachers: "ครูปิติ ยิ้มแย้ม" }] });
const { courses } = await api("/api/admin/courses");
for (const c of courses) {
  let d;
  for (const t of [1, 2]) {
    d = await api(`/api/courses/${c.id}/units`, "POST", { term_number: t, unit_no: 1, title: t === 1 ? "การอ่านออกเสียง" : "การอ่านจับใจความ", hours: 40, task: "ใบงาน" });
    d = await api(`/api/courses/${c.id}/units`, "POST", { term_number: t, unit_no: 2, title: t === 1 ? "การเขียนสะกดคำ" : "การเขียนเรียงความ", hours: 40, task: "แบบฝึกหัด" });
    const us = d.units.filter((u) => u.term_number === t);
    d = await api(`/api/courses/${c.id}/items`, "POST", { items: [
      { term_number: t, kind: "indicator", code: `ท 1.1 ป.4/${t}`, title: "อ่านออกเสียงบทร้อยแก้วและร้อยกรองได้ถูกต้อง", max_score: 10, unit_id: us[0].id },
      { term_number: t, kind: "indicator", code: `ท 1.1 ป.4/${t + 2}`, title: "อ่านจับใจความ", max_score: 12.5, unit_id: us[0].id },
      { term_number: t, kind: "indicator", code: `ท 2.1 ป.4/${t}`, title: "คัดลายมือตัวบรรจง", max_score: 5, unit_id: us[1].id },
      { term_number: t, kind: "indicator", code: `ท 2.1 ป.4/${t + 3}`, title: "เขียนเรื่องตามจินตนาการ", max_score: 7.5, unit_id: us[1].id },
      { term_number: t, kind: "final", title: `สอบปลายภาค ${t}`, max_score: 15 }] });
  }
  const studs = d.students.filter((x) => x.enrollment_status === "enrolled");
  const changes = [];
  studs.forEach((st, n) => d.items.forEach((it, k) => changes.push({ item_id: it.id, student_id: st.id, score: Math.max(0, Math.min(it.max_score, Math.round((it.max_score * (0.45 + ((n * 7 + k * 3) % 11) / 20)) * 2) / 2)) })));
  await api(`/api/courses/${c.id}/scores`, "PUT", { changes });
  d = await api(`/api/courses/${c.id}`);
  const low = d.items.find((i) => i.kind === "indicator" && studs.some((st) => d.scores[st.id][i.id] / i.max_score < 0.5));
  const lowSt = low && studs.find((st) => d.scores[st.id][low.id] / low.max_score < 0.5);
  if (lowSt) await api(`/api/courses/${c.id}/scores`, "PUT", { changes: [{ item_id: low.id, student_id: lowSt.id, remedial: low.max_score }] });
  await api(`/api/courses/${c.id}/submit`, "POST", { force: true });
}
await api("/api/admin/courses/approve", "POST", { course_ids: [courses[0].id] });

await page.goto(`${BASE}/print/pp5.html?course=${courses[0].id}`);
await page.waitForSelector(".sheet");
await page.screenshot({ path: `${OUT}/pp5-cover.png`, fullPage: false });
await page.pdf({ path: `${OUT}/pp5-one.pdf`, preferCSSPageSize: true, printBackground: true });
await page.goto(`${BASE}/print/pp5.html?grade=${encodeURIComponent("ป.4")}&room=1`);
await page.waitForFunction(() => document.querySelectorAll(".sheet").length > 8);
const sheets = await page.evaluate(() => document.querySelectorAll(".sheet").length);
const drafts = await page.evaluate(() => document.querySelectorAll(".draft-mark").length);
await page.pdf({ path: `${OUT}/pp5-room.pdf`, preferCSSPageSize: true, printBackground: true });
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-pp5 ok", { sheets, drafts });
