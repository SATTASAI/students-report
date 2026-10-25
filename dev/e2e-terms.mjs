// ทดสอบการทำงานรายภาคเรียน: เลือกภาค → หน้ารายวิชา/ประจำชั้น/เอกสาร และ ปพ.5 / ปพ.6 ของภาค 1 และภาค 2 (สรุปทั้งปี)
// node dev/e2e-terms.mjs <โฟลเดอร์>  (ต้องเปิด dev server ที่พอร์ต 8787 ก่อน — ข้อมูลสะอาด)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = "http://localhost:8787";
const OUT = process.argv[2] || "/tmp";
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };
const browser = await chromium.launch();

async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, locale: "th-TH" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (!/^(term 1|no rooms|empty)$/.test(e.message)) errors.push(`pageerror ${email} ${page.url()}: ${e.message}`); });
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.googleapis|cdnjs|ERR_|Failed to load resource/.test(m.text())) errors.push(`console ${email}: ${m.text()}`); });
  await page.goto(`${BASE}/login.html`);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "test-password-1");
  await page.click("#go");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForSelector("#main:not([hidden])");
  return page;
}
const admin = await login("admin@test.local");
const api = (path, method = "GET", body) => admin.evaluate(async ([path, method, body]) => {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + " " + JSON.stringify(j)); return j;
}, [path, method, body]);

// ---------- ข้อมูลตัวอย่าง ป.4/1: 2 วิชา 2 ภาค, คะแนนครบ (เว้นว่าง 1 ช่องในภาค 2 ของนักเรียน 1 คน) ----------
await api("/api/admin/import/subjects", "POST", { rows: [
  { grade_level: "ป.4", code: "ท14101", name: "ภาษาไทย", learning_area: "ภาษาไทย", subject_type: "พื้นฐาน", hours_per_year: "160" },
  { grade_level: "ป.4", code: "ค14101", name: "คณิตศาสตร์", learning_area: "คณิตศาสตร์", subject_type: "พื้นฐาน", hours_per_year: "160" }] });
await api("/api/admin/import/teachers", "POST", { rows: [{ room: "ป.4/1", code: "ท14101", teachers: "ครูสมใจ ใจดี" }, { room: "ป.4/1", code: "ค14101", teachers: "ครูสมใจ ใจดี" }] });
await api("/api/admin/import/homerooms", "POST", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] });
const { courses } = await api("/api/admin/courses");
const mine = courses.filter((c) => c.grade_level === "ป.4" && c.classroom === "1");
check(mine.length === 2, `ต้องมี 2 รายวิชาของ ป.4/1 (ได้ ${mine.length})`);
let studs;
for (const c of mine) {
  let d;
  for (const t of [1, 2]) d = await api(`/api/courses/${c.id}/items`, "POST", { items: [
    { term_number: t, kind: "indicator", code: `ท 1.1 ป.4/${t}`, title: `อ่าน ภาค ${t}`, max_score: 20 },
    { term_number: t, kind: "indicator", code: `ท 2.1 ป.4/${t}`, title: `เขียน ภาค ${t}`, max_score: 15 },
    { term_number: t, kind: "final", title: `สอบปลายภาค ${t}`, max_score: 15 }] });
  studs = d.students.filter((x) => x.enrollment_status === "enrolled");
  const changes = [];
  studs.forEach((st, n) => d.items.forEach((it, k) => {
    if (n === 0 && it.term_number === 2 && it.kind === "final") return; // คนแรก: ปลายภาค 2 ยังไม่กรอก
    changes.push({ item_id: it.id, student_id: st.id, score: Math.round(it.max_score * (0.4 + ((n * 5 + k * 3 + c.id) % 12) / 20) * 2) / 2 });
  }));
  await api(`/api/courses/${c.id}/scores`, "PUT", { changes });
}
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;
const [s1, s2] = studs;
// มาเรียน: ภาค 1 (ก.ย.) และภาค 2 (พ.ย.)
await api(`/api/homeroom/attendance?${Q}`, "PUT", { changes: [
  { student_id: s1.id, date: "2026-09-01", code: "ข" }, { student_id: s1.id, date: "2026-09-02", code: "ป" }, { student_id: s1.id, date: "2026-09-03", code: "ส" },
  { student_id: s1.id, date: "2026-11-03", code: "ล" }, { student_id: s2.id, date: "2026-11-04", code: "ข" }] });
