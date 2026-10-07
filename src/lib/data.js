import { fail } from "./http.js";
import { computeStudentResult } from "../../public/js/grading.js";

export const DEFAULT_SETTINGS = {
  collect_ratio: 70, indicator_pass_pct: 50, attendance_pass_pct: 80,
  school_name: "โรงเรียนบ้านป่าเด็ง", school_area: "", director_name: "", academic_head_name: "",
  measurement_head_name: "", entry_open: 1, roster_order: "gender",
  indicator_pass_pct_t2: null, deputy_director_name: "", affiliation: "สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน",
  pilot_rooms: null, school_address: "อำเภอแก่งกระจาน จังหวัดเพชรบุรี",
};

export async function listYears(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, year_be, label, status, start_date, end_date FROM academic_years ORDER BY year_be DESC"
  ).all();
  return results;
}

export async function resolveYear(env, value) {
  if (value) {
    const row = await env.DB.prepare("SELECT id, year_be, label, status FROM academic_years WHERE id = ?").bind(Number(value)).first();
    if (!row) fail(404, "ไม่พบปีการศึกษา");
    return row;
  }
  const row = await env.DB.prepare(
    "SELECT id, year_be, label, status FROM academic_years ORDER BY (status = 'active') DESC, year_be DESC LIMIT 1"
  ).first();
  if (!row) fail(404, "ยังไม่มีปีการศึกษาในระบบ — ให้ตั้งค่าที่ระบบบริหารโรงเรียนก่อน");
  return row;
}

export async function getSettings(env, yearId) {
  const row = await env.DB.prepare("SELECT * FROM gr_settings WHERE academic_year_id = ?").bind(yearId).first();
  const out = { ...DEFAULT_SETTINGS, academic_year_id: yearId };
  for (const [k, v] of Object.entries(row || {})) if (v != null || !(k in DEFAULT_SETTINGS)) out[k] = v;
  if (!out.affiliation) out.affiliation = DEFAULT_SETTINGS.affiliation;
  out.pilot_rooms = parsePilotRooms(out.pilot_rooms);
  return out;
}

// ห้องนำร่อง: ["ป.4/2"] หรือ null (= เปิดใช้ทุกห้อง)
export function parsePilotRooms(v) {
  if (Array.isArray(v)) return v.length ? v : null;
  if (!v) return null;
  try { const a = JSON.parse(v); return Array.isArray(a) && a.length ? a.map(String) : null; } catch { return null; }
}

// ห้องเรียนทั้งหมดของปี: นับจากภาคเรียนล่าสุดที่นักเรียนแต่ละคนลงทะเบียน (เฉพาะที่ยังเรียนอยู่)
export async function listRooms(env, yearId) {
  const { results } = await env.DB.prepare(
    `${ROSTER_CTE}
     SELECT grade_level, classroom, SUM(CASE WHEN status = 'enrolled' THEN 1 ELSE 0 END) AS students
       FROM ranked WHERE rn = 1 AND grade_level IS NOT NULL AND classroom IS NOT NULL
      GROUP BY grade_level, classroom`
  ).bind(yearId).all();
  return results.sort(compareRoom);
}

const GRADE_ORDER = ["อ.1", "อ.2", "อ.3", "ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];
export function compareGrade(a, b) {
  const ia = GRADE_ORDER.indexOf(a), ib = GRADE_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b), "th");
}
export function compareRoom(a, b) {
  return compareGrade(a.grade_level, b.grade_level) ||
    String(a.classroom).localeCompare(String(b.classroom), "th", { numeric: true });
}
export const isPrimaryGrade = (g) => /^ป\.[1-6]$/.test(g);

const ROSTER_CTE = `WITH ranked AS (
  SELECT se.student_id, se.grade_level, se.classroom, se.status,
         ROW_NUMBER() OVER (PARTITION BY se.student_id ORDER BY t.term_number DESC, se.id DESC) AS rn
    FROM student_enrollments se JOIN academic_terms t ON t.id = se.academic_term_id
   WHERE t.academic_year_id = ?)`;

const STUDENT_COLUMNS = `s.id, s.student_code, s.national_id, s.name_prefix, s.first_name, s.last_name, s.full_name, s.birth_date, d.gender`;

