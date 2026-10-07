import { json, fail, requireUser, requireAdmin, intParam, text } from "../lib/http.js";
import {
  resolveYear, listYears, getSettings, listRooms, roomRoster, isHomeroomTeacher, yearResultsForStudents,
  assessmentsFor, absenceCounts, studentName, isPrimaryGrade, isSchoolGrade, isKinderGrade, compareGrade,
} from "../lib/data.js";
import { courseOverview } from "./admin.js";
import { listAbsences, commentsFor } from "./homeroom.js";
import { weightedGPA, NUMERIC_GRADES } from "../../public/js/grading.js";

export async function handleMe(request, env, user, url) {
  requireUser(user);
  const years = await listYears(env);
  const year = await resolveYear(env, url.searchParams.get("year"));
  const settings = await getSettings(env, year.id);
  const all = user.is_admin ? await courseOverview(env, year.id) : null;
  const mine = all ? all.filter((c) => c.teachers.some((t) => t.id === user.id)) : await courseOverview(env, year.id, { teacherId: user.id });
  const { results: homerooms } = await env.DB.prepare(
    "SELECT grade_level, classroom FROM gr_homerooms WHERE academic_year_id = ? AND user_id = ?"
  ).bind(year.id, user.id).all();
  const rooms = await listRooms(env, year.id);
  for (const h of homerooms) h.students = rooms.find((r) => r.grade_level === h.grade_level && r.classroom === h.classroom)?.students || 0;
  const summary = user.is_admin ? {
    courses: all.length,
    without_teacher: all.filter((c) => !c.teachers.length).length,
    locked: all.filter((c) => c.locked).length,
    avg_progress: all.length ? Math.round(all.reduce((a, c) => a + c.progress, 0) / all.length) : 0,
  } : null;
  return json({
    user: { id: user.id, full_name: user.full_name, role: user.role, grade_role: user.grade_role || null, is_admin: user.is_admin, is_super: user.is_super, can_import: !!user.can_import },
    years, year, settings: { entry_open: settings.entry_open, school_name: settings.school_name },
    courses: mine, homerooms, summary,
  });
}