await api(`/api/homeroom/comments?${Q}`, "PUT", { term: 1, changes: [{ student_id: s1.id, field: "learn", body: "ความเห็นภาคหนึ่ง" }] });
await api(`/api/homeroom/comments?${Q}`, "PUT", { term: 2, changes: [{ student_id: s1.id, field: "learn", body: "ความเห็นภาคสอง" }] });
await api(`/api/homeroom/body?${Q}`, "PUT", { changes: [{ student_id: s1.id, round: 1, weight: 30.5, height: 135 }, { student_id: s1.id, round: 3, weight: 32, height: 137 }] });
await api(`/api/homeroom/assessments?${Q}`, "PUT", { changes: Array.from({ length: 8 }, (_, i) => ({ student_id: s1.id, item_key: `trait_${i + 1}`, value: "3" })) });

// ---------- API ----------
const me = await api("/api/me");
check(me.terms?.length === 2 && me.current_term === 2, `api/me ต้องมีภาคเรียน 2 ภาคและภาคปัจจุบัน (ช่วงปิดภาค → ภาค 2): ${JSON.stringify([me.terms?.length, me.current_term])}`);
const rep = await api(`/api/reports/room?${Q}`);
const att = rep.students.find((x) => x.id === s1.id).attendance;
check(att["ข"] === 1 && att["ล"] === 1 && att.by_term[1]["ข"] === 1 && att.by_term[1]["ป"] === 1 && att.by_term[1]["ส"] === 1 && !att.by_term[1]["ล"] && att.by_term[2]["ล"] === 1,
  `การมาเรียนแยกภาคไม่ถูกต้อง ${JSON.stringify(att)}`);
const ab1 = await api(`/api/reports/absence?${Q}&student=${s1.id}&term=1`), ab2 = await api(`/api/reports/absence?${Q}&student=${s1.id}&term=2`);
check(ab1.absences.length === 2 && ab2.absences.length === 1, `หนังสือแจ้งรายภาค: ภาค 1 = ${ab1.absences.length} (ต้อง 2), ภาค 2 = ${ab2.absences.length} (ต้อง 1)`);

