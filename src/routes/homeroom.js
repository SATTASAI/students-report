import { json, readJson, fail, requireUser, intParam, text, audit, batchAll } from "../lib/http.js";
import { resolveYear, roomRoster, isHomeroomTeacher, assessmentsFor, yearResultsForStudents, studentName, isSchoolGrade, carryoverFor, schoolCalendar, thaiToday } from "../lib/data.js";
import { ASSESSMENT_KEYS, validAssessmentValue } from "../../public/js/grading.js";

export const ATT_CODES = [["ข", "ขาดเรียน"], ["ล", "ลากิจ"], ["ป", "ลาป่วย"], ["มส", "มาสาย"]];
export const COMMENT_FIELDS = ["learn", "habit", "health", "other"];

async function roomContext(env, user, url) {
  const year = await resolveYear(env, url.searchParams.get("year"));
  const grade = text(url.searchParams.get("grade"), 10);
  const room = text(url.searchParams.get("room"), 10);
  if (!isSchoolGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
  if (!(await isHomeroomTeacher(env, user, year.id, grade, room))) fail(403, "คุณไม่ได้เป็นครูประจำชั้นของห้องนี้");
  return { year, grade, room };
}

export async function handleHomeroom(request, env, user, parts, method, url) {
  requireUser(user);
  const sub = parts[2];

  if (!sub && method === "GET") {
    const { year, grade, room } = await roomContext(env, user, url);
    const roster = await roomRoster(env, year.id, grade, room);
    const ids = roster.map((s) => s.id);
    const [assessments, grades, absences, comments, body, bank] = await Promise.all([
      assessmentsFor(env, year.id, ids),
      yearResultsForStudents(env, year.id, grade, ids),
      listAbsences(env, year.id, ids),
      commentsFor(env, year.id, ids),
      bodyFor(env, year.id, ids),
      env.DB.prepare("SELECT id, field, body FROM gr_comment_bank WHERE user_id = ? ORDER BY field, id").bind(user.id).all().then((r) => r.results),
    ]);
    return json({
      year, grade, room,
      students: roster.map((s) => ({ id: s.id, number: s.number, student_code: s.student_code, name: studentName(s), enrollment_status: s.enrollment_status, gender: s.gender, birth_date: s.birth_date, transfer_in_term: s.transfer_in_term || null })),
      assessments, grades, absences, comments, body, comment_bank: bank,
    });
  }

  if (sub === "assessments" && method === "PUT") {
    const { year, grade, room } = await roomContext(env, user, url);
    const roster = new Set((await roomRoster(env, year.id, grade, room)).map((s) => s.id));
    const b = await readJson(request);
    const changes = Array.isArray(b.changes) ? b.changes.slice(0, 2000) : [];
    const stmts = [];
    for (const c of changes) {
      const sid = Number(c.student_id);
      if (!roster.has(sid)) fail(400, "นักเรียนไม่อยู่ในห้องนี้");
      if (!ASSESSMENT_KEYS.has(c.item_key)) fail(400, "หัวข้อประเมินไม่ถูกต้อง");
      if (c.item_key.startsWith("act_")) fail(400, "บันทึกกิจกรรมพัฒนาผู้เรียนที่หน้า \"กิจกรรมพัฒนาผู้เรียน\"");
      const value = c.value == null ? "" : String(c.value);
      if (!validAssessmentValue(c.item_key, value)) fail(400, "ระดับผลการประเมินไม่ถูกต้อง");
      stmts.push(value === ""
        ? env.DB.prepare("DELETE FROM gr_assessments WHERE academic_year_id = ? AND student_id = ? AND item_key = ?").bind(year.id, sid, c.item_key)
        : env.DB.prepare(`INSERT INTO gr_assessments (academic_year_id, student_id, item_key, value, updated_by, updated_at) VALUES (?,?,?,?,?,datetime('now'))
            ON CONFLICT(academic_year_id, student_id, item_key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`)
          .bind(year.id, sid, c.item_key, value, user.id));
    }
    await batchAll(env, stmts);
    return json({ ok: true, saved: stmts.length });
  }

  // ความคิดเห็นครูประจำชั้น: changes [{student_id, field, body}] (body ว่าง = ลบ)
  if (sub === "comments" && method === "PUT") {
    const { year, grade, room } = await roomContext(env, user, url);
    const roster = new Set((await roomRoster(env, year.id, grade, room)).map((s) => s.id));
    const b = await readJson(request);
    const term = Number(b.term);
    if (![1, 2].includes(term)) fail(400, "ภาคเรียนไม่ถูกต้อง");
    const changes = Array.isArray(b.changes) ? b.changes.slice(0, 1000) : [];
    const stmts = [];
    for (const c of changes) {
      const sid = Number(c.student_id);
      if (!roster.has(sid)) fail(400, "นักเรียนไม่อยู่ในห้องนี้");
      if (!COMMENT_FIELDS.includes(c.field)) fail(400, "หัวข้อความคิดเห็นไม่ถูกต้อง");
      const body = String(c.body ?? "").replace(/\s+/g, " ").trim();
      if (body.length > 300) fail(400, "ความคิดเห็นยาวได้ไม่เกิน 300 ตัวอักษร");
      stmts.push(body
        ? env.DB.prepare(`INSERT INTO gr_comments (academic_year_id, term_number, student_id, field, body, updated_by, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
            ON CONFLICT(academic_year_id, term_number, student_id, field) DO UPDATE SET body = excluded.body, updated_by = excluded.updated_by, updated_at = datetime('now')`)
          .bind(year.id, term, sid, c.field, body, user.id)
        : env.DB.prepare("DELETE FROM gr_comments WHERE academic_year_id = ? AND term_number = ? AND student_id = ? AND field = ?").bind(year.id, term, sid, c.field));
    }
    await batchAll(env, stmts);
    return json({ ok: true, saved: stmts.length });
  }

  // คลังข้อความของครู (ใช้ได้ทุกห้องที่ครูคนนี้ดูแล)
  if (sub === "comment-bank") {
    if (method === "POST") {
      const b = await readJson(request);
      if (!COMMENT_FIELDS.includes(b.field)) fail(400, "หัวข้อไม่ถูกต้อง");
      const body = text(b.body, 300);
      if (!body) fail(400, "กรุณาพิมพ์ข้อความ");
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_comment_bank WHERE user_id = ?").bind(user.id).first();
      if (n.n >= 300) fail(400, "คลังข้อความเต็ม (300 ข้อความ)");
      await env.DB.prepare("INSERT OR IGNORE INTO gr_comment_bank (user_id, field, body) VALUES (?,?,?)").bind(user.id, b.field, body).run();
    } else if (method === "DELETE" && parts[3]) {
      await env.DB.prepare("DELETE FROM gr_comment_bank WHERE id = ? AND user_id = ?").bind(intParam(parts[3]), user.id).run();
    } else fail(405, "ไม่รองรับ");
    const { results } = await env.DB.prepare("SELECT id, field, body FROM gr_comment_bank WHERE user_id = ? ORDER BY field, id").bind(user.id).all();
    return json({ ok: true, comment_bank: results });
  }

  // น้ำหนัก/ส่วนสูง: changes [{student_id, round, weight, height}]
  if (sub === "body" && method === "PUT") {
    const { year, grade, room } = await roomContext(env, user, url);
    const roster = new Set((await roomRoster(env, year.id, grade, room)).map((s) => s.id));
    const b = await readJson(request);
    const changes = Array.isArray(b.changes) ? b.changes.slice(0, 1000) : [];
    const num = (v, lo, hi, label) => {
      if (v === "" || v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= lo || n >= hi) fail(400, `${label}ต้องอยู่ระหว่าง ${lo}–${hi}`);
      return Math.round(n * 10) / 10;
    };
    const stmts = [];
    for (const c of changes) {
      const sid = Number(c.student_id), round = Number(c.round);
      if (!roster.has(sid)) fail(400, "นักเรียนไม่อยู่ในห้องนี้");
      if (![1, 2, 3, 4].includes(round)) fail(400, "ครั้งที่ชั่งต้องเป็น 1–4");
      const w = num(c.weight, 0, 200, "น้ำหนัก (กก.) "), h = num(c.height, 30, 230, "ส่วนสูง (ซม.) ");
      stmts.push(w == null && h == null
        ? env.DB.prepare("DELETE FROM gr_body WHERE academic_year_id = ? AND student_id = ? AND round = ?").bind(year.id, sid, round)
        : env.DB.prepare(`INSERT INTO gr_body (academic_year_id, student_id, round, weight, height, updated_by, updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
            ON CONFLICT(academic_year_id, student_id, round) DO UPDATE SET weight = excluded.weight, height = excluded.height, updated_by = excluded.updated_by, updated_at = datetime('now')`)
          .bind(year.id, sid, round, w, h, user.id));
    }
    await batchAll(env, stmts);
    return json({ ok: true, saved: stmts.length });
  }

  // ---------- บันทึกการมาเรียนรายวัน (ครูประจำชั้น) ----------
  // ตารางรายเดือน นักเรียน × วันเรียน (จันทร์–ศุกร์ในช่วงภาคเรียน) — มาเรียนปกติไม่ต้องใส่ เก็บเฉพาะ ข ล ป มส
  if (sub === "attendance") {
    const { year, grade, room } = await roomContext(env, user, url);
    const roster = await roomRoster(env, year.id, grade, room);
    const ids = new Set(roster.map((s) => s.id));
    const cal = await schoolCalendar(env, year.id);
    const terms = cal.terms;
    const inTerm = (d) => terms.some((t) => d >= t.start_date && d <= t.end_date);
    if (method === "GET") {
      const first = terms[0]?.start_date, last = terms.at(-1)?.end_date;
      const today = thaiToday();
      let month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month")
        : (first && today < first ? first : last && today > last ? last : today).slice(0, 7);
      // วันเรียน = จันทร์–ศุกร์ในภาคเรียน ไม่รวมวันหยุดที่ฝ่ายวัดผลตั้ง (ถ้ายังไม่มีภาคเรียนในระบบ แสดงจันทร์–ศุกร์ทั้งเดือน)
      const days = [];
      for (let d = new Date(`${month}-01T00:00:00Z`); d.toISOString().slice(0, 7) === month; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10), wd = d.getUTCDay();
        if (wd !== 0 && wd !== 6 && (!terms.length || inTerm(iso)) && !cal.off.has(iso)) days.push(iso);
      }
      const holidays = cal.holidays.filter((h) => h.holiday_date.startsWith(month));
      const records = {};
      if (ids.size) {
        const { results } = await env.DB.prepare(
          `SELECT student_id, att_date, code FROM gr_attendance WHERE academic_year_id = ? AND att_date LIKE ? AND student_id IN (${[...ids].map(() => "?").join(",")})`
        ).bind(year.id, `${month}-%`, ...ids).all();
        for (const r of results) (records[r.student_id] ||= {})[r.att_date] = r.code;
      }
      const months = [];
      if (first && last) for (let m = first.slice(0, 7); m <= last.slice(0, 7);) {
        months.push(m);
        const [y, mm] = m.split("-").map(Number);
        m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
      }
      return json({ year, grade, room, month, months, days, today, records, codes: ATT_CODES, terms, holidays });
    }
    if (method === "PUT") {
      const b = await readJson(request);
      const changes = Array.isArray(b.changes) ? b.changes.slice(0, 3000) : [];
      const stmts = [];
      for (const c of changes) {
        const sid = Number(c.student_id), d = String(c.date || ""), code = String(c.code ?? "").trim();
        if (!ids.has(sid)) fail(400, "นักเรียนไม่อยู่ในห้องนี้");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) fail(400, `วันที่ ${d} ไม่ถูกต้อง`);
        if (terms.length && !inTerm(d)) fail(400, `${d} อยู่นอกช่วงภาคเรียน`);
        if (code && cal.off.has(d)) fail(400, `${d} เป็นวันหยุด (${cal.off.get(d)})`);
        if (code && !ATT_CODES.some(([k]) => k === code)) fail(400, "ใส่ได้เฉพาะ ข ล ป มส (มาเรียนปกติเว้นว่าง)");
        stmts.push(code
          ? env.DB.prepare(`INSERT INTO gr_attendance (academic_year_id, student_id, att_date, code, recorded_by, updated_at) VALUES (?,?,?,?,?,datetime('now'))
              ON CONFLICT(student_id, att_date) DO UPDATE SET code = excluded.code, recorded_by = excluded.recorded_by, updated_at = datetime('now')`).bind(year.id, sid, d, code, user.id)
          : env.DB.prepare("DELETE FROM gr_attendance WHERE student_id = ? AND att_date = ?").bind(sid, d));
      }
      await batchAll(env, stmts);
      await audit(env, user, "attendance.update", { grade, room, changes: stmts.length });
      return json({ ok: true, saved: stmts.length });
    }
  }

  // ---------- คะแนนยกมาจาก ปพ.6 ของโรงเรียนเดิม (นักเรียนย้ายเข้าระหว่างปี) ----------
  // กรอกได้เฉพาะภาคเรียนก่อนภาคที่ย้ายเข้า (เช่น ย้ายเข้าภาค 2 → กรอกคะแนนภาค 1 จาก ปพ.6 ที่ติดตัวมา)
  if (sub === "carryover") {
    const { year, grade, room } = await roomContext(env, user, url);
    const roster = await roomRoster(env, year.id, grade, room);
    const movers = roster.filter((s) => s.transfer_in_term > 1);
    const { results: subjects } = await env.DB.prepare(
      `SELECT s.code, s.name, s.subject_type, s.collect_ratio, c.locked FROM gr_courses c JOIN gr_subjects s ON s.id = c.subject_id
        WHERE s.academic_year_id = ? AND s.grade_level = ? AND c.classroom = ? ORDER BY s.subject_type, s.sort_order, s.code`
    ).bind(year.id, grade, room).all();
    if (method === "GET") {
      const ids = movers.map((s) => s.id);
      const schools = ids.length ? (await env.DB.prepare(
        `SELECT student_id, school, move_date FROM gr_transfers WHERE academic_year_id = ? AND direction = 'in' AND undone_at IS NULL AND student_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`
      ).bind(year.id, ...ids).all()).results : [];
      const from = Object.fromEntries(schools.map((r) => [r.student_id, r]));
      return json({
        year, grade, room, subjects: subjects.map((x) => ({ ...x, locked: !!x.locked })),
        students: movers.map((s) => ({ id: s.id, number: s.number, name: studentName(s), student_code: s.student_code, transfer_in_term: s.transfer_in_term,
          terms: [1, 2].filter((t) => t < s.transfer_in_term), school: from[s.id]?.school || null, move_date: from[s.id]?.move_date || null })),
        values: await carryoverFor(env, year.id, ids),
      });
    }
    if (method === "PUT") {
      const b = await readJson(request);
      const byId = new Map(movers.map((s) => [s.id, s]));
      const subj = new Map(subjects.map((x) => [x.code, x]));
      const changes = Array.isArray(b.changes) ? b.changes.slice(0, 500) : [];
      const num = (v, label) => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 50) fail(400, `${label} ต้องอยู่ระหว่าง 0–50`);
        if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) fail(400, `${label} ทศนิยมได้ไม่เกิน 2 ตำแหน่ง`);
        return n;
      };
      const stmts = [];
      for (const c of changes) {
        const st = byId.get(Number(c.student_id));
        if (!st) fail(400, "กรอกคะแนนยกมาได้เฉพาะนักเรียนที่ย้ายเข้าระหว่างปีของห้องนี้");
        const sj = subj.get(String(c.subject_code));
        if (!sj) fail(400, "ไม่พบรายวิชานี้ในห้อง");
        const term = Number(c.term_number);
        if (!(term >= 1 && term < st.transfer_in_term)) fail(400, "กรอกได้เฉพาะภาคเรียนก่อนภาคที่ย้ายเข้า");
        if (sj.locked) fail(409, `${sj.code} ${sj.name} ส่งผลแล้ว ต้องให้ฝ่ายวิชาการส่งคืนก่อนแก้คะแนนยกมา`);
        const label = `${st.name_prefix || ""}${st.first_name || ""} ${sj.code}`;
        const collect = num(c.collect, `${label} ระหว่างภาค`), final = num(c.final, `${label} ปลายภาค`);
        let total = num(c.total, `${label} รวม`);
        if (total == null && collect != null && final != null) total = Math.round((collect + final) * 100) / 100;
        if (collect != null && final != null && Math.abs(collect + final - total) > 1e-6) fail(400, `${label}: ระหว่างภาค + ปลายภาค ต้องเท่ากับคะแนนรวม`);
        if (total == null && (collect != null || final != null)) fail(400, `${label}: กรอกคะแนนรวมของภาค (เต็ม 50)`);
        stmts.push(total == null
          ? env.DB.prepare("DELETE FROM gr_carryover WHERE academic_year_id = ? AND student_id = ? AND subject_code = ? AND term_number = ?").bind(year.id, st.id, sj.code, term)
          : env.DB.prepare(`INSERT INTO gr_carryover (academic_year_id, student_id, subject_code, term_number, collect, final, total, updated_by, updated_at)
              VALUES (?,?,?,?,?,?,?,?,datetime('now'))
              ON CONFLICT(academic_year_id, student_id, subject_code, term_number) DO UPDATE SET collect = excluded.collect, final = excluded.final,
                total = excluded.total, updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(year.id, st.id, sj.code, term, collect, final, total, user.id));
      }
      await batchAll(env, stmts);
      await audit(env, user, "carryover.update", { grade, room, changes: stmts.length });
      return json({ ok: true, values: await carryoverFor(env, year.id, movers.map((s) => s.id)) });
    }
  }

  fail(404, "ไม่พบเส้นทาง API");
}

// วันขาด/ลา (สำหรับหนังสือแจ้งผู้ปกครอง) จากบันทึกการมาเรียน — ไม่รวมมาสาย
const CODE_REASON = { "ข": "unknown", "ล": "personal", "ป": "sick" };
export async function listAbsences(env, yearId, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT student_id, att_date, code FROM gr_attendance WHERE academic_year_id = ? AND code IN ('ข','ล','ป') AND student_id IN (${chunk.map(() => "?").join(",")}) ORDER BY att_date`
    ).bind(yearId, ...chunk).all();
    for (const r of results) (out[r.student_id] ||= []).push({ student_id: r.student_id, absence_date: r.att_date, code: r.code, reason: CODE_REASON[r.code], note: null });
  }
  return out;
}

// ความคิดเห็น: { student_id: { 1: {learn, habit, health, other}, 2: {...} } }
export async function commentsFor(env, yearId, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT student_id, term_number, field, body FROM gr_comments WHERE academic_year_id = ? AND student_id IN (${chunk.map(() => "?").join(",")})`
    ).bind(yearId, ...chunk).all();
    for (const r of results) ((out[r.student_id] ||= {})[r.term_number] ||= {})[r.field] = r.body;
  }
  return out;
}

// น้ำหนักส่วนสูง: { student_id: { 1: {weight, height}, ... } }
export async function bodyFor(env, yearId, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT student_id, round, weight, height FROM gr_body WHERE academic_year_id = ? AND student_id IN (${chunk.map(() => "?").join(",")})`
    ).bind(yearId, ...chunk).all();
    for (const r of results) (out[r.student_id] ||= {})[r.round] = { weight: r.weight, height: r.height };
  }
  return out;
}
