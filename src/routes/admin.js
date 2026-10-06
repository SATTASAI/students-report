import { json, readJson, fail, requireAdmin, intParam, text, audit, batchAll } from "../lib/http.js";
import { resolveYear, getSettings, listRooms, compareRoom, isPrimaryGrade } from "../lib/data.js";

export const LEARNING_AREAS = [
  "ภาษาไทย", "คณิตศาสตร์", "วิทยาศาสตร์และเทคโนโลยี", "สังคมศึกษา ศาสนาและวัฒนธรรม",
  "สุขศึกษาและพลศึกษา", "ศิลปะ", "การงานอาชีพ", "ภาษาต่างประเทศ",
];

// โครงรายวิชาพื้นฐานตามหลักสูตรแกนกลางฯ 2551 (เวลาเรียนต่อปี) — ผู้ดูแลต้องตรวจทานให้ตรงหลักสูตรสถานศึกษา
const BASIC_TEMPLATE = [
  { p: "ท", n: "101", name: "ภาษาไทย", area: 0, lower: 200, upper: 160 },
  { p: "ค", n: "101", name: "คณิตศาสตร์", area: 1, lower: 200, upper: 160 },
  { p: "ว", n: "101", name: "วิทยาศาสตร์และเทคโนโลยี", area: 2, lower: 80, upper: 80 },
  { p: "ส", n: "101", name: "สังคมศึกษา ศาสนาและวัฒนธรรม", area: 3, lower: 80, upper: 80 },
  { p: "ส", n: "102", name: "ประวัติศาสตร์", area: 3, lower: 40, upper: 40 },
  { p: "พ", n: "101", name: "สุขศึกษาและพลศึกษา", area: 4, lower: 80, upper: 80 },
  { p: "ศ", n: "101", name: "ศิลปะ", area: 5, lower: 80, upper: 80 },
  { p: "ง", n: "101", name: "การงานอาชีพ", area: 6, lower: 40, upper: 80 },
  { p: "อ", n: "101", name: "ภาษาอังกฤษ", area: 7, lower: 40, upper: 80 },
];

const PRIMARY_GRADES = ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];

function cleanSubject(body, settings) {
  const grade = text(body.grade_level, 10);
  if (!PRIMARY_GRADES.includes(grade)) fail(400, "ระดับชั้นต้องเป็น ป.1–ป.6");
  const code = text(body.code, 20).replace(/\s+/g, "");
  if (!code) fail(400, "กรุณาระบุรหัสวิชา");
  const name = text(body.name, 120);
  if (!name) fail(400, "กรุณาระบุชื่อวิชา");
  const area = text(body.learning_area, 80);
  if (!LEARNING_AREAS.includes(area) && area !== "อื่น ๆ") fail(400, "กลุ่มสาระไม่ถูกต้อง");
  const type = body.subject_type === "additional" ? "additional" : "basic";
  const hours = Number(body.hours_per_year);
  if (!Number.isInteger(hours) || hours < 1 || hours > 400) fail(400, "เวลาเรียนต้องเป็นจำนวนเต็ม 1–400 ชั่วโมง");
  const ratio = body.collect_ratio == null || body.collect_ratio === "" ? settings.collect_ratio : Number(body.collect_ratio);
  if (!Number.isInteger(ratio) || ratio < 0 || ratio > 100) fail(400, "สัดส่วนคะแนนเก็บต้องเป็น 0–100");
  const sort = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;
  return { grade, code, name, area, type, hours, ratio, sort };
}

