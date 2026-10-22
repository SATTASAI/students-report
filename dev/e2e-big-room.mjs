// ทดสอบห้องใหญ่: นักเรียน 33 คน ตัวชี้วัดภาคละ 16 ตัว → กรอกคะแนน ส่ง อนุมัติ แล้วพิมพ์ ปพ.5 / ปพ.6
// node --no-warnings dev/e2e-big-room.mjs <โฟลเดอร์ผลลัพธ์> [จำนวนนักเรียน=33] [ตัวชี้วัดต่อภาค=16]
// เปิดเซิร์ฟเวอร์ของตัวเอง (พอร์ต 8790) — ไม่ต้องเปิด dev server
import http from "node:http";
import { createRequire } from "node:module";
import worker from "../src/index.js";
import { makeEnv } from "./server.mjs";
import { gradeFromTotal } from "../public/js/grading.js";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright-core");

const OUT = process.argv[2] || "/tmp";
const N = Number(process.argv[3] || 33), K = Number(process.argv[4] || 16);
const PORT = 8790, BASE = `http://localhost:${PORT}`;
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// ---------- ห้อง ป.4/1 ให้มีนักเรียน N คน (seed มี 14) ----------
const env = await makeEnv();
const firsts = ["ปภาวรินทร์", "ณัฐพงศ์", "กชกร", "ธีรภัทร", "พิชญาภา", "วรินทร", "ศุภกร", "อัญชิสา", "ภัทรพล", "กัญญาณัฐ"];
const lasts = ["ศรีสุขสวัสดิ์", "บุญประเสริฐ", "ทองคำแท้", "วงศ์ไพบูลย์", "แสงอรุณ"];
const have = (await env.DB.prepare("SELECT COUNT(*) AS n FROM student_enrollments WHERE academic_term_id = 1 AND grade_level = 'ป.4' AND classroom = '1'").first()).n;
for (let i = have, id = 500; i < N; i++, id++) {
  const male = i % 2 === 0;
  await env.DB.prepare(`INSERT INTO students (id, student_code, full_name, classroom, grade_level, name_prefix, first_name, last_name, national_id, birth_date) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, String(20000 + id), "x", "1", "ป.4", male ? "เด็กชาย" : "เด็กหญิง", firsts[i % firsts.length], lasts[i % lasts.length], `1${String(600000000000 + id)}`, "2016-03-01").run();
  await env.DB.prepare("UPDATE students SET full_name = name_prefix || first_name || ' ' || last_name WHERE id = ?").bind(id).run();
  await env.DB.prepare("INSERT INTO student_details (student_id, gender) VALUES (?, ?)").bind(id, male ? "ช" : "ญ").run();
  for (const term of [1, 2]) await env.DB.prepare("INSERT INTO student_enrollments (student_id, academic_year_id, academic_term_id, grade_level, classroom) VALUES (?,?,?,?,?)").bind(id, 1, term, "ป.4", "1").run();
}
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(BASE + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await (await browser.newContext({ locale: "th-TH" })).newPage();
page.on("pageerror", (e) => fails.push(`pageerror: ${e.message}`));
async function login(email) {
  await page.goto(`${BASE}/login.html`);
  await page.fill("input[name=email]", email); await page.fill("input[name=password]", "test-password-1"); await page.click("#go");
  await page.waitForURL((u) => !u.pathname.startsWith("/login")); await page.waitForLoadState("networkidle");
  await page.goto(`${BASE}/print/print.css`);
}
const api = (path, method = "GET", body) => page.evaluate(async ([path, method, body]) => {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok && r.status !== 409) throw new Error(path + " " + r.status + " " + JSON.stringify(j)); return j;
}, [path, method, body]);

await login("admin@test.local");
await api("/api/admin/settings", "PUT", { ...(await api("/api/admin/settings")).settings, school_area: "สพป.เพชรบุรี เขต 2", director_name: "นายทดสอบ ผู้อำนวยการ",
  deputy_director_name: "นางสาวทดสอบ รองผู้อำนวยการ", measurement_head_name: "นางสาวทดสอบ วัดผล", academic_head_name: "นายทดสอบ วิชาการ", indicator_pass_pct_t2: "" });
await api("/api/admin/import/subjects", "POST", { rows: [{ grade_level: "ป.4", code: "ท14101", name: "ภาษาไทย", learning_area: "ภาษาไทย", subject_type: "พื้นฐาน", hours_per_year: "160" }] });
await api("/api/admin/import/teachers", "POST", { rows: [{ room: "ป.4/1", code: "ท14101", teachers: "ครูสมใจ ใจดี" }] });
await api("/api/admin/import/homerooms", "POST", { rows: [{ room: "ป.4/1", teachers: "ครูปิติ ยิ้มแย้ม" }] });
const course = (await api("/api/admin/courses")).courses.find((c) => c.code === "ท14101" && c.grade_level === "ป.4" && c.classroom === "1");

// ---------- โครงสร้าง: ภาคละ K ตัวชี้วัด รวม 35 (ทศนิยมไม่เกิน 2 ตำแหน่ง) + ปลายภาค 15 ----------
const maxes = (() => { const base = Math.floor(3500 / K) / 100; const m = Array(K).fill(base); m[K - 1] = Number((35 - base * (K - 1)).toFixed(2)); return m; })();
await login("teacher1@test.local");
let d;
for (const t of [1, 2]) {
  d = await api(`/api/courses/${course.id}/units`, "POST", { term_number: t, unit_no: 1, title: t === 1 ? "การอ่านและการเขียนเบื้องต้น" : "การใช้ภาษาในชีวิตประจำวัน", hours: 40, task: "ใบงาน แบบฝึกหัด และการสังเกตพฤติกรรม" });
  d = await api(`/api/courses/${course.id}/units`, "POST", { term_number: t, unit_no: 2, title: t === 1 ? "วรรณคดีและวรรณกรรม" : "หลักการใช้ภาษาไทย", hours: 40, task: "ชิ้นงาน" });
  const us = d.units.filter((u) => u.term_number === t);
  d = await api(`/api/courses/${course.id}/items`, "POST", { items: [
    ...maxes.map((m, k) => ({ term_number: t, kind: "indicator", code: `ท ${1 + (k % 5)}.1 ป.4/${k + 1}`, title: `ตัวชี้วัดทดสอบข้อที่ ${k + 1} ของภาคเรียนที่ ${t}`, max_score: m, unit_id: us[k < K / 2 ? 0 : 1].id })),
    { term_number: t, kind: "final", title: `สอบปลายภาค ${t}`, max_score: 15 }] });
}
const S = d.students.filter((s) => s.enrollment_status === "enrolled");
check(S.length === N, `นักเรียนในห้อง ${S.length} คน (ควร ${N})`);
const its = (t) => d.items.filter((i) => Number(i.term_number) === t);
// คะแนน: นักเรียนคนที่ n ได้สัดส่วน p ของคะแนนเต็มทุกช่อง (ตัดทศนิยมเกิน 2 ตำแหน่งทิ้ง) → รู้คำตอบล่วงหน้า
const p = (n) => 0.4 + ((n * 37) % 61) / 100;
const val = (m, n) => Math.floor(m * p(n) * 100) / 100;
const expect = new Map();
const changes = [];
S.forEach((s, n) => {
  let total = 0;
  for (const t of [1, 2]) for (const it of its(t)) { const v = val(it.max_score, n); total += v; changes.push({ item_id: it.id, student_id: s.id, score: v }); }
  total = Number(total.toFixed(2));
  expect.set(s.id, { total, grade: gradeFromTotal(total) });
});
const save = await api(`/api/courses/${course.id}/scores`, "PUT", { changes });
check(save.ok, "บันทึกคะแนนทั้งตาราง");
console.log(`บันทึกคะแนน ${changes.length} ช่องในครั้งเดียว`);
const w = await api(`/api/courses/${course.id}/submit`, "POST", {});
await api(`/api/courses/${course.id}/submit`, "POST", { force: true, expect_rev: w.data_rev });
d = await api(`/api/courses/${course.id}`);
let wrong = 0;
for (const s of S) { const k = d.computed[s.id], e = expect.get(s.id); if (Math.abs(k.total - e.total) > 1e-9 || String(k.grade) !== e.grade) { wrong++; fails.push(`${s.name}: ได้ ${k.total}/${k.grade} ควร ${e.total}/${e.grade}`); } }
console.log(`ตรวจผลการเรียน ${S.length} คน: ผิด ${wrong}`);

await login("admin@test.local");
await api("/api/admin/courses/review", "POST", { course_ids: [course.id] });
await api("/api/admin/courses/approve", "POST", { course_ids: [course.id] });
await page.goto(`${BASE}/print/pp5.html?course=${course.id}`);
await page.waitForSelector(".sheet");
await page.pdf({ path: `${OUT}/pp5-${N}คน-${K}ตัวชี้วัด.pdf`, preferCSSPageSize: true, printBackground: true });
const info = await page.evaluate(() => [...document.querySelectorAll(".sheet")].map((s) => ({ land: s.classList.contains("land"), title: (s.querySelector(".doc-head, h2, h3, .head")?.innerText || s.innerText).split("\n")[0].slice(0, 60), rows: s.querySelectorAll("tbody tr").length })));
// แต่ละส่วนต้องจบในหน้าเดียว: วัดความสูงจริงตอนพิมพ์เทียบพื้นที่หน้ากระดาษ (A4 หักขอบตาม @page)
await page.emulateMedia({ media: "print" });
const fitInfo = await page.evaluate(() => [...document.querySelectorAll(".sheet")].map((s) => {
  const land = s.classList.contains("land"), mm = 96 / 25.4;
  s.style.width = `${land ? 271 : 178}mm`;
  const h = s.scrollHeight / mm, room = land ? 186 : 269;
  s.style.width = "";
  return { land, h: Math.round(h), room };
}));
await page.emulateMedia({ media: "screen" });
fitInfo.forEach((f, i) => { info[i].h = f.h; info[i].room = f.room; if (f.h > f.room) fails.push(`ส่วนที่ ${i + 1} (${info[i].title.slice(0, 30)}) สูง ${f.h} มม. เกินหน้า ${f.room} มม.`); });
const txt = await page.evaluate(() => document.body.innerText);
check(!/NaN|undefined|null/.test(txt), "ปพ.5 มีข้อความ NaN/undefined/null");
await page.goto(`${BASE}/print/pp6.html?grade=${encodeURIComponent("ป.4")}&room=1`);
await page.waitForSelector(".sheet");
await page.pdf({ path: `${OUT}/pp6-${N}คน.pdf`, preferCSSPageSize: true, printBackground: true });
const pp6 = await page.evaluate(() => document.querySelectorAll(".sheet").length);
check(pp6 === N, `ปพ.6 ${pp6} หน้า (ควร ${N})`);
await browser.close(); server.close();

console.log("ส่วนต่าง ๆ ของ ปพ.5:");
for (const [i, x] of info.entries()) console.log(`  ${i + 1}. ${x.land ? "แนวนอน" : "แนวตั้ง"} · ${x.rows} แถว · สูง ${x.h}/${x.room} มม. · ${x.title}`);
console.log(`ปพ.6 ${pp6} หน้า`);
if (fails.length) { console.error("\nพบปัญหา:\n- " + fails.join("\n- ")); process.exit(1); }
console.log("ผ่านทุกข้อ");
