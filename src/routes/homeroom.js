import { json, readJson, fail, requireUser, intParam, text, audit, batchAll } from "../lib/http.js";
import { resolveYear, roomRoster, isHomeroomTeacher, assessmentsFor, yearResultsForStudents, studentName, isPrimaryGrade } from "../lib/data.js";
import { ASSESSMENT_KEYS, validAssessmentValue } from "../../public/js/grading.js";

const REASONS = ["sick", "personal", "unknown", "other"];
export const COMMENT_FIELDS = ["learn", "habit", "health", "other"];

async function roomContext(env, user, url) {
  const year = await resolveYear(env, url.searchParams.get("year"));
  const grade = text(url.searchParams.get("grade"), 10);
  const room = text(url.searchParams.get("room"), 10);
  if (!isPrimaryGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
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
      students: roster.map((s) => ({ id: s.id, number: s.number, student_code: s.student_code, name: studentName(s), enrollment_status: s.enrollment_status, gender: s.gender, birth_date: s.birth_date })),
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

  if (sub === "absences" && method === "POST") {
    const { year, grade, room } = await roomContext(env, user, url);
    const roster = new Set((await roomRoster(env, year.id, grade, room)).map((s) => s.id));
    const b = await readJson(request);
    const sid = intParam(b.student_id, "นักเรียน");
    if (!roster.has(sid)) fail(400, "นักเรียนไม่อยู่ในห้องนี้");
    const dates = [...new Set((Array.isArray(b.dates) ? b.dates : [b.absence_date]).filter(Boolean))];
    if (!dates.length || dates.length > 60) fail(400, "กรุณาเลือกวันที่ขาดเรียน (ไม่เกิน 60 วันต่อครั้ง)");
    for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) fail(400, `วันที่ ${d} ไม่ถูกต้อง`);
    const reason = REASONS.includes(b.reason) ? b.reason : "unknown";
    const note = text(b.note, 300) || null;
    await batchAll(env, dates.map((d) => env.DB.prepare(`INSERT INTO gr_absences (academic_year_id, student_id, absence_date, reason, note, recorded_by) VALUES (?,?,?,?,?,?)
      ON CONFLICT(student_id, absence_date) DO UPDATE SET reason = excluded.reason, note = excluded.note, recorded_by = excluded.recorded_by`)
      .bind(year.id, sid, d, reason, note, user.id)));
    await audit(env, user, "absence.add", { sid, dates, reason });
    return json({ ok: true, absences: await listAbsences(env, year.id, [...roster]) });
  }

  if (sub === "absences" && parts[3] && method === "DELETE") {
    const { year, grade, room } = await roomContext(env, user, url);
    const roster = await roomRoster(env, year.id, grade, room);
    const row = await env.DB.prepare("SELECT * FROM gr_absences WHERE id = ?").bind(intParam(parts[3])).first();
    if (!row || !roster.some((s) => s.id === row.student_id)) fail(404, "ไม่พบรายการ");
    await env.DB.prepare("DELETE FROM gr_absences WHERE id = ?").bind(row.id).run();
    await audit(env, user, "absence.delete", row);
    return json({ ok: true, absences: await listAbsences(env, year.id, roster.map((s) => s.id)) });
  }

  fail(404, "ไม่พบเส้นทาง API");
}

export async function listAbsences(env, yearId, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT id, student_id, absence_date, reason, note FROM gr_absences WHERE academic_year_id = ? AND student_id IN (${chunk.map(() => "?").join(",")}) ORDER BY absence_date`
    ).bind(yearId, ...chunk).all();
    for (const r of results) (out[r.student_id] ||= []).push(r);
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