// ---------- หน้าเว็บ (ครู) ----------
const t = await login("teacher1@test.local");
await t.goto(`${BASE}/`);
await t.waitForSelector("#termCards .term-card");
check(await t.locator('#termCards .term-card[aria-pressed="true"]').getAttribute("data-term") === "2", "ค่าเริ่มต้นต้องเป็นภาคปัจจุบัน (ภาค 2)");
await t.screenshot({ path: `${OUT}/terms-index-t2.png` });
await t.click('#termCards .term-card[data-term="1"]');
await t.waitForURL(/term=1/);
await t.waitForSelector('#termCards .term-card[data-term="1"][aria-pressed="true"]');
check(await t.locator("#termBand.t1").count() === 1, "หน้าแรกต้องมีแถบภาคเรียนที่ 1");
check((await t.locator(".course-row").first().innerText()).includes("ภาค 1"), "ความคืบหน้าในหน้าแรกต้องเป็นของภาค 1");
await t.screenshot({ path: `${OUT}/terms-index-t1.png` });
// รายวิชา ภาค 1
await t.locator(".course-row").first().click();
await t.waitForSelector("#sheet");
check(new URL(t.url()).searchParams.get("term") === "1", "ลิงก์รายวิชาต้องพาภาคเรียนไปด้วย");
const heads1 = await t.locator("#sheet thead th").allInnerTexts();
check(heads1.some((h) => h.includes("อ่าน ภาค 1")) && !heads1.some((h) => h.includes("ภาค 2")), `ตารางภาค 1 ต้องมีเฉพาะช่องภาค 1: ${heads1.join("|")}`);
check(!heads1.some((h) => h.includes("รวมทั้งปี")) && heads1.some((h) => h.includes("สถานะ")), "ตารางภาค 1 ไม่แสดงรวมทั้งปี/ผล");
check(await t.locator("#submitBtn").isHidden(), "ภาค 1 ต้องไม่มีปุ่มส่งผล (ส่งผลทั้งปีที่ภาค 2)");
await t.screenshot({ path: `${OUT}/terms-course-t1.png` });
await t.click('#tabs button[data-tab="sum"]');
await t.waitForSelector(".list tbody tr");
const sumHead1 = await t.locator(".list thead").innerText();
check(sumHead1.includes("รวมภาค 1") && !sumHead1.includes("ผลการเรียน"), `สรุปผลภาค 1 ต้องไม่ตัดเกรด: ${sumHead1}`);
await t.click('#tabs button[data-tab="setup"]');
check(await t.locator("#view h2", { hasText: "ภาคเรียนที่ 2" }).count() === 0, "โครงสร้างภาค 1 ต้องไม่แสดงภาค 2");
// สลับไปภาค 2 จากแถบภาคเรียน
await t.click("#termBand button");
await t.waitForURL(/term=2/);
await t.click('#tabs button[data-tab="sheet"]');
await t.waitForSelector("#sheet");
const heads2 = await t.locator("#sheet thead th").allInnerTexts();
check(heads2.some((h) => h.includes("อ่าน ภาค 2")) && !heads2.some((h) => h.includes("อ่าน ภาค 1")) && heads2.some((h) => h.includes("รวมทั้งปี")) && heads2.some((h) => /^ภาค 1/.test(h)), `ตารางภาค 2 ต้องมีช่องภาค 2 + คะแนนภาค 1 + รวมทั้งปี: ${heads2.join("|")}`);
check(await t.locator("#submitBtn").isVisible(), "ภาค 2 ต้องมีปุ่มส่งผล");
await t.screenshot({ path: `${OUT}/terms-course-t2.png` });
await t.click('#tabs button[data-tab="sum"]');
await t.waitForSelector(".list tbody tr");
const sumHead2 = await t.locator(".list thead").innerText();
check(sumHead2.includes("ภาค 1 (50)") && sumHead2.includes("ภาค 2 (50)") && sumHead2.includes("ผลการเรียน"), `สรุปผลทั้งปีต้องมีภาค 1 ภาค 2 และผลการเรียน: ${sumHead2}`);
// ประจำชั้น
await t.goto(`${BASE}/homeroom.html?${Q}&term=1`);
await t.waitForSelector("#tabs button");
const hrTabs1 = await t.locator("#tabs button").allInnerTexts();
check(!hrTabs1.some((x) => x.includes("คุณลักษณะ")) && hrTabs1.some((x) => x.includes("ความคิดเห็น ปพ.6 ภาค 1")), `แท็บประจำชั้นภาค 1: ${hrTabs1.join("|")}`);
await t.click('#tabs button[data-tab="attend"]');
await t.waitForSelector("#mSel");
const months1 = await t.locator("#mSel option").evaluateAll((o) => o.map((x) => x.value));
check(months1.length && months1.every((m) => m >= "2026-05" && m <= "2026-10"), `เดือนของภาค 1: ${months1}`);
await t.click('#tabs button[data-tab="comments"]');
await t.waitForSelector(".cm-row");
check(await t.locator(`.cm-row[data-sid="${s1.id}"] textarea[data-f="learn"]`).inputValue() === "ความเห็นภาคหนึ่ง", "ความคิดเห็นภาค 1");
await t.click('#tabs button[data-tab="body"]');
await t.waitForSelector("#sheet");
check((await t.locator("#sheet thead").innerText()).includes("ครั้งที่ 1") && !(await t.locator("#sheet thead").innerText()).includes("ครั้งที่ 3"), "น้ำหนักส่วนสูงภาค 1 = ครั้งที่ 1–2");
await t.click('#tabs button[data-tab="grades"]');
await t.waitForSelector("table.sheet");
await t.screenshot({ path: `${OUT}/terms-homeroom-t1.png` });
await t.goto(`${BASE}/homeroom.html?${Q}&term=2`);
await t.waitForSelector("#tabs button");
const hrTabs2 = await t.locator("#tabs button").allInnerTexts();
check(hrTabs2.some((x) => x.includes("คุณลักษณะ")) && hrTabs2.some((x) => x.includes("ความคิดเห็น ปพ.6 ภาค 2")), `แท็บประจำชั้นภาค 2: ${hrTabs2.join("|")}`);
await t.click('#tabs button[data-tab="attend"]');
await t.waitForSelector("#mSel");
const months2 = await t.locator("#mSel option").evaluateAll((o) => o.map((x) => x.value));
check(months2.length && months2.every((m) => m >= "2026-11" && m <= "2027-03"), `เดือนของภาค 2: ${months2}`);
await t.click('#tabs button[data-tab="comments"]');
await t.waitForSelector(".cm-row");
check(await t.locator(`.cm-row[data-sid="${s1.id}"] textarea[data-f="learn"]`).inputValue() === "ความเห็นภาคสอง", "ความคิดเห็นภาค 2");
await t.screenshot({ path: `${OUT}/terms-homeroom-t2.png` });
// กิจกรรม: ภาค 1 แจ้งให้ไปภาค 2
await t.goto(`${BASE}/activities.html?term=1`);
await t.waitForSelector("#toT2");
await t.goto(`${BASE}/activities.html?term=2`);
await t.waitForSelector("#sheet");
// บันทึกประจำวัน: เฉพาะเดือนของภาค
await t.goto(`${BASE}/logs.html?term=1`);
await t.waitForSelector("#mSel");
const lm = await t.locator("#mSel option").evaluateAll((o) => o.map((x) => x.value));
check(lm.every((m) => m <= "2026-10"), `บันทึกประจำวันภาค 1: ${lm}`);
// คลังเอกสาร
for (const term of [1, 2]) {
  await t.goto(`${BASE}/docs.html?term=${term}`);
  await t.waitForSelector(".room-docs");
  const hrefs = await t.locator(".room-docs a[href*='/print/pp']").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  check(hrefs.length && hrefs.every((h) => h.includes(`term=${term}`)), `ลิงก์เอกสารภาค ${term} ต้องมี term=${term}: ${hrefs}`);
  check((await t.locator(".room-docs a[href*='pp1.html']").count()) === 0, "ปพ.1 ไม่อยู่ในห้อง ป.4");
  await t.screenshot({ path: `${OUT}/terms-docs-t${term}.png`, fullPage: true });
}

