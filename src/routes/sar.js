// SAR มาตรฐานที่ 1 — ดึงข้อมูลจากระบบมาคำนวณตัวชี้วัด (ผลการเรียน การประเมินของครูประจำชั้น การมาเรียน แบบบันทึกประจำวัน)
// GET  /api/sar?year=   → ตัวชี้วัดแยกระดับ (ขั้นพื้นฐาน/ปฐมวัย) + ค่าเป้าหมาย/ค่าที่ครูกรอก + ตารางผลสัมฤทธิ์รายชั้น×กลุ่มสาระ
// PUT  /api/sar?year=   → บันทึกค่าเป้าหมาย / ค่าที่กรอกเอง / หมายเหตุ / เกณฑ์ระดับคุณภาพ (ฝ่ายวัดผลและผู้ดูแลระบบ)
import { json, readJson, fail, requireViewer, requireReportViewer, text, audit, batchAll } from "../lib/http.js";
import {
  resolveYear, listRooms, roomRoster, yearResultsForStudents, assessmentsFor, attendanceRates,
  isPrimaryGrade, isKinderGrade, compareGrade, getSettings,
} from "../lib/data.js";
import { ASSESSMENT_GROUPS, summarizeGroup, clean } from "../../public/js/grading.js";
import { SAR_ITEM_KEYS, CORE_AREAS, DEFAULT_LEVELS } from "../../public/js/sar.js";
import { LEARNING_AREAS } from "./admin.js";
import { analyzeBody, setGrowthRefs, HFA_LEVELS } from "../../public/js/growth.js";
import WHO2006 from "../../public/js/growth-who2006.js";
import DOH619 from "../../public/js/growth-doh619.js";
setGrowthRefs({ who: WHO2006, doh: DOH619 });
// กลุ่มสาระเรียงตามหลักสูตรแกนกลาง (ภาษาไทย คณิต วิทย์ …) กลุ่มอื่นของ ป.1–3 ต่อท้าย
const areaRank = (a) => { const i = LEARNING_AREAS.indexOf(a); return i < 0 ? 99 : i; };

const GOOD = new Set(["3", "3.5", "4"]);
const FINAL = new Set(["4", "3.5", "3", "2.5", "2", "1.5", "1", "0", "ร", "มส"]);
const group = (k) => ASSESSMENT_GROUPS.find((g) => g.key === k);
const add = (m, key, ok) => { const r = (m[key] ||= { num: 0, den: 0 }); r.den++; if (ok) r.num++; };

export async function handleSar(request, env, user, parts, method, url) {
  requireReportViewer(user); // ดู: ฝ่ายวิชาการ/วัดผล ผู้บริหาร และผู้ชมภายนอก (แก้ไขได้เฉพาะ can_import)
  const year = await resolveYear(env, url.searchParams.get("year"));
  if (method === "GET") return json(await sarData(env, year));
  if (method === "PUT") {
    if (!user.can_import) fail(403, "แก้ค่าเป้าหมาย SAR ได้เฉพาะฝ่ายวัดผลและผู้ดูแลระบบ (ผู้บริหารดูได้อย่างเดียว)");
    const b = await readJson(request);
    const stmts = [];
    for (const v of (Array.isArray(b.values) ? b.values : []).slice(0, 100)) {
      const key = text(v.item_key, 20);
      if (!SAR_ITEM_KEYS.has(key)) fail(400, `ไม่รู้จักประเด็น ${key}`);
      const num = (x, label) => {
        if (x === "" || x == null) return null;
        const n = Number(x);
        if (!Number.isFinite(n) || n < 0 || n > 100) fail(400, `${key}: ${label}ต้องเป็นร้อยละ 0–100`);
        if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) fail(400, `${key}: ${label}ทศนิยมได้ไม่เกิน 2 ตำแหน่ง`); // ไม่ปัดให้เอง
        return clean(n);
      };
      stmts.push(env.DB.prepare(`INSERT INTO gr_sar_values (academic_year_id, item_key, target, manual_value, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(academic_year_id, item_key) DO UPDATE SET target = excluded.target, manual_value = excluded.manual_value, note = excluded.note,
        updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(year.id, key, num(v.target, "ค่าเป้าหมาย"), num(v.manual_value, "ผลที่กรอก"), text(v.note, 2000) || null, user.id));
    }
    if (b.levels !== undefined) {
      const levels = Array.isArray(b.levels) ? b.levels.slice(0, 5).map((l) => ({ min: Number(l.min), label: text(l.label, 30) })) : null;
      if (levels && levels.some((l) => !l.label || !Number.isFinite(l.min) || l.min < 0 || l.min > 100)) fail(400, "เกณฑ์ระดับคุณภาพไม่ถูกต้อง");
      stmts.push(env.DB.prepare(`INSERT INTO gr_sar_values (academic_year_id, item_key, note, updated_by, updated_at) VALUES (?, '_levels', ?, ?, datetime('now'))
        ON CONFLICT(academic_year_id, item_key) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(year.id, levels ? JSON.stringify(levels) : null, user.id));
    }
    await batchAll(env, stmts);
    await audit(env, user, "sar.update", { year: year.id, items: stmts.length });
    return json({ ok: true, ...(await sarData(env, year)) });
  }
  fail(405, "ไม่รองรับ");
}