async function roomParams(env, user, url, { allowHomeroom = true } = {}) {
  const year = await resolveYear(env, url.searchParams.get("year"));
  const grade = text(url.searchParams.get("grade"), 10);
  const room = text(url.searchParams.get("room"), 10);
  if (!isSchoolGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
  if (!user.is_admin && !(allowHomeroom && await isHomeroomTeacher(env, user, year.id, grade, room))) fail(403, "ดูได้เฉพาะครูประจำชั้นของห้องนี้หรือผู้ดูแล");
  return { year, grade, room };
}

// ข้อมูลสำหรับ ปพ.6 และไฟล์ส่งออกของห้อง
async function roomReport(env, year, grade, room, onlyStudent) {
  let roster = await roomRoster(env, year.id, grade, room);
  if (onlyStudent) roster = roster.filter((s) => s.id === onlyStudent);
  const ids = roster.map((s) => s.id);
  const [grades, assessments, absences, settings, homeroom, comments] = await Promise.all([
    yearResultsForStudents(env, year.id, grade, ids),
    assessmentsFor(env, year.id, ids),
    absenceCounts(env, year.id, ids),
    getSettings(env, year.id),
    env.DB.prepare("SELECT u.full_name FROM gr_homerooms h JOIN users u ON u.id = h.user_id WHERE h.academic_year_id = ? AND h.grade_level = ? AND h.classroom = ?")
      .bind(year.id, grade, room).all().then((r) => r.results.map((x) => x.full_name)),
    commentsFor(env, year.id, ids),
  ]);
  return {
    year, grade, room, settings, homeroom_teachers: homeroom,
    students: roster.map((s) => ({
      id: s.id, number: s.number, student_code: s.student_code, national_id: s.national_id, name: studentName(s),
      birth_date: s.birth_date, gender: s.gender, enrollment_status: s.enrollment_status, transfer_in_term: s.transfer_in_term || null,
      subjects: grades[s.id] || [], gpa: weightedGPA(grades[s.id] || []),
      assessments: assessments[s.id] || {}, absent_days: absences[s.id] || 0, comments: comments[s.id] || {},
    })),
  };
}

export async function handleReports(request, env, user, parts, method, url) {
  requireUser(user);
  if (method !== "GET") fail(405, "ไม่รองรับ");
  const kind = parts[2];

  if (kind === "room") {
    const { year, grade, room } = await roomParams(env, user, url);
    const student = url.searchParams.get("student") ? intParam(url.searchParams.get("student")) : null;
    return json(await roomReport(env, year, grade, room, student));
  }

  // คลังเอกสาร: ห้องและรายวิชาที่ผู้ใช้ออกเอกสารได้
  // ผู้ดูแล/ทีมวัดผล/ผู้บริหาร = ทุกห้อง (เฉพาะห้องนำร่องถ้าตั้งไว้), ครูประจำชั้น = ทั้งห้องของตน, ครูผู้สอน = เฉพาะวิชาที่สอน
  if (kind === "docs") {
    const year = await resolveYear(env, url.searchParams.get("year"));
    const [all, rooms, settings] = await Promise.all([courseOverview(env, year.id), listRooms(env, year.id), getSettings(env, year.id)]);
    const primary = rooms.filter((r) => isSchoolGrade(r.grade_level)); // อนุบาลมีเฉพาะหนังสือแจ้งผู้ปกครอง
    const key = (g, r) => `${g}/${r}`;
    // ครูผู้สอน (หรือผู้ดูแลที่สลับมาดูในบทบาทครู ?scope=mine) เห็นเฉพาะห้องที่เป็นครูประจำชั้น + รายวิชาที่ตัวเองสอน
    const asAdmin = user.is_admin && url.searchParams.get("scope") !== "mine";
    let full = new Set();
    if (asAdmin) full = new Set(primary.map((r) => key(r.grade_level, r.classroom)).filter((k) => !settings.pilot_rooms || settings.pilot_rooms.includes(k)));
    else {
      const { results } = await env.DB.prepare("SELECT grade_level, classroom FROM gr_homerooms WHERE academic_year_id = ? AND user_id = ?").bind(year.id, user.id).all();
      full = new Set(results.map((h) => key(h.grade_level, h.classroom)));
    }
    const out = [];
    for (const r of primary) {
      const k = key(r.grade_level, r.classroom);
      const mine = all.filter((c) => c.grade_level === r.grade_level && c.classroom === r.classroom && (full.has(k) || c.teachers.some((t) => t.id === user.id)));
      if (!full.has(k) && !mine.length) continue;
      out.push({ grade_level: r.grade_level, classroom: r.classroom, students: r.students, full: full.has(k), kinder: isKinderGrade(r.grade_level),
        courses: mine.map((c) => ({ id: c.id, code: c.code, name: c.name, status: c.status, item_count: c.item_count })) });
    }
    return json({ year, rooms: out, school: asAdmin, scope: asAdmin ? "all" : "mine" });
  }

  // รายวิชาของห้องที่ผู้ใช้พิมพ์ ปพ.5 ได้ (ผู้ดูแล/ครูประจำชั้น = ทุกวิชา, ครูผู้สอน = วิชาที่สอน)
  if (kind === "room-courses") {
    const year = await resolveYear(env, url.searchParams.get("year"));
    const grade = text(url.searchParams.get("grade"), 10), room = text(url.searchParams.get("room"), 10);
    if (!isPrimaryGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
    const all = (await courseOverview(env, year.id)).filter((c) => c.grade_level === grade && c.classroom === room);
    const full = user.is_admin || await isHomeroomTeacher(env, user, year.id, grade, room);
    const list = full ? all : all.filter((c) => c.teachers.some((t) => t.id === user.id));
    if (!list.length && !full) fail(403, "ไม่มีรายวิชาของห้องนี้ที่คุณสอน");
    return json({ year, grade, room, courses: list.map((c) => ({ id: c.id, code: c.code, name: c.name, status: c.status, item_count: c.item_count })) });
  }

  if (kind === "absence") {
    const { year, grade, room } = await roomParams(env, user, url);
    const sid = intParam(url.searchParams.get("student"), "นักเรียน");
    const roster = await roomRoster(env, year.id, grade, room);
    const s = roster.find((r) => r.id === sid);
    if (!s) fail(404, "ไม่พบนักเรียนในห้องนี้");
    const detail = await env.DB.prepare(
      `SELECT guardian_prefix, guardian_first_name, guardian_last_name, guardian_relationship,
              house_number, village_no, road_soi, subdistrict, district, province FROM student_details WHERE student_id = ?`
    ).bind(sid).first();
    const absences = (await listAbsences(env, year.id, [sid]))[sid] || [];
    return json({ year, grade, room, settings: await getSettings(env, year.id), student: { ...s, name: studentName(s) }, guardian: detail || {}, absences });
  }

  if (kind === "pp1") {
    const sid = intParam(url.searchParams.get("student"), "นักเรียน");
    const s = await env.DB.prepare(
      `SELECT s.*, d.gender, d.father_prefix, d.father_first_name, d.father_last_name, d.mother_prefix, d.mother_first_name, d.mother_last_name,
              d.nationality, d.religion FROM students s LEFT JOIN student_details d ON d.student_id = s.id WHERE s.id = ?`
    ).bind(sid).first();
    if (!s) fail(404, "ไม่พบนักเรียน");
    const { results: enrolls } = await env.DB.prepare(
      `SELECT y.id AS year_id, y.year_be, se.grade_level, se.classroom, t.term_number
         FROM student_enrollments se JOIN academic_terms t ON t.id = se.academic_term_id JOIN academic_years y ON y.id = t.academic_year_id
        WHERE se.student_id = ? ORDER BY y.year_be, t.term_number`
    ).bind(sid).all();
    const perYear = {};
    for (const e of enrolls) perYear[e.year_id] = e; // ภาคสุดท้ายของปีทับ
    const years = Object.values(perYear).filter((e) => isPrimaryGrade(e.grade_level)).sort((a, b) => a.year_be - b.year_be);
    if (!user.is_admin) {
      const last = years[years.length - 1];
      if (!last || !(await isHomeroomTeacher(env, user, last.year_id, last.grade_level, last.classroom))) fail(403, "ดูได้เฉพาะครูประจำชั้นหรือผู้ดูแล");
    }
    const out = [];
    for (const y of years) {
      const res = await yearResultsForStudents(env, y.year_id, y.grade_level, [sid]);
      const ass = await assessmentsFor(env, y.year_id, [sid]);
      out.push({ year_be: y.year_be, grade_level: y.grade_level, classroom: y.classroom, subjects: res[sid] || [], gpa: weightedGPA(res[sid] || []), assessments: ass[sid] || {} });
    }
    const settings = years.length ? await getSettings(env, years[years.length - 1].year_id) : await getSettings(env, (await resolveYear(env)).id);
    return json({ student: { ...s, name: studentName(s) }, years: out, settings });
  }

  if (kind === "summary") {
    requireAdmin(user);
    const year = await resolveYear(env, url.searchParams.get("year"));
    const rooms = (await listRooms(env, year.id)).filter((r) => isPrimaryGrade(r.grade_level));
    const grades = [...new Set(rooms.map((r) => r.grade_level))].sort(compareGrade);
    const bySubject = {};
    const byRoom = [];
    for (const g of grades) {
      for (const r of rooms.filter((x) => x.grade_level === g)) {
        const roster = await roomRoster(env, year.id, g, r.classroom);
        const ids = roster.map((s) => s.id);
        const res = await yearResultsForStudents(env, year.id, g, ids);
        const gpas = [];
        for (const sid of ids) {
          const list = res[sid] || [];
          const gp = weightedGPA(list);
          if (gp != null) gpas.push(gp);
          for (const sub of list) {
            const key = `${g}|${sub.code}`;
            const row = bySubject[key] ||= { grade_level: g, code: sub.code, name: sub.name, learning_area: sub.learning_area, subject_type: sub.subject_type, counts: {}, n: 0, sum: 0, graded: 0 };
            const grade = sub.grade ?? "ยังไม่มีผล";
            row.counts[grade] = (row.counts[grade] || 0) + 1;
            row.n++;
            if (NUMERIC_GRADES.includes(grade)) { row.sum += Number(grade); row.graded++; }
          }
        }
        byRoom.push({ grade_level: g, classroom: r.classroom, students: ids.length, avg_gpa: gpas.length ? Math.floor((gpas.reduce((a, b) => a + b, 0) / gpas.length) * 100) / 100 : null });
      }
    }
    const subjects = Object.values(bySubject).map((r) => ({
      ...r, mean: r.graded ? Math.floor((r.sum / r.graded) * 100) / 100 : null,
      good_pct: r.graded && r.n ? Math.round((((r.counts["4"] || 0) + (r.counts["3.5"] || 0) + (r.counts["3"] || 0)) / r.n) * 1000) / 10 : null,
    })).sort((a, b) => compareGrade(a.grade_level, b.grade_level) || (a.subject_type === "additional") - (b.subject_type === "additional") || a.code.localeCompare(b.code));
    return json({ year, settings: await getSettings(env, year.id), subjects, rooms: byRoom });
  }

  if (kind === "progress") {
    requireAdmin(user);
    const year = await resolveYear(env, url.searchParams.get("year"));
    return json({ year, courses: await courseOverview(env, year.id) });
  }

  fail(404, "ไม่พบรายงาน");
}