// ---------- ปพ.6 ----------
const grade = (x) => x == null ? "" : String(x);
for (const term of [1, 2]) {
  await t.goto(`${BASE}/print/pp6.html?year=1&${Q}&term=${term}`);
  await t.waitForSelector("section.sheet");
  const pages = await t.locator("section.sheet").evaluateAll((ss) => ss.map((s) => ({ text: s.innerText, rows: [...s.querySelectorAll("table")[0].querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.innerText.trim())) })));
  check(pages.length === rep.students.length, `ปพ.6 ภาค ${term} ต้องมี ${rep.students.length} หน้า (ได้ ${pages.length})`);
  rep.students.forEach((st, i) => {
    const pg = pages[i];
    check(pg.text.includes(`ภาคเรียนที่ ${term} ปีการศึกษา 2569`), `ปพ.6 ภาค ${term} หัวกระดาษ`);
    for (const sj of st.subjects) {
      const row = pg.rows.find((r) => r[0] === sj.code);
      if (!row) { errors.push(`ปพ.6 ภาค ${term} ${st.name} ไม่มีแถว ${sj.code}`); continue; }
      const ts = (n) => { const x = sj.term_scores?.[n]; return x && x.complete ? String(x.total) : ""; };
      if (term === 1) {
        check(row[5] === ts(1), `ปพ.6 ภาค 1 ${st.name} ${sj.code} รวม ${row[5]} ≠ ${ts(1)}`);
        check(row.length === 7, `ปพ.6 ภาค 1 ต้องไม่มีคอลัมน์ผลการเรียน (${row.length})`);
      } else {
        check(row[3] === ts(1) && row[4] === ts(2), `ปพ.6 ภาค 2 ${st.name} ${sj.code} ภาค1/ภาค2 ${row[3]}/${row[4]} ≠ ${ts(1)}/${ts(2)}`);
        const total = sj.total == null || sj.missing || sj.total_max !== 100 ? "" : String(sj.total);
        check(row[5] === total, `ปพ.6 ภาค 2 ${st.name} ${sj.code} รวม ${row[5]} ≠ ${total}`);
        check(row[6] === grade(sj.grade), `ปพ.6 ภาค 2 ${st.name} ${sj.code} เกรด ${row[6]} ≠ ${grade(sj.grade)}`);
        if (row[3] && row[4] && row[5]) check(Math.abs(Number(row[3]) + Number(row[4]) - Number(row[5])) < 1e-9, `ปพ.6 ภาค 2 ${st.name} ${sj.code} ภาค 1 + ภาค 2 ≠ รวม`);
      }
    }
    if (st.id === s1.id) {
      if (term === 1) {
        check(pg.text.includes("ความเห็นภาคหนึ่ง") && !pg.text.includes("ความเห็นภาคสอง"), "ปพ.6 ภาค 1 ใช้ความคิดเห็นภาค 1");
        check(pg.text.includes("น้ำหนัก 30.5"), "ปพ.6 ภาค 1 ใช้น้ำหนักครั้งที่ 1–2");
        check(!pg.text.includes("คุณลักษณะอันพึงประสงค์\tดีเยี่ยม"), "ปพ.6 ภาค 1 ไม่มีผลคุณลักษณะ");
      } else {
        check(pg.text.includes("ความเห็นภาคสอง"), "ปพ.6 ภาค 2 ใช้ความคิดเห็นภาค 2");
        check(pg.text.includes("น้ำหนัก 32"), "ปพ.6 ภาค 2 ใช้น้ำหนักครั้งล่าสุดของปี");
        check(/ดีเยี่ยม/.test(pg.text), "ปพ.6 ภาค 2 มีผลคุณลักษณะ");
      }
    }
  });
  {
    const attRows = await t.locator("section.sheet").first().locator("table", { hasText: "เวลาเรียน (วัน)" }).locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((x) => x.innerText.trim())));
    const want = [["ภาคเรียนที่ 1", "1", "0", "1", "1"], ...(term === 2 ? [["ภาคเรียนที่ 2", "0", "1", "0", "0"], ["รวมทั้งปี", "1", "1", "1", "1"]] : [])];
    check(JSON.stringify(attRows) === JSON.stringify(want), `ปพ.6 ภาค ${term} ตารางเวลาเรียน: ${JSON.stringify(attRows)}`);
  }
  await t.screenshot({ path: `${OUT}/terms-pp6-t${term}.png`, fullPage: false });
  await t.pdf({ path: `${OUT}/terms-pp6-t${term}.pdf`, preferCSSPageSize: true, printBackground: true });
}