export async function sarData(env, year) {
  const rooms = (await listRooms(env, year.id)).filter((r) => isPrimaryGrade(r.grade_level) || isKinderGrade(r.grade_level));
  const metrics = { basic: {}, kinder: {} };
  const byGradeArea = {}; // ผลสัมฤทธิ์รายชั้น × กลุ่มสาระ
  const coverage = { basic: { rooms: 0, students: 0 }, kinder: { rooms: 0, students: 0 } };
  const logs = { basic: {}, kinder: {} }; // แบบบันทึกประจำวัน: type → {num, den}
  const stageIds = { basic: [], kinder: [] };
  let anyAttendance = { basic: false, kinder: false };
  const passPct = Number((await getSettings(env, year.id)).attendance_pass_pct ?? 80); // เกณฑ์เวลาเรียนตามที่ตั้งไว้ (เดิมใช้ 80 ตายตัว)

  for (const r of rooms) {
    const stage = isPrimaryGrade(r.grade_level) ? "basic" : "kinder";
    const m = metrics[stage];
    const roster = (await roomRoster(env, year.id, r.grade_level, r.classroom)).filter((s) => s.enrollment_status === "enrolled");
    const ids = roster.map((s) => s.id);
    if (!ids.length) continue;
    coverage[stage].rooms++; coverage[stage].students += ids.length;
    stageIds[stage].push(...ids);
    await roomNutrition(env, year.id, roster, m);
    await roomLogs(env, year.id, ids, logs[stage]);
    const [att, ass, res] = await Promise.all([
      attendanceRates(env, year.id, ids),
      stage === "basic" ? assessmentsFor(env, year.id, ids) : {},
      stage === "basic" ? yearResultsForStudents(env, year.id, r.grade_level, ids) : {},
    ]);
    for (const sid of ids) {
      const a = att[sid];
      if (a?.days) { if (a.absent) anyAttendance[stage] = true; add(m, "att80", a.pct >= passPct); }
      if (stage !== "basic") continue;
      for (const sub of res[sid] || []) {
        if (!FINAL.has(String(sub.grade))) continue;
        const ok = GOOD.has(String(sub.grade));
        add(m, "all", ok);
        add(m, `area:${sub.learning_area}`, ok);
        if (CORE_AREAS.includes(sub.learning_area)) add(m, "core3", ok);
        const ga = (byGradeArea[`${r.grade_level}|${sub.learning_area}`] ||= { grade_level: r.grade_level, learning_area: sub.learning_area, num: 0, den: 0 });
        ga.den++; if (ok) ga.num++;
      }
      const v = ass[sid] || {};
      const trait = summarizeGroup(group("trait"), v), rtw = summarizeGroup(group("rtw"), v);
      if (trait != null) add(m, "trait_good", Number(trait) >= 2);
      if (rtw != null) add(m, "rtw_good", Number(rtw) >= 2);
      for (const k of ["comp_2", "comp_3", "comp_4", "comp_5", "trait_7"]) if (v[k] != null && v[k] !== "") add(m, k, Number(v[k]) >= 2);
      add(m, "act_pass", summarizeGroup(group("act"), v) === "ผ");
    }
  }
  // ยังไม่มีใครบันทึกการมาเรียน → ทุกคนดูเหมือนมา 100% ซึ่งไม่ใช่ข้อมูลจริง จึงไม่นำมาคิด
  for (const st of ["basic", "kinder"]) if (!anyAttendance[st]) delete metrics[st].att80;

  // แบบบันทึกประจำวัน: ครั้งที่ติ๊ก ÷ วันที่มาเรียนรวม · ตรวจสุขภาพ: สะอาด ÷ ที่ตรวจ
  for (const st of ["basic", "kinder"]) {
    const ids = stageIds[st];
    if (!ids.length) continue;
    const counts = {};
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const { results } = await env.DB.prepare(`SELECT log_type, value, COUNT(*) AS n FROM gr_daily_logs WHERE academic_year_id = ? AND student_id IN (${chunk.map(() => "?").join(",")}) GROUP BY log_type, value`)
        .bind(year.id, ...chunk).all();
      for (const r of results) { const k = `${r.log_type}|${r.value}`; counts[k] = (counts[k] || 0) + r.n; }
    }
    for (const t of ["milk", "brush", "lunch", "duty"]) if (logs[st][t]?.den) metrics[st][t] = logs[st][t];
    let ok = 0, bad = 0;
    for (const [k, n] of Object.entries(counts)) if (k.startsWith("h_")) { if (k.endsWith("|ok")) ok += n; else if (k.endsWith("|no")) bad += n; }
    if (ok + bad) metrics[st].health_clean = { num: ok, den: ok + bad };
  }

  const { results: rows } = await env.DB.prepare("SELECT item_key, target, manual_value, note, updated_at FROM gr_sar_values WHERE academic_year_id = ?").bind(year.id).all();
  const values = {};
  let levels = DEFAULT_LEVELS;
  for (const r of rows) {
    if (r.item_key === "_levels") { try { if (r.note) levels = JSON.parse(r.note); } catch { /* ใช้ค่าเริ่มต้น */ } continue; }
    values[r.item_key] = r;
  }
  const settings = await getSettings(env, year.id);
  return {
    year, school: { name: settings.school_name, director: settings.director_name, affiliation: settings.affiliation },
    metrics, values, levels, coverage,
    grade_area: Object.values(byGradeArea).sort((a, b) => compareGrade(a.grade_level, b.grade_level) || areaRank(a.learning_area) - areaRank(b.learning_area) || a.learning_area.localeCompare(b.learning_area, "th")),
  };
}