// สถานะที่ถือว่า "ออกจากระบบ" (soft delete): ไม่แสดงในรายชื่อใด ๆ แต่ข้อมูลและคะแนนยังเก็บไว้ รับกลับได้ด้วยเลขประจำตัวเดิม
export const LEFT_STATUSES = ["transferred", "withdrawn"];
const LEFT_SQL = `('transferred','withdrawn')`;
const TRANSFER_IN_SQL = `(SELECT MIN(t.term_number) FROM gr_transfers t WHERE t.student_id = s.id AND t.academic_year_id = ? AND t.direction = 'in' AND t.undone_at IS NULL)`;

// รายชื่อนักเรียนของห้อง ณ ภาคเรียนล่าสุดของปีนั้น (ไม่รวมคนที่ย้ายออก/ออกกลางคัน)
export async function roomRoster(env, yearId, grade, room) {
  const { results } = await env.DB.prepare(
    `${ROSTER_CTE}
     SELECT ${STUDENT_COLUMNS}, r.status AS enrollment_status, ${TRANSFER_IN_SQL} AS transfer_in_term
       FROM ranked r JOIN students s ON s.id = r.student_id
       LEFT JOIN student_details d ON d.student_id = s.id
      WHERE r.rn = 1 AND r.grade_level = ? AND r.classroom = ? AND r.status NOT IN ${LEFT_SQL}`
  ).bind(yearId, yearId, grade, room).all();
  return sortRoster(results, (await getSettings(env, yearId)).roster_order);
}

// รายชื่อของรายวิชา = นักเรียนในห้อง + คนที่ย้ายห้อง (ยังเรียนอยู่ในโรงเรียน) แต่มีคะแนนในรายวิชานี้แล้ว
export async function courseRoster(env, course) {
  const roster = await roomRoster(env, course.academic_year_id, course.grade_level, course.classroom);
  const ids = new Set(roster.map((s) => s.id));
  const { results: extra } = await env.DB.prepare(
    `${ROSTER_CTE}
     SELECT DISTINCT ${STUDENT_COLUMNS}, 'moved' AS enrollment_status
       FROM students s LEFT JOIN student_details d ON d.student_id = s.id
       LEFT JOIN ranked r ON r.student_id = s.id AND r.rn = 1
      WHERE s.id IN (SELECT sc.student_id FROM gr_scores sc JOIN gr_items i ON i.id = sc.item_id WHERE i.course_id = ?
                     UNION SELECT student_id FROM gr_results WHERE course_id = ?)
        AND COALESCE(r.status, 'enrolled') NOT IN ${LEFT_SQL}`
  ).bind(course.academic_year_id, course.id, course.id).all();
  for (const s of extra) if (!ids.has(s.id)) roster.push(s);
  return sortRoster(roster, (await getSettings(env, course.academic_year_id)).roster_order);
}

// เลขที่ในห้อง: นักเรียนที่ยังเรียนอยู่ขึ้นก่อน (ชายก่อนหญิง แล้วตามเลขประจำตัว หรือตามเลขประจำตัวอย่างเดียว
// ตามที่ตั้งค่า) — นักเรียนย้ายเข้าระหว่างปีต่อท้ายเสมอ เลขที่ของคนเดิมจึงไม่เลื่อน — แล้วตามด้วยคนที่ย้ายห้อง (ไม่มีเลขที่)
// สำคัญ: ลำดับนี้ต้องตรงกับรายชื่อในห้อง เพราะครูวางคะแนนจาก Excel ตามลำดับเลขที่
const genderRank = (g) => (/^(ช|ชาย|M)/i.test(g || "") ? 0 : /^(ญ|หญิง|F)/i.test(g || "") ? 1 : 2);
function sortRoster(rows, order = "gender") {
  const active = (r) => (r.enrollment_status || "enrolled") !== "moved" && !LEFT_STATUSES.includes(r.enrollment_status);
  const late = (r) => (r.transfer_in_term ? 1 : 0);
  rows.sort((a, b) => active(b) - active(a) || late(a) - late(b) ||
    (order === "gender" ? genderRank(a.gender) - genderRank(b.gender) : 0) ||
    String(a.student_code).localeCompare(String(b.student_code), "th", { numeric: true }));
  let n = 0;
  for (const r of rows) r.number = active(r) ? ++n : null;
  return rows;
}