export async function handleAdmin(request, env, user, parts, method, url) {
  requireAdmin(user);
  const [, , section, idPart, action] = parts; // /api/admin/<section>/<id>/<action>

  if (section === "settings") {
    const year = await resolveYear(env, url.searchParams.get("year"));
    if (method === "GET") return json({ year, settings: await getSettings(env, year.id) });
    if (method === "PUT") {
      const b = await readJson(request);
      const pct = (v, label) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 100) fail(400, `${label}ต้องเป็น 0–100`); return n; };
      const s = {
        collect_ratio: pct(b.collect_ratio, "สัดส่วนคะแนนเก็บ"),
        indicator_pass_pct: pct(b.indicator_pass_pct, "เกณฑ์ผ่านตัวชี้วัด"),
        attendance_pass_pct: pct(b.attendance_pass_pct, "เกณฑ์เวลาเรียน"),
        school_name: text(b.school_name, 120), school_area: text(b.school_area, 160),
        director_name: text(b.director_name, 120), academic_head_name: text(b.academic_head_name, 120),
        measurement_head_name: text(b.measurement_head_name, 120), entry_open: b.entry_open ? 1 : 0,
        roster_order: b.roster_order === "code" ? "code" : "gender",
      };
      await env.DB.prepare(`INSERT INTO gr_settings (academic_year_id, collect_ratio, indicator_pass_pct, attendance_pass_pct,
          school_name, school_area, director_name, academic_head_name, measurement_head_name, entry_open, roster_order, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(academic_year_id) DO UPDATE SET collect_ratio=excluded.collect_ratio, indicator_pass_pct=excluded.indicator_pass_pct,
          attendance_pass_pct=excluded.attendance_pass_pct, school_name=excluded.school_name, school_area=excluded.school_area,
          director_name=excluded.director_name, academic_head_name=excluded.academic_head_name,
          measurement_head_name=excluded.measurement_head_name, entry_open=excluded.entry_open, roster_order=excluded.roster_order,
          updated_by=excluded.updated_by, updated_at=datetime('now')`)
        .bind(year.id, s.collect_ratio, s.indicator_pass_pct, s.attendance_pass_pct, s.school_name, s.school_area,
          s.director_name, s.academic_head_name, s.measurement_head_name, s.entry_open, s.roster_order, user.id).run();
      await audit(env, user, "settings.update", { year: year.id, ...s });
      return json({ ok: true, settings: await getSettings(env, year.id) });
    }
  }

  if (section === "rooms" && method === "GET") {
    const year = await resolveYear(env, url.searchParams.get("year"));
    return json({ rooms: await listRooms(env, year.id) });
  }

  if (section === "teachers" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.email, u.role, r.role AS grade_role FROM users u LEFT JOIN gr_staff_roles r ON r.user_id = u.id
        WHERE u.status = 'active' AND u.deleted_at IS NULL AND u.role IS NOT NULL ORDER BY u.full_name`
    ).all();
    return json({ teachers: results });
  }

  if (section === "staff-roles") {
    if (method === "PUT") {
      const b = await readJson(request);
      const target = intParam(b.user_id, "ผู้ใช้");
      if (b.grant) {
        await env.DB.prepare(`INSERT INTO gr_staff_roles (user_id, role, granted_by) VALUES (?, 'grade_admin', ?)
          ON CONFLICT(user_id) DO UPDATE SET role='grade_admin', granted_by=excluded.granted_by, granted_at=datetime('now')`).bind(target, user.id).run();
      } else {
        await env.DB.prepare("DELETE FROM gr_staff_roles WHERE user_id = ?").bind(target).run();
      }
      await audit(env, user, "staff_role", { target, grant: !!b.grant });
      return json({ ok: true });
    }
  }

  // ---------- รายวิชา (subjects) ----------
  if (section === "subjects") {
    if (method === "GET" && !idPart) {
      const year = await resolveYear(env, url.searchParams.get("year"));
      const { results } = await env.DB.prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM gr_courses c WHERE c.subject_id = s.id) AS course_count
           FROM gr_subjects s WHERE s.academic_year_id = ? ORDER BY s.grade_level, s.subject_type, s.sort_order, s.code`
      ).bind(year.id).all();
      return json({ year, subjects: results, learning_areas: LEARNING_AREAS });
    }
    if (method === "POST" && idPart === "template") {
      const b = await readJson(request);
      const year = await resolveYear(env, b.year);
      const grades = (Array.isArray(b.grades) ? b.grades : PRIMARY_GRADES).filter((g) => PRIMARY_GRADES.includes(g));
      const settings = await getSettings(env, year.id);
      const stmts = [];
      for (const g of grades) {
        const digit = g.slice(-1);
        BASIC_TEMPLATE.forEach((t, i) => {
          stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO gr_subjects (academic_year_id, grade_level, code, name, learning_area, subject_type, hours_per_year, collect_ratio, sort_order)
            VALUES (?,?,?,?,?, 'basic', ?, ?, ?)`).bind(year.id, g, `${t.p}1${digit}${t.n}`, t.name, LEARNING_AREAS[t.area],
            Number(digit) <= 3 ? t.lower : t.upper, settings.collect_ratio, (i + 1) * 10));
        });
      }
      await batchAll(env, stmts);
      await audit(env, user, "subjects.template", { year: year.id, grades });
      return json({ ok: true, created_for: grades });
    }
    if (method === "POST" && !idPart) {
      const b = await readJson(request);
      const year = await resolveYear(env, b.year);
      const s = cleanSubject(b, await getSettings(env, year.id));
      try {
        const r = await env.DB.prepare(`INSERT INTO gr_subjects (academic_year_id, grade_level, code, name, learning_area, subject_type, hours_per_year, collect_ratio, sort_order)
          VALUES (?,?,?,?,?,?,?,?,?)`).bind(year.id, s.grade, s.code, s.name, s.area, s.type, s.hours, s.ratio, s.sort).run();
        await audit(env, user, "subject.create", { id: r.meta.last_row_id, ...s });
        return json({ ok: true, id: r.meta.last_row_id });
      } catch (e) {
        if (String(e.message).includes("UNIQUE")) fail(409, `มีรหัสวิชา ${s.code} ของ ${s.grade} อยู่แล้ว`);
        throw e;
      }
    }
    if (idPart && method === "PUT") {
      const id = intParam(idPart);
      const existing = await env.DB.prepare("SELECT * FROM gr_subjects WHERE id = ?").bind(id).first();
      if (!existing) fail(404, "ไม่พบรายวิชา");
      const s = cleanSubject(await readJson(request), await getSettings(env, existing.academic_year_id));
      if (s.grade !== existing.grade_level) {
        const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_courses WHERE subject_id = ?").bind(id).first();
        if (used.n > 0) fail(409, "เปลี่ยนระดับชั้นไม่ได้ เพราะสร้างรายวิชาของห้องเรียนแล้ว");
      }
      try {
        await env.DB.prepare(`UPDATE gr_subjects SET grade_level=?, code=?, name=?, learning_area=?, subject_type=?, hours_per_year=?, collect_ratio=?, sort_order=? WHERE id=?`)
          .bind(s.grade, s.code, s.name, s.area, s.type, s.hours, s.ratio, s.sort, id).run();
      } catch (e) {
        if (String(e.message).includes("UNIQUE")) fail(409, `มีรหัสวิชา ${s.code} ของ ${s.grade} อยู่แล้ว`);
        throw e;
      }
      await audit(env, user, "subject.update", { id, before: existing, after: s });
      return json({ ok: true });
    }
    if (idPart && method === "DELETE") {
      const id = intParam(idPart);
      const used = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM gr_scores sc JOIN gr_items i ON i.id = sc.item_id JOIN gr_courses c ON c.id = i.course_id
          WHERE c.subject_id = ? AND sc.score IS NOT NULL`
      ).bind(id).first();
      if (used.n > 0) fail(409, `ลบไม่ได้ — มีคะแนนที่ครูกรอกแล้ว ${used.n} ช่อง`);
      const res = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_results r JOIN gr_courses c ON c.id = r.course_id WHERE c.subject_id = ?").bind(id).first();
      if (res.n > 0) fail(409, `ลบไม่ได้ — มีข้อมูลเวลาเรียน/ผลพิเศษของนักเรียนแล้ว ${res.n} คน`);
      const subject = await env.DB.prepare("SELECT * FROM gr_subjects WHERE id = ?").bind(id).first();
      if (!subject) fail(404, "ไม่พบรายวิชา");
      // ลบลูกก่อนเพื่อไม่พึ่งการตั้งค่า foreign key
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gr_scores WHERE item_id IN (SELECT i.id FROM gr_items i JOIN gr_courses c ON c.id = i.course_id WHERE c.subject_id = ?)").bind(id),
        env.DB.prepare("DELETE FROM gr_items WHERE course_id IN (SELECT id FROM gr_courses WHERE subject_id = ?)").bind(id),
        env.DB.prepare("DELETE FROM gr_results WHERE course_id IN (SELECT id FROM gr_courses WHERE subject_id = ?)").bind(id),
        env.DB.prepare("DELETE FROM gr_course_teachers WHERE course_id IN (SELECT id FROM gr_courses WHERE subject_id = ?)").bind(id),
        env.DB.prepare("DELETE FROM gr_courses WHERE subject_id = ?").bind(id),
        env.DB.prepare("DELETE FROM gr_subjects WHERE id = ?").bind(id),
      ]);
      await audit(env, user, "subject.delete", subject);
      return json({ ok: true });
    }
  }

  // ---------- รายวิชาของแต่ละห้อง (courses) ----------
  if (section === "courses") {
    if (method === "POST" && idPart === "generate") {
      const b = await readJson(request);
      const year = await resolveYear(env, b.year);
      const rooms = (await listRooms(env, year.id)).filter((r) => isPrimaryGrade(r.grade_level));
      const { results: subjects } = await env.DB.prepare("SELECT id, grade_level FROM gr_subjects WHERE academic_year_id = ?").bind(year.id).all();
      const stmts = [];
      for (const s of subjects) for (const r of rooms) if (r.grade_level === s.grade_level) {
        stmts.push(env.DB.prepare("INSERT OR IGNORE INTO gr_courses (subject_id, classroom) VALUES (?, ?)").bind(s.id, r.classroom));
      }
      const before = await countCourses(env, year.id);
      await batchAll(env, stmts);
      const after = await countCourses(env, year.id);
      await audit(env, user, "courses.generate", { year: year.id, created: after - before });
      return json({ ok: true, created: after - before, total: after });
    }
    if (method === "GET" && !idPart) {
      const year = await resolveYear(env, url.searchParams.get("year"));
      return json({ year, courses: await courseOverview(env, year.id) });
    }
    if (method === "POST" && idPart === "assign-room") {
      // มอบหมายครูคนเดียวให้สอนหลายวิชาของห้องเดียว (ครูประจำชั้นที่สอนเกือบทุกวิชา)
      const b = await readJson(request);
      const teacher = intParam(b.user_id, "ครู");
      const courseIds = (Array.isArray(b.course_ids) ? b.course_ids : []).map((v) => intParam(v));
      if (!courseIds.length) fail(400, "กรุณาเลือกรายวิชา");
      await assertTeacher(env, teacher);
      await batchAll(env, courseIds.map((cid) => env.DB.prepare("INSERT OR IGNORE INTO gr_course_teachers (course_id, user_id) SELECT id, ? FROM gr_courses WHERE id = ?").bind(teacher, cid)));
      await audit(env, user, "courses.assign", { teacher, courseIds });
      return json({ ok: true });
    }
    if (idPart && action === "teachers" && method === "PUT") {
      const id = intParam(idPart);
      const b = await readJson(request);
      const ids = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map((v) => intParam(v, "ครู")))];
      if (ids.length > 6) fail(400, "กำหนดครูผู้สอนได้ไม่เกิน 6 คนต่อรายวิชา");
      for (const t of ids) await assertTeacher(env, t);
      const exists = await env.DB.prepare("SELECT id FROM gr_courses WHERE id = ?").bind(id).first();
      if (!exists) fail(404, "ไม่พบรายวิชา");
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gr_course_teachers WHERE course_id = ?").bind(id),
        ...ids.map((t) => env.DB.prepare("INSERT INTO gr_course_teachers (course_id, user_id) VALUES (?, ?)").bind(id, t)),
      ]);
      await audit(env, user, "course.teachers", { id, ids });
      return json({ ok: true });
    }
    if (idPart && action === "lock" && method === "POST") {
      const id = intParam(idPart);
      const b = await readJson(request);
      const r = b.locked
        ? await env.DB.prepare("UPDATE gr_courses SET locked = 1, submitted_at = COALESCE(submitted_at, datetime('now')), submitted_by = COALESCE(submitted_by, ?) WHERE id = ?").bind(user.id, id).run()
        : await env.DB.prepare("UPDATE gr_courses SET locked = 0, submitted_at = NULL, submitted_by = NULL WHERE id = ?").bind(id).run();
      if (!r.meta?.changes) fail(404, "ไม่พบรายวิชา");
      await audit(env, user, b.locked ? "course.lock" : "course.unlock", { id });
      return json({ ok: true });
    }
    if (idPart && method === "DELETE") {
      const id = intParam(idPart);
      const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores sc JOIN gr_items i ON i.id = sc.item_id WHERE i.course_id = ? AND sc.score IS NOT NULL").bind(id).first();
      if (used.n > 0) fail(409, `ลบไม่ได้ — มีคะแนนแล้ว ${used.n} ช่อง`);
      const res = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_results WHERE course_id = ?").bind(id).first();
      if (res.n > 0) fail(409, `ลบไม่ได้ — มีข้อมูลเวลาเรียน/ผลพิเศษของนักเรียนแล้ว ${res.n} คน`);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gr_scores WHERE item_id IN (SELECT id FROM gr_items WHERE course_id = ?)").bind(id),
        env.DB.prepare("DELETE FROM gr_items WHERE course_id = ?").bind(id),
        env.DB.prepare("DELETE FROM gr_results WHERE course_id = ?").bind(id),
        env.DB.prepare("DELETE FROM gr_course_teachers WHERE course_id = ?").bind(id),
        env.DB.prepare("DELETE FROM gr_courses WHERE id = ?").bind(id),
      ]);
      await audit(env, user, "course.delete", { id });
      return json({ ok: true });
    }
  }

  // ---------- ครูประจำชั้น ----------
  if (section === "homerooms") {
    if (method === "GET") {
      const year = await resolveYear(env, url.searchParams.get("year"));
      const rooms = (await listRooms(env, year.id)).filter((r) => isPrimaryGrade(r.grade_level));
      const { results } = await env.DB.prepare(
        `SELECT h.grade_level, h.classroom, u.id, u.full_name FROM gr_homerooms h JOIN users u ON u.id = h.user_id WHERE h.academic_year_id = ?`
      ).bind(year.id).all();
      for (const r of rooms) r.teachers = results.filter((h) => h.grade_level === r.grade_level && h.classroom === r.classroom).map((h) => ({ id: h.id, full_name: h.full_name }));
      return json({ year, rooms });
    }
    if (method === "PUT") {
      const b = await readJson(request);
      const year = await resolveYear(env, b.year);
      const grade = text(b.grade_level, 10), room = text(b.classroom, 10);
      if (!PRIMARY_GRADES.includes(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
      const ids = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map((v) => intParam(v, "ครู")))];
      if (ids.length > 4) fail(400, "ครูประจำชั้นได้ไม่เกิน 4 คนต่อห้อง");
      for (const t of ids) await assertTeacher(env, t);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gr_homerooms WHERE academic_year_id = ? AND grade_level = ? AND classroom = ?").bind(year.id, grade, room),
        ...ids.map((t) => env.DB.prepare("INSERT INTO gr_homerooms (academic_year_id, grade_level, classroom, user_id) VALUES (?,?,?,?)").bind(year.id, grade, room, t)),
      ]);
      await audit(env, user, "homeroom.set", { year: year.id, grade, room, ids });
      return json({ ok: true });
    }
    if (method === "POST" && idPart === "import") {
      // ดึงครูประจำชั้นจากหน้า "วิเคราะห์ผู้เรียน" ของระบบบริหารโรงเรียน (learner_class_assignments)
      const b = await readJson(request);
      const year = await resolveYear(env, b.year);
      const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO gr_homerooms (academic_year_id, grade_level, classroom, user_id)
         SELECT DISTINCT t.academic_year_id, a.grade_level, a.classroom, a.teacher_user_id
           FROM learner_class_assignments a JOIN academic_terms t ON t.id = a.academic_term_id
           JOIN users u ON u.id = a.teacher_user_id AND u.status = 'active'
          WHERE t.academic_year_id = ? AND a.grade_level LIKE 'ป.%'`
      ).bind(year.id).run().catch(() => ({ meta: { changes: 0 } }));
      await audit(env, user, "homeroom.import", { year: year.id, added: r.meta?.changes ?? 0 });
      return json({ ok: true, added: r.meta?.changes ?? 0 });
    }
  }

  // ---------- คลังตัวชี้วัด ----------
  if (section === "indicator-bank") {
    if (method === "POST" && idPart === "import") {
      const b = await readJson(request);
      const rows = Array.isArray(b.rows) ? b.rows.slice(0, 3000) : [];
      const clean = [];
      for (const [i, r] of rows.entries()) {
        const grade = text(r.grade_level, 10), area = text(r.learning_area, 80), title = text(r.title, 500), code = text(r.code, 60);
        if (!PRIMARY_GRADES.includes(grade)) fail(400, `แถว ${i + 1}: ระดับชั้น "${grade}" ไม่ถูกต้อง`);
        if (!LEARNING_AREAS.includes(area)) fail(400, `แถว ${i + 1}: กลุ่มสาระ "${area}" ไม่ตรงกับรายชื่อในระบบ`);
        if (!title) fail(400, `แถว ${i + 1}: ไม่มีข้อความตัวชี้วัด`);
        clean.push([area, grade, code, title]);
      }
      const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_indicator_bank").first();
      await batchAll(env, clean.map((c) => env.DB.prepare("INSERT OR IGNORE INTO gr_indicator_bank (learning_area, grade_level, code, title, created_by) VALUES (?,?,?,?,?)").bind(...c, user.id)));
      const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_indicator_bank").first();
      await audit(env, user, "bank.import", { rows: clean.length, added: after.n - before.n });
      return json({ ok: true, added: after.n - before.n, skipped: clean.length - (after.n - before.n) });
    }
    if (method === "DELETE" && idPart) {
      await env.DB.prepare("DELETE FROM gr_indicator_bank WHERE id = ?").bind(intParam(idPart)).run();
      return json({ ok: true });
    }
  }

  if (section === "audit" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT a.id, a.action, a.detail, a.created_at, u.full_name FROM gr_audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200"
    ).all();
    return json({ entries: results });
  }

  fail(404, "ไม่พบเส้นทาง API");
}

async function countCourses(env, yearId) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_courses c JOIN gr_subjects s ON s.id = c.subject_id WHERE s.academic_year_id = ?").bind(yearId).first();
  return r.n;
}

async function assertTeacher(env, id) {
  const t = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL AND role IS NOT NULL").bind(id).first();
  if (!t) fail(400, "ผู้ใช้ที่เลือกไม่ใช่บัญชีครูที่ใช้งานอยู่");
}

// ภาพรวมรายวิชาทุกห้อง + ความคืบหน้าการกรอก (ใช้หน้า admin)
export async function courseOverview(env, yearId, { teacherId = null } = {}) {
  const teacherFilter = teacherId ? " AND c.id IN (SELECT course_id FROM gr_course_teachers WHERE user_id = ?)" : "";
  const { results: courses } = await env.DB.prepare(
    `SELECT c.id, c.classroom, c.locked, c.submitted_at, s.id AS subject_id, s.grade_level, s.code, s.name, s.learning_area,
            s.subject_type, s.hours_per_year, s.sort_order,
            (SELECT COUNT(*) FROM gr_items i WHERE i.course_id = c.id) AS item_count,
            (SELECT COUNT(*) FROM gr_scores sc JOIN gr_items i ON i.id = sc.item_id WHERE i.course_id = c.id AND sc.score IS NOT NULL) AS filled
       FROM gr_courses c JOIN gr_subjects s ON s.id = c.subject_id
      WHERE s.academic_year_id = ?${teacherFilter}`
  ).bind(...(teacherId ? [yearId, teacherId] : [yearId])).all();
  const { results: teachers } = await env.DB.prepare(
    `SELECT ct.course_id, u.id, u.full_name FROM gr_course_teachers ct JOIN users u ON u.id = ct.user_id
       JOIN gr_courses c ON c.id = ct.course_id JOIN gr_subjects s ON s.id = c.subject_id WHERE s.academic_year_id = ?`
  ).bind(yearId).all();
  const rooms = await listRooms(env, yearId);
  const size = Object.fromEntries(rooms.map((r) => [`${r.grade_level}|${r.classroom}`, r.students]));
  for (const c of courses) {
    c.teachers = teachers.filter((t) => t.course_id === c.id).map((t) => ({ id: t.id, full_name: t.full_name }));
    c.students = size[`${c.grade_level}|${c.classroom}`] || 0;
    const expected = c.item_count * c.students;
    c.progress = expected ? Math.min(100, Math.round((c.filled / expected) * 100)) : 0;
  }
  return courses.sort((a, b) => compareRoom(a, b) || (a.subject_type === "additional") - (b.subject_type === "additional") || a.sort_order - b.sort_order || a.code.localeCompare(b.code));
}
