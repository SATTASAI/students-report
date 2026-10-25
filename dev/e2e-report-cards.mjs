// ทดสอบครบวงจร: กรอกคะแนน → ตรวจผลการเรียนเทียบกับคิดมือ → ส่ง/ตรวจ/อนุมัติ → พิมพ์ ปพ.5 และ ปพ.6 → ตรวจตัวเลขในเอกสารตรงกัน
// node dev/e2e-report-cards.mjs <โฟลเดอร์ผลลัพธ์>  (เปิด dev server พอร์ต 8787 ก่อน — ข้อมูลสะอาด)
import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const fails = [], notes = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, locale: "th-TH" });
const page = await ctx.newPage();
page.on("pageerror", (e) => fails.push(`pageerror: ${e.message}`));
async function login(email) {
  await page.goto(`${BASE}/login.html`);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "test-password-1");
  await page.click("#go");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE}/print/print.css`); // หน้านิ่งไม่มีสคริปต์ — ใช้ยิง API โดยไม่ถูกเปลี่ยนหน้ากลางทาง
}
const api = (path, method = "GET", body) => page.evaluate(async ([path, method, body]) => {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok && r.status !== 409) throw new Error(path + " " + r.status + " " + JSON.stringify(j)); return j;
}, [path, method, body]);

// ---------- ตั้งค่าโรงเรียน + รายวิชา ป.4/1 ----------
await login("admin@test.local");
await api("/api/admin/settings", "PUT", { ...(await api("/api/admin/settings")).settings, school_area: "สพป.เพชรบุรี เขต 2", director_name: "นายทดสอบ ผู้อำนวยการ",
  deputy_director_name: "นางสาวทดสอบ รองผู้อำนวยการ", measurement_head_name: "นางสาวทดสอบ วัดผล", academic_head_name: "นายทดสอบ วิชาการ", indicator_pass_pct_t2: "" });
await api("/api/admin/import/subjects", "POST", { rows: [
  { grade_level: "ป.4", code: "ท14101", name: "ภาษาไทย", learning_area: "ภาษาไทย", subject_type: "พื้นฐาน", hours_per_year: "160" },
  { grade_level: "ป.4", code: "ค14101", name: "คณิตศาสตร์", learning_area: "คณิตศาสตร์", subject_type: "พื้นฐาน", hours_per_year: "160" }] });
await api("/api/admin/import/teachers", "POST", { rows: [{ room: "ป.4/1", code: "ท14101", teachers: "ครูสมใจ ใจดี" }, { room: "ป.4/1", code: "ค14101", teachers: "ครูมานะ ขยันสอน" }] });
await api("/api/admin/import/homerooms", "POST", { rows: [{ room: "ป.4/1", teachers: "ครูปิติ ยิ้มแย้ม" }] });
const courses = (await api("/api/admin/courses")).courses.filter((c) => c.grade_level === "ป.4" && c.classroom === "1");
const thai = courses.find((c) => c.code === "ท14101"), math = courses.find((c) => c.code === "ค14101");

// โครงสร้างภาคละ 50: ตัวชี้วัด 10 + 12.5 + 12.5 (= 35) + สอบปลายภาค 15
async function buildStructure(cid) {
  let d;
  for (const t of [1, 2]) d = await api(`/api/courses/${cid}/items`, "POST", { items: [
    { term_number: t, kind: "indicator", code: `ท 1.1 ป.4/${t}`, title: "อ่านออกเสียงได้ถูกต้อง", max_score: 10 },
    { term_number: t, kind: "indicator", code: `ท 1.1 ป.4/${t + 2}`, title: "อ่านจับใจความ", max_score: 12.5 },
    { term_number: t, kind: "indicator", code: `ท 2.1 ป.4/${t}`, title: "เขียนเรื่องตามจินตนาการ", max_score: 12.5 },
    { term_number: t, kind: "final", title: `สอบปลายภาค ${t}`, max_score: 15 }] });
  return d;
}
let d = await buildStructure(thai.id);
const S = d.students.filter((s) => s.enrollment_status === "enrolled");
const items = (t) => d.items.filter((i) => Number(i.term_number) === t).sort((a, b) => (a.kind === "final") - (b.kind === "final") || a.max_score - b.max_score || a.id - b.id);

// ---------- สถานการณ์รายคน: [ภาค 1], [ภาค 2] = ตัวชี้วัด 10, 12.5, 12.5, ปลายภาค 15 → ผลที่ต้องได้ (คิดมือ) ----------
const CASES = [
  { label: "เต็ม 100", t1: [10, 12.5, 12.5, 15], t2: [10, 12.5, 12.5, 15], total: 100, grade: "4" },
  { label: "79.5 ตัดทศนิยม → 3.5 (ไม่ปัดเป็น 4)", t1: [8, 10, 10, 12], t2: [8, 10, 9.5, 12], total: 79.5, grade: "3.5" },
  { label: "80 พอดี → 4", t1: [8, 10, 10, 12], t2: [8, 10, 10, 12], total: 80, grade: "4" },
  { label: "49.5 → 0 แล้วสอบแก้ตัวได้ 1", t1: [5, 6, 6, 8], t2: [5, 6, 6, 7.5], total: 49.5, grade: "1", original: "0", remedialResult: "1" },
  { label: "50 พอดี → 1", t1: [5, 6, 6, 8], t2: [5, 6, 6, 8], total: 50, grade: "1" },
  { label: "ขาดคะแนนสอบภาค 2 → ร", t1: [7, 9, 9, 10], t2: [7, 9, 9, null], total: null, grade: "ร" },
  { label: "แก้ตัวตัวชี้วัด: ได้ 3/10 แก้ตัว 9 นับแค่ 5 (เกณฑ์ 50%) → 65 = 2.5", t1: [6, 8, 8, 12], t2: [3, 8, 8, 10], remedial: 9, total: 65, grade: "2.5" },
  { label: "มส (หมดสิทธิ์สอบ)", t1: [9, 11, 11, 13], t2: [9, 11, 11, 13], total: 88, grade: "มส", special: "มส" },
  { label: "ทศนิยม 2 ตำแหน่ง 74.99 → 3 (ไม่ปัดเป็น 3.5)", t1: [7.25, 9.5, 9.75, 11.5], t2: [7, 9.25, 9.5, 11.24], total: 74.99, grade: "3" },
];
const plan = S.map((s, n) => ({ s, ...(CASES[n] || { label: "ทั่วไป 72 → 3", t1: [7, 9, 9, 11], t2: [7, 9, 9, 11], total: 72, grade: "3" }) }));

// ครูประจำวิชากรอก (วางทั้งตารางครั้งเดียว)
await login("teacher1@test.local");
const changes = [];
for (const p of plan) for (const t of [1, 2]) items(t).forEach((it, k) => { const v = p[`t${t}`][k]; if (v != null) changes.push({ item_id: it.id, student_id: p.s.id, score: v }); });
await api(`/api/courses/${thai.id}/scores`, "PUT", { changes });
for (const p of plan.filter((x) => x.remedial != null)) await api(`/api/courses/${thai.id}/scores`, "PUT", { changes: [{ item_id: items(2)[0].id, student_id: p.s.id, remedial: p.remedial }] });
for (const p of plan.filter((x) => x.special)) await api(`/api/courses/${thai.id}/results`, "PUT", { changes: [{ student_id: p.s.id, special: p.special, special_note: "ทดสอบ" }] });

// ส่งผล: ต้องมีหน้าตรวจ (คะแนนไม่ครบ / ทศนิยม / เกือบได้เกรดถัดไป / มส)
const w = await api(`/api/courses/${thai.id}/submit`, "POST", {});
check(w.needs_confirm, "ส่งผลต้องให้ตรวจก่อน");
check(w.checks?.blanks?.length === 1, `ตรวจพบคะแนนไม่ครบ ${w.checks?.blanks?.length} คน (ควร 1)`);
check(w.checks?.borderline?.some((x) => x.total === 79.5 && x.need === 80), "ต้องเตือนคนได้ 79.5 ว่าขาดอีก 0.5 ได้ 4");
check(w.checks?.ms?.length === 1, "ต้องเตือน มส 1 คน");
await api(`/api/courses/${thai.id}/submit`, "POST", { force: true, expect_rev: w.data_rev });
// หลังส่ง: คนที่ได้ 0 → ครูบันทึกสอบแก้ตัว (ฝ่ายวัดผลแก้รายวิชาที่ส่งแล้วได้)
await login("admin@test.local");
for (const p of plan.filter((x) => x.remedialResult)) await api(`/api/courses/${thai.id}/results`, "PUT", { changes: [{ student_id: p.s.id, remedial_type: "remedial", remedial_grade: p.remedialResult, remedial_date: "2027-03-15" }] });

// ---------- ตรวจผลที่ระบบคำนวณกับคิดมือ ----------
d = await api(`/api/courses/${thai.id}`);
const rows = [];
for (const p of plan) {
  const k = d.computed[p.s.id];
  const ok = String(k.grade) === p.grade && (p.total == null || Math.abs(Number(k.total) - p.total) < 1e-9) && (!p.original || String(k.original_grade) === p.original);
  rows.push(`${ok ? "✓" : "✗"} ${p.s.number}. ${p.label}: ระบบได้ คะแนน ${k.total ?? "-"} เกรด ${k.grade}${k.original_grade && k.original_grade !== k.grade ? ` (เดิม ${k.original_grade})` : ""}`);
  check(ok, `เลขที่ ${p.s.number} ${p.label}: ได้ ${k.total}/${k.grade} ควรได้ ${p.total}/${p.grade}`);
}

// ---------- คณิตศาสตร์: ทุกคนได้ 72 (เพื่อให้ ปพ.6 มีเกรดเฉลี่ยหลายวิชา) ----------
await login("teacher2@test.local");
let dm = await buildStructure(math.id);
const mi = (t) => dm.items.filter((i) => Number(i.term_number) === t).sort((a, b) => (a.kind === "final") - (b.kind === "final") || a.max_score - b.max_score || a.id - b.id);
await api(`/api/courses/${math.id}/scores`, "PUT", { changes: S.flatMap((s) => [1, 2].flatMap((t) => mi(t).map((it, k) => ({ item_id: it.id, student_id: s.id, score: [7, 9, 9, 11][k] })))) });
await api(`/api/courses/${math.id}/submit`, "POST", { force: true });

// ---------- ครูประจำชั้น: คุณลักษณะ อ่านคิดเขียน สมรรถนะ ความเห็น น้ำหนักส่วนสูง การมาเรียน ----------
await login("teacher3@test.local");
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;
const keys = (pre, n) => Array.from({ length: n }, (_, i) => `${pre}_${i + 1}`);
await api(`/api/homeroom/assessments?${Q}`, "PUT", { changes: S.flatMap((s, n) => [
  ...keys("trait", 8).map((k, i) => ({ student_id: s.id, item_key: k, value: n === 1 && i === 2 ? "1" : n % 3 === 0 ? "3" : "2" })),
  ...keys("rtw", 5).map((k) => ({ student_id: s.id, item_key: k, value: n % 2 ? "2" : "3" })),
  ...keys("comp", 5).map((k) => ({ student_id: s.id, item_key: k, value: "2" })),
]) });
for (const term of [1, 2]) await api(`/api/homeroom/comments?${Q}`, "PUT", { term, changes: S.flatMap((s) => [
  { student_id: s.id, field: "learn", body: "ตั้งใจเรียน ส่งงานครบ" }, { student_id: s.id, field: "habit", body: "มีระเบียบวินัย" }, { student_id: s.id, field: "health", body: "สุขภาพแข็งแรง" }]) });
await api(`/api/homeroom/body?${Q}`, "PUT", { changes: S.map((s, n) => ({ student_id: s.id, round: 1, weight: 28 + n, height: 128 + n })) });
const att = await api(`/api/homeroom/attendance?${Q}&month=2026-06`);
const days = att.days.filter((x) => !x.holiday && !x.off).map((x) => x.date || x).slice(0, 4);
await api(`/api/homeroom/attendance?${Q}`, "PUT", { changes: [
  { student_id: S[0].id, date: days[0], code: "ข" }, { student_id: S[0].id, date: days[1], code: "ล" }, { student_id: S[1].id, date: days[2], code: "ป" }, { student_id: S[1].id, date: days[3], code: "ส" }] });
await api("/api/activities", "PUT", { grade: "ป.4", room: "1", changes: [{ student_id: S[2].id, item_key: "act_scout_o", value: "มผ" }] }).catch((e) => notes.push(`กิจกรรม: ${e.message.slice(0, 120)}`));

// ---------- วัดผลตรวจ → ผู้บริหารอนุมัติ (ภาษาไทย) ----------
await login("admin@test.local");
await api("/api/admin/courses/review", "POST", { course_ids: [thai.id, math.id] });
await api("/api/admin/courses/approve", "POST", { course_ids: [thai.id] });

// ---------- พิมพ์ ----------
await page.goto(`${BASE}/print/pp5.html?course=${thai.id}`);
await page.waitForSelector(".sheet");
await page.pdf({ path: `${OUT}/pp5-ภาษาไทย-ป4-1.pdf`, preferCSSPageSize: true, printBackground: true });
const pp5Text = await page.evaluate(() => document.body.innerText);
const pp5Pages = await page.evaluate(() => document.querySelectorAll(".sheet").length);
await page.goto(`${BASE}/print/pp6.html?grade=${encodeURIComponent("ป.4")}&room=1`);
await page.waitForSelector(".sheet");
await page.pdf({ path: `${OUT}/pp6-ป4-1.pdf`, preferCSSPageSize: true, printBackground: true });
const pp6Pages = await page.evaluate(() => [...document.querySelectorAll(".sheet")].map((s) => s.innerText));

// ปพ.6 ของแต่ละคน: คะแนน/เกรดภาษาไทยต้องตรงกับที่ระบบคำนวณ (= ปพ.5)
const fmtN = (n) => String(Number(n));
for (const p of plan) {
  const k = d.computed[p.s.id];
  const sheet = pp6Pages.find((t) => t.includes(p.s.name || "") && t.includes("ภาษาไทย"));
  if (!sheet) { fails.push(`ไม่พบ ปพ.6 ของเลขที่ ${p.s.number}`); continue; }
  const line = sheet.split("\n").find((l) => l.includes("ท14101")) || sheet.split("\n").find((l) => l.includes("ภาษาไทย")) || "";
  check(line.includes(String(k.grade)), `ปพ.6 เลขที่ ${p.s.number}: แถวภาษาไทยไม่มีเกรด ${k.grade} → "${line.trim()}"`);
  if (k.total != null && p.grade !== "มส") check(line.includes(fmtN(k.total)) || sheet.includes(fmtN(k.total)), `ปพ.6 เลขที่ ${p.s.number}: ไม่พบคะแนน ${k.total}`);
}
check(!/NaN|undefined|null/.test(pp5Text), "ปพ.5 มีข้อความ NaN/undefined/null");
check(!pp6Pages.some((t) => /NaN|undefined|null/.test(t)), "ปพ.6 มีข้อความ NaN/undefined/null");
await page.goto(`${BASE}/print/pp6.html?grade=${encodeURIComponent("ป.4")}&room=1`);
await page.waitForSelector(".sheet");
await page.locator(".sheet").first().screenshot({ path: `${OUT}/pp6-page1.png` });
await page.goto(`${BASE}/print/pp5.html?course=${thai.id}`);
await page.waitForSelector(".sheet");
const sheets = page.locator(".sheet");
for (let i = 0; i < Math.min(await sheets.count(), 8); i++) await sheets.nth(i).screenshot({ path: `${OUT}/pp5-page${i + 1}.png` });
await browser.close();

console.log(rows.join("\n"));
console.log(`\nปพ.5 ${pp5Pages} หน้า · ปพ.6 ${pp6Pages.length} หน้า (${S.length} คน)`);
if (notes.length) console.log(notes.join("\n"));
if (fails.length) { console.error("\nพบปัญหา:\n- " + fails.join("\n- ")); process.exit(1); }
console.log("ผ่านทุกข้อ");