// ---------- ปพ.5 ----------
for (const c of mine) {
  const d = await api(`/api/courses/${c.id}`);
  for (const term of [1, 2]) {
    await t.goto(`${BASE}/print/pp5.html?course=${c.id}&term=${term}`);
    await t.waitForSelector("section.sheet");
    const heads = await t.locator("section.sheet .center b").allInnerTexts();
    const has = (re) => heads.some((h) => re.test(h));
    if (term === 1) {
      check(!has(/ภาคเรียนที่ 2/) && !has(/คุณลักษณะ/) && !has(/สรุปผลการเรียนรายวิชา/), `ปพ.5 ภาค 1 ต้องไม่มีส่วนของภาค 2/ทั้งปี: ${heads.join(" | ")}`);
      check(has(/ผลการประเมินตัวชี้วัด ภาคเรียนที่ 1/) && has(/สรุปผลการประเมินตัวชี้วัด ภาคเรียนที่ 1/), "ปพ.5 ภาค 1 ต้องมีตัวชี้วัดและสรุปผลภาค 1");
      check(await t.locator(".draft-mark").count() === 0, "ปพ.5 ภาค 1 ไม่มีลายน้ำฉบับร่าง");
    } else {
      check(has(/ภาคเรียนที่ 1/) && has(/ภาคเรียนที่ 2/) && has(/สรุปผลการเรียนรายวิชา/) && has(/คุณลักษณะ/), `ปพ.5 ภาค 2 ต้องสรุปภาค 1 และทั้งปี: ${heads.join(" | ")}`);
    }
    // สรุปผลรายภาค: คอลัมน์รวม = term_scores
    const sumSheets = await t.locator("section.sheet", { hasText: "สรุปผลการประเมินตัวชี้วัด ภาคเรียนที่" }).evaluateAll((ss) => ss.map((s) => ({ h: s.querySelector(".center b").innerText, rows: [...s.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((x) => x.innerText.trim())) })));
    for (const sh of sumSheets) {
      const tn = Number(sh.h.match(/ภาคเรียนที่ (\d)/)[1]);
      d.students.forEach((st, i) => {
        const x = d.computed[st.id].term_scores?.[tn];
        const want = x && x.complete ? String(x.total) : "";
        check(sh.rows[i]?.[10] === want, `ปพ.5 ${c.code} สรุปภาค ${tn} ${st.name}: ${sh.rows[i]?.[10]} ≠ ${want}`);
      });
    }
    // เวลาเรียน
    const attRow = await t.locator("section.sheet", { hasText: "บันทึกเวลาเรียน" }).locator("tbody tr").first().evaluate((tr) => [...tr.children].map((x) => x.innerText.trim()));
    if (term === 1) check(JSON.stringify(attRow.slice(3, 8)) === JSON.stringify(["1", "", "1", "1", "2"]), `ปพ.5 ภาค 1 เวลาเรียน ${JSON.stringify(attRow)}`);
    else check(JSON.stringify(attRow.slice(3, 10)) === JSON.stringify(["1", "1", "1", "1", "2", "1", "3"]), `ปพ.5 ภาค 2 เวลาเรียน ${JSON.stringify(attRow)}`);
    if (term === 2) {
      const yr = await t.locator("section.sheet", { hasText: "สรุปผลการเรียนรายวิชา" }).locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((x) => x.innerText.trim())));
      d.students.forEach((st, i) => {
        const k = d.computed[st.id], t1 = k.term_scores?.[1], t2 = k.term_scores?.[2];
        const want = [t1 && t1.complete ? String(t1.total) : "–", t2 && t2.complete ? String(t2.total) : "–", k.total_max === 100 && k.total != null && !k.missing ? String(k.total) : "–", k.original_grade == null ? "–" : String(k.original_grade)];
        check(JSON.stringify(yr[i].slice(2, 6)) === JSON.stringify(want), `ปพ.5 ${c.code} สรุปทั้งปี ${st.name}: ${JSON.stringify(yr[i].slice(2, 6))} ≠ ${JSON.stringify(want)}`);
      });
    } else {
      const cover = await t.locator("section.sheet").first().innerText();
      const done = d.students.filter((st) => st.enrollment_status === "enrolled" && d.computed[st.id].term_scores?.[1]?.complete).length;
      check(cover.includes("ภาคเรียนที่ 1 ปีการศึกษา 2569") && cover.includes(`${done}`), "ปก ปพ.5 ภาค 1");
    }
    await t.screenshot({ path: `${OUT}/terms-pp5-${c.code}-t${term}.png`, fullPage: false });
    if (c === mine[0]) await t.pdf({ path: `${OUT}/terms-pp5-t${term}.pdf`, preferCSSPageSize: true, printBackground: true });
  }
}
// ปพ.5 ทั้งห้อง + เอกสารอื่นเปิดได้
for (const url of [`/print/pp5.html?year=1&${Q}&term=1`, `/print/pp5.html?year=1&${Q}&term=2`, `/print/body.html?year=1&${Q}&term=1`, `/print/body.html?year=1&${Q}&term=2`,
  `/print/absence-letter.html?year=1&${Q}&student=${s1.id}&term=1`, `/print/kinder.html?year=1&grade=${encodeURIComponent("อ.3")}&room=1&term=1`, `/print/kinder.html?year=1&grade=${encodeURIComponent("อ.3")}&room=1&mode=room&term=2`]) {
  await admin.goto(BASE + url);
  await admin.waitForSelector("section.sheet, .status", { timeout: 15000 });
  await admin.waitForTimeout(300);
  const st = await admin.locator(".status").allInnerTexts();
  if (st.length && !url.includes("kinder")) errors.push(`${url}: ${st.join(" ")}`);
}
await admin.goto(`${BASE}/print/absence-letter.html?year=1&${Q}&student=${s1.id}&term=1`);
await admin.waitForSelector("section.sheet");
check((await admin.locator("section.sheet").innerText()).includes("ภาคเรียนที่ 1 ปีการศึกษา 2569 รวม 2 วัน"), "หนังสือแจ้งผู้ปกครองภาค 1");
await admin.goto(`${BASE}/print/body.html?year=1&${Q}&term=1`);
await admin.waitForSelector("section.sheet");
check(!(await admin.locator("section.sheet").first().innerText()).includes("ครั้งที่ 3"), "แบบบันทึกน้ำหนักภาค 1 = ครั้งที่ 1–2");

await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("e2e-terms ok");