// คะแนนยกมา: { student_id: { subject_code: { term: {collect, final, total} } } }
export async function carryoverFor(env, yearId, studentIds) {
  const out = {};
  for (let i = 0; i < studentIds.length; i += 90) {
    const chunk = studentIds.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT student_id, subject_code, term_number, collect, final, total FROM gr_carryover WHERE academic_year_id = ? AND student_id IN (${chunk.map(() => "?").join(",")})`
    ).bind(yearId, ...chunk).all();
    for (const r of results) (((out[r.student_id] ||= {})[r.subject_code]) ||= {})[r.term_number] = { collect: r.collect, final: r.final, total: r.total };
  }
  return out;
}

export function studentName(s) {
  if (s.first_name || s.last_name) return `${s.name_prefix || ""}${s.first_name || ""} ${s.last_name || ""}`.trim();
  return s.full_name;
}

export async function loadCourse(env, courseId) {
  const course = await env.DB.prepare(
    `SELECT c.id, c.classroom, c.locked, c.submitted_at, c.submitted_by, c.subject_id,
            c.approved_at, c.approved_by, c.return_note, c.returned_at,
            (SELECT full_name FROM users WHERE id = c.submitted_by) AS submitted_by_name,
            (SELECT full_name FROM users WHERE id = c.approved_by) AS approved_by_name,
            (SELECT full_name FROM users WHERE id = c.returned_by) AS returned_by_name,
            s.academic_year_id, s.grade_level, s.code, s.name, s.learning_area, s.subject_type,
            s.hours_per_year, s.collect_ratio, y.year_be, s.template IS NOT NULL AS has_template, s.template_updated_at
       FROM gr_courses c JOIN gr_subjects s ON s.id = c.subject_id
       JOIN academic_years y ON y.id = s.academic_year_id
      WHERE c.id = ?`
  ).bind(courseId).first();
  if (!course) fail(404, "ไม่พบรายวิชา");
  const { results: teachers } = await env.DB.prepare(
    `SELECT u.id, u.full_name FROM gr_course_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.course_id = ? ORDER BY u.full_name`
  ).bind(courseId).all();
  course.teachers = teachers;
  course.status = courseStatus(course);
  const { results: homeroom } = await env.DB.prepare(
    "SELECT u.full_name FROM gr_homerooms h JOIN users u ON u.id = h.user_id WHERE h.academic_year_id = ? AND h.grade_level = ? AND h.classroom = ? ORDER BY u.full_name"
  ).bind(course.academic_year_id, course.grade_level, course.classroom).all();
  course.homeroom_teachers = homeroom.map((h) => h.full_name);
  return course;
}

// สถานะของ ห้อง × วิชา: draft (กำลังกรอก) → submitted (ส่งแล้ว, ล็อก) → approved (อนุมัติแล้ว)
export function courseStatus(c) {
  if (!c.locked) return "draft";
  return c.approved_at ? "approved" : "submitted";
}

export function canViewCourse(user, course) {
  return user.is_admin || course.teachers.some((t) => t.id === user.id);
}

export async function assertCourseAccess(env, user, courseId, { write = false } = {}) {
  const course = await loadCourse(env, courseId);
  if (!canViewCourse(user, course)) fail(403, "คุณไม่ได้รับมอบหมายให้สอนรายวิชานี้");
  if (write) {
    if (course.locked) fail(409, course.approved_at ? "รายวิชานี้อนุมัติผลแล้ว ต้องให้ฝ่ายวิชาการส่งคืนพร้อมเหตุผลก่อนแก้ไข" : "รายวิชานี้ส่งแล้ว ต้องให้ฝ่ายวิชาการส่งคืนก่อนแก้ไข");
    const settings = await getSettings(env, course.academic_year_id);
    if (!settings.entry_open && !user.is_admin) fail(409, "ปิดระบบการกรอกคะแนนของปีการศึกษานี้แล้ว");
  }
  return course;
}

// ข้อมูลครบชุดของรายวิชา + ผลการเรียนที่คำนวณแล้ว
export async function courseBundle(env, course) {
  const settings = await getSettings(env, course.academic_year_id);
  const [items, units, roster, scoreRows, resultRows] = await Promise.all([
    env.DB.prepare("SELECT id, term_number, kind, code, title, max_score, sort_order, unit_id FROM gr_items WHERE course_id = ? ORDER BY term_number, kind = 'final', sort_order, id")
      .bind(course.id).all().then((r) => r.results),
    env.DB.prepare("SELECT id, term_number, unit_no, title, hours, task FROM gr_units WHERE course_id = ? ORDER BY term_number, unit_no, id")
      .bind(course.id).all().then((r) => r.results),
    courseRoster(env, course),
    env.DB.prepare("SELECT sc.item_id, sc.student_id, sc.score, sc.remedial FROM gr_scores sc JOIN gr_items i ON i.id = sc.item_id WHERE i.course_id = ?")
      .bind(course.id).all().then((r) => r.results),
    env.DB.prepare("SELECT * FROM gr_results WHERE course_id = ?").bind(course.id).all().then((r) => r.results),
  ]);
  const scores = {}, remedials = {};
  for (const r of scoreRows) {
    if (r.score != null) (scores[r.student_id] ||= {})[r.item_id] = r.score;
    if (r.remedial != null) (remedials[r.student_id] ||= {})[r.item_id] = r.remedial;
  }
  const results = Object.fromEntries(resultRows.map((r) => [r.student_id, r]));
  const calcSettings = gradeSettings(course, settings);
  const allCarry = await carryoverFor(env, course.academic_year_id, roster.map((s) => s.id));
  const carry = {};
  for (const s of roster) if (allCarry[s.id]?.[course.code]) carry[s.id] = allCarry[s.id][course.code];
  const computed = {};
  for (const s of roster) computed[s.id] = computeStudentResult(items, scores[s.id] || {}, results[s.id] || {}, calcSettings, remedials[s.id] || {}, carry[s.id]);
  return { course, settings, items, units, roster, scores, remedials, results, computed, carry };
}

export function gradeSettings(course, settings) {
  return {
    collect_ratio: course.collect_ratio,
    hours_per_year: course.hours_per_year,
    attendance_pass_pct: settings.attendance_pass_pct,
    indicator_pass_pct: settings.indicator_pass_pct,
    indicator_pass_pct_t2: settings.indicator_pass_pct_t2,
    finalized: !!course.locked,
  };
}

export async function isHomeroomTeacher(env, user, yearId, grade, room) {
  if (user.is_admin) return true;
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM gr_homerooms WHERE academic_year_id = ? AND grade_level = ? AND classroom = ? AND user_id = ?"
  ).bind(yearId, grade, room, user.id).first();
  return !!row;
}

// ผลการเรียนทุกวิชาของนักเรียนหลายคนในปีเดียว (ใช้ทำ ปพ.6 / สรุป / ส่งออก)
export async function yearResultsForStudents(env, yearId, grade, studentIds) {
  if (!studentIds.length) return {};
  const settings = await getSettings(env, yearId);
  const { results: courses } = await env.DB.prepare(
    `SELECT c.id, c.classroom, c.locked, s.academic_year_id, s.grade_level, s.code, s.name, s.learning_area, s.subject_type,
            s.hours_per_year, s.collect_ratio, s.sort_order
       FROM gr_courses c JOIN gr_subjects s ON s.id = c.subject_id
      WHERE s.academic_year_id = ? AND s.grade_level = ?
      ORDER BY s.subject_type, s.sort_order, s.code`
  ).bind(yearId, grade).all();
  const out = Object.fromEntries(studentIds.map((id) => [id, []]));
  if (!courses.length) return out;
  const courseIds = courses.map((c) => c.id);
  const ph = courseIds.map(() => "?").join(",");
  const [items, scoreRows, resultRows] = await Promise.all([
    env.DB.prepare(`SELECT id, course_id, term_number, kind, max_score FROM gr_items WHERE course_id IN (${ph})`).bind(...courseIds).all().then((r) => r.results),
    env.DB.prepare(`SELECT sc.item_id, sc.student_id, sc.score, sc.remedial, i.course_id FROM gr_scores sc JOIN gr_items i ON i.id = sc.item_id WHERE i.course_id IN (${ph})`).bind(...courseIds).all().then((r) => r.results),
    env.DB.prepare(`SELECT * FROM gr_results WHERE course_id IN (${ph})`).bind(...courseIds).all().then((r) => r.results),
  ]);
  const itemsByCourse = {};
  for (const i of items) (itemsByCourse[i.course_id] ||= []).push(i);
  const scoreIdx = {};
  const remIdx = {};
  for (const r of scoreRows) {
    if (r.score != null) ((scoreIdx[`${r.course_id}:${r.student_id}`]) ||= {})[r.item_id] = r.score;
    if (r.remedial != null) ((remIdx[`${r.course_id}:${r.student_id}`]) ||= {})[r.item_id] = r.remedial;
  }
  const resIdx = Object.fromEntries(resultRows.map((r) => [`${r.course_id}:${r.student_id}`, r]));
  const hasData = new Set([...scoreRows.map((r) => `${r.course_id}:${r.student_id}`), ...resultRows.map((r) => `${r.course_id}:${r.student_id}`)]);

  // นักเรียนอยู่ห้องไหน → ใช้รายวิชาของห้องนั้น; ถ้ามีคะแนนในห้องอื่น (ย้ายห้อง) ให้ใช้ห้องที่มีข้อมูล
  const roomOf = {};
  for (let i = 0; i < studentIds.length; i += 90) {
    const chunk = studentIds.slice(i, i + 90);
    const { results: rooms } = await env.DB.prepare(
      `${ROSTER_CTE} SELECT student_id, classroom FROM ranked WHERE rn = 1 AND student_id IN (${chunk.map(() => "?").join(",")})`
    ).bind(yearId, ...chunk).all();
    for (const r of rooms) roomOf[r.student_id] = r.classroom;
  }

  const carry = await carryoverFor(env, yearId, studentIds);
  const bySubject = {};
  for (const c of courses) (bySubject[c.code] ||= []).push(c);
  for (const sid of studentIds) {
    for (const code of Object.keys(bySubject)) {
      const options = bySubject[code];
      const course = options.find((c) => hasData.has(`${c.id}:${sid}`)) || options.find((c) => c.classroom === roomOf[sid]);
      if (!course) continue;
      const key = `${course.id}:${sid}`;
      const calc = computeStudentResult(itemsByCourse[course.id] || [], scoreIdx[key] || {}, resIdx[key] || {}, gradeSettings(course, settings), remIdx[key] || {}, carry[sid]?.[code]);
      out[sid].push({
        course_id: course.id, code: course.code, name: course.name, learning_area: course.learning_area,
        subject_type: course.subject_type, hours_per_year: course.hours_per_year, sort_order: course.sort_order,
        locked: !!course.locked, ...calc, remedial_type: resIdx[key]?.remedial_type || null,
      });
    }
    out[sid].sort((a, b) => (a.subject_type === "additional") - (b.subject_type === "additional") || a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  }
  return out;
}

export async function assessmentsFor(env, yearId, studentIds) {
  if (!studentIds.length) return {};
  const out = {};
  for (let i = 0; i < studentIds.length; i += 90) {
    const chunk = studentIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT student_id, item_key, value FROM gr_assessments WHERE academic_year_id = ? AND student_id IN (${chunk.map(() => "?").join(",")})`
    ).bind(yearId, ...chunk).all();
    for (const r of results) (out[r.student_id] ||= {})[r.item_key] = r.value;
  }
  return out;
}

export async function absenceCounts(env, yearId, studentIds) {
  if (!studentIds.length) return {};
  const out = {};
  for (let i = 0; i < studentIds.length; i += 90) {
    const chunk = studentIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT student_id, COUNT(*) AS days FROM gr_absences WHERE academic_year_id = ? AND student_id IN (${chunk.map(() => "?").join(",")}) GROUP BY student_id`
    ).bind(yearId, ...chunk).all();
    for (const r of results) out[r.student_id] = r.days;
  }
  return out;
}