// แบบบันทึกประจำวันของ 1 ห้อง: นับเฉพาะวันที่ห้องนั้นใช้แบบบันทึกนั้นจริง (มีการติ๊กอย่างน้อย 1 คน)
// ตัวหาร = นักเรียนในห้อง − คนที่ขาด/ลาในวันนั้น · ห้อง/วันที่ยังไม่เริ่มบันทึก ไม่ถูกนับเป็น 0%
async function roomLogs(env, yearId, ids, acc) {
  const ph = ids.map(() => "?").join(",");
  const [{ results: ticks }, { results: abs }] = await Promise.all([
    env.DB.prepare(`SELECT log_type, log_date, COUNT(*) AS n FROM gr_daily_logs WHERE academic_year_id = ? AND log_type IN ('milk','brush','lunch','duty') AND value = '1'
      AND student_id IN (${ph}) GROUP BY log_type, log_date`).bind(yearId, ...ids).all(),
    env.DB.prepare(`SELECT att_date, COUNT(*) AS n FROM gr_attendance WHERE academic_year_id = ? AND code IN ('ข','ล','ป') AND student_id IN (${ph}) GROUP BY att_date`).bind(yearId, ...ids).all(),
  ]);
  const absent = Object.fromEntries(abs.map((r) => [r.att_date, r.n]));
  for (const r of ticks) {
    const den = Math.max(r.n, ids.length - (absent[r.log_date] || 0));
    const x = (acc[r.log_type] ||= { num: 0, den: 0 });
    x.num += Math.min(r.n, den); x.den += den;
  }
}

// ภาวะโภชนาการ (เกณฑ์กรมอนามัย) จากการชั่งวัดครั้งล่าสุดของแต่ละคนในปีการศึกษา — อายุคิดถึงวันที่บันทึกครั้งนั้น
// นับเฉพาะคนที่ประเมินได้ (มีน้ำหนัก+ส่วนสูง และรู้เพศ; ส่วนสูงตามอายุต้องมีวันเกิดด้วย)
async function roomNutrition(env, yearId, roster, m) {
  const ids = roster.map((s) => s.id);
  const { results } = await env.DB.prepare(`SELECT student_id, round, weight, height, substr(updated_at, 1, 10) AS d FROM gr_body
    WHERE academic_year_id = ? AND weight IS NOT NULL AND height IS NOT NULL AND student_id IN (${ids.map(() => "?").join(",")}) ORDER BY round`).bind(yearId, ...ids).all();
  const last = {};
  for (const r of results) last[r.student_id] = r; // round มากสุดชนะ
  for (const st of roster) {
    const r = last[st.id];
    if (!r) continue;
    const a = analyzeBody(st, r, r.d);
    if (!a) continue;
    if (a.wfh) add(m, "nut_shape", a.wfh.label === "สมส่วน");
    if (a.hfa) add(m, "nut_height", HFA_LEVELS.indexOf(a.hfa.label) >= 2);
    if (a.good != null) add(m, "nut_good", a.good);
  }
}
