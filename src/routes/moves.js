// นักเรียนย้ายเข้า / ย้ายออก / ออกกลางคัน (เฉพาะผู้ดูแลระบบและทีมวัดผล)
// หลักการ: ไม่ลบนักเรียนออกจากฐานข้อมูลเด็ดขาด (soft delete) — เปลี่ยนสถานะเป็น transferred / withdrawn
// รายชื่อทุกหน้าจะไม่แสดงคนที่ออกแล้ว แต่ข้อมูลประวัติ คะแนน และเลขประจำตัวยังอยู่ครบ
// ถ้ากลับมาเรียนอีก (ปีไหนก็ได้) ใช้ "รับกลับเข้าเรียน" กับระเบียนเดิม → ได้เลขประจำตัวเดิม ไม่ต้องกรอกซ้ำ
//
// การเขียนลงตารางของระบบทะเบียน (students / student_enrollments):
// - แก้เฉพาะแถวของภาคเรียนที่มีรายชื่อแล้ว (ภาคล่าสุดของปีที่มีข้อมูล) ไม่สร้างภาคใหม่เอง
//   เพราะระบบทะเบียนจะยกรายชื่อขึ้นภาคใหม่ก็ต่อเมื่อภาคนั้นยังว่างอยู่
// - อัปเดต students.status/grade_level/classroom ให้ตรงกัน (ระบบทะเบียนมี trigger ซิงก์ภาคที่เปิดใช้อยู่ให้เอง)
import { json, readJson, fail, requireImporter, intParam, text, audit } from "../lib/http.js";
import { resolveYear, listRooms, studentName, isSchoolGrade, getSettings, LEFT_STATUSES } from "../lib/data.js";

const OUT_REASONS = { transfer: "transferred", dropout: "withdrawn" };
export const MOVE_LABEL = { new: "ย้ายเข้า (นักเรียนใหม่)", return: "รับกลับเข้าเรียน", transfer: "ย้ายออก", dropout: "ออกกลางคัน / ติดตามไม่ได้" };

const maskId = (v) => { const s = String(v || "").replace(/\D/g, ""); return s.length === 13 ? `${s[0]}-xxxx-xxxxx-${s.slice(10, 12)}-${s[12]}` : (s ? "xxxx" + s.slice(-3) : ""); };
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null);

export async function rosterTerm(env, yearId) {
  // ภาคล่าสุดของปีที่มีรายชื่อนักเรียนแล้ว (ใช้เป็นภาคที่แก้สถานะ)
  return env.DB.prepare(
    `SELECT t.id, t.term_number FROM academic_terms t
      WHERE t.academic_year_id = ? AND EXISTS (SELECT 1 FROM student_enrollments e WHERE e.academic_term_id = t.id)
      ORDER BY t.term_number DESC LIMIT 1`
  ).bind(yearId).first();
}

export async function latestInYear(env, yearId, studentId) {
  return env.DB.prepare(
    `SELECT se.grade_level, se.classroom, se.status, se.academic_term_id, t.term_number FROM student_enrollments se
       JOIN academic_terms t ON t.id = se.academic_term_id
      WHERE se.student_id = ? AND t.academic_year_id = ? ORDER BY t.term_number DESC, se.id DESC LIMIT 1`
  ).bind(studentId, yearId).first();
}

// ตั้งสถานะ/ห้องของนักเรียนในภาคที่มีรายชื่อ (upsert) + ระเบียนหลัก
export function enrollStatements(env, yearId, term, studentId, grade, room, status) {
  return [
    env.DB.prepare(
      `INSERT INTO student_enrollments (student_id, academic_year_id, academic_term_id, grade_level, classroom, status)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(student_id, academic_term_id) DO UPDATE SET grade_level = excluded.grade_level, classroom = excluded.classroom,
         status = excluded.status, updated_at = datetime('now')`
    ).bind(studentId, yearId, term.id, grade, room, status),
    env.DB.prepare("UPDATE students SET grade_level = ?, classroom = ?, status = ? WHERE id = ?").bind(grade, room, status, studentId),
  ];
}

export async function handleMoves(request, env, user, parts, method, url) {
  requireImporter(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  const sub = parts[2];

  if (!sub && method === "GET") {
    const q = text(url.searchParams.get("q"), 60);
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
      const digits = q.replace(/\D/g, "");
      const { results } = await env.DB.prepare(
        `SELECT s.id, s.student_code, s.national_id, s.name_prefix, s.first_name, s.last_name, s.full_name, s.birth_date, s.status
           FROM students s
          WHERE s.student_code = ? OR (? <> '' AND s.national_id = ?) OR s.full_name LIKE ? ESCAPE '\\'
             OR (COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) LIKE ? ESCAPE '\\'
          ORDER BY s.student_code LIMIT 20`
      ).bind(q, digits.length === 13 ? digits : "", digits, like, like).all();
      const out = [];
      for (const s of results) {
        const cur = await latestInYear(env, year.id, s.id);
        const last = cur || await env.DB.prepare(
          `SELECT se.grade_level, se.classroom, se.status, y.year_be FROM student_enrollments se
             JOIN academic_years y ON y.id = se.academic_year_id JOIN academic_terms t ON t.id = se.academic_term_id
            WHERE se.student_id = ? ORDER BY y.year_be DESC, t.term_number DESC LIMIT 1`
        ).bind(s.id).first();
        out.push({
          id: s.id, student_code: s.student_code, national_id: maskId(s.national_id), name: studentName(s), birth_date: s.birth_date,
          in_year: !!cur, enrolled: cur ? !LEFT_STATUSES.includes(cur.status) : false,
          status: cur?.status || last?.status || s.status, grade_level: last?.grade_level || null, classroom: last?.classroom || null, last_year_be: last?.year_be || null,
        });
      }
      return json({ results: out });
    }
    const [term, rooms, settings, list, maxCode] = await Promise.all([
      rosterTerm(env, year.id),
      listRooms(env, year.id),
      getSettings(env, year.id),
      env.DB.prepare(
        `SELECT m.*, s.student_code, s.name_prefix, s.first_name, s.last_name, s.full_name, u.full_name AS by_name
           FROM gr_transfers m JOIN students s ON s.id = m.student_id LEFT JOIN users u ON u.id = m.created_by
          WHERE m.academic_year_id = ? ORDER BY m.id DESC`
      ).bind(year.id).all().then((r) => r.results),
      env.DB.prepare("SELECT MAX(CAST(student_code AS INTEGER)) AS n FROM students WHERE student_code GLOB '[0-9]*'").first(),
    ]);
    return json({
      year, term_number: term?.term_number || 1,
      rooms: rooms.filter((r) => isSchoolGrade(r.grade_level)).map((r) => ({ grade_level: r.grade_level, classroom: r.classroom })),
      pilot_rooms: settings.pilot_rooms,
      next_code: maxCode?.n ? String(maxCode.n + 1) : "",
      moves: list.map((m) => ({
        id: m.id, student_id: m.student_id, student_code: m.student_code, name: studentName(m), direction: m.direction, reason: m.reason,
        label: MOVE_LABEL[m.reason], term_number: m.term_number, move_date: m.move_date, school: m.school, note: m.note,
        grade_level: m.grade_level, classroom: m.classroom, by_name: m.by_name, created_at: m.created_at, undone_at: m.undone_at,
      })),
    });
  }

  const term = await rosterTerm(env, year.id);
  if (!term) fail(409, "ปีการศึกษานี้ยังไม่มีรายชื่อนักเรียนในระบบทะเบียน");

  // ---------- ย้ายออก / ออกกลางคัน ----------
  if (sub === "out" && method === "POST") {
    const b = await readJson(request);
    const sid = intParam(b.student_id, "นักเรียน");
    const status = OUT_REASONS[b.reason];
    if (!status) fail(400, "เลือกเหตุผล: ย้ายออก หรือ ออกกลางคัน");
    const termNo = Number(b.term_number) || term.term_number;
    if (![1, 2].includes(termNo)) fail(400, "ภาคเรียนไม่ถูกต้อง");
    const cur = await latestInYear(env, year.id, sid);
    if (!cur || LEFT_STATUSES.includes(cur.status)) fail(409, "นักเรียนคนนี้ไม่ได้เรียนอยู่ในปีการศึกษานี้");
    await env.DB.batch([
      ...enrollStatements(env, year.id, term, sid, cur.grade_level, cur.classroom, status),
      env.DB.prepare(`INSERT INTO gr_transfers (academic_year_id, student_id, direction, reason, term_number, move_date, school, note, grade_level, classroom, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(year.id, sid, "out", b.reason, termNo, dateOrNull(b.move_date), text(b.school, 200) || null, text(b.note, 300) || null, cur.grade_level, cur.classroom, user.id),
    ]);
    await audit(env, user, "student.out", { student_id: sid, reason: b.reason });
    return json({ ok: true });
  }

  // ---------- ย้ายเข้า (นักเรียนใหม่) / รับกลับเข้าเรียน (ระเบียนเดิม เลขประจำตัวเดิม) ----------
  if (sub === "in" && method === "POST") {
    const b = await readJson(request);
    const grade = text(b.grade_level, 10), room = text(b.classroom, 10);
    if (!isSchoolGrade(grade) || !room) fail(400, "เลือกห้องเรียนที่จะเข้าเรียน");
    const termNo = Number(b.term_number) || term.term_number;
    if (![1, 2].includes(termNo)) fail(400, "ภาคเรียนไม่ถูกต้อง");
    let sid, reason;
    if (b.student_id) {
      sid = intParam(b.student_id, "นักเรียน");
      const s = await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(sid).first();
      if (!s) fail(404, "ไม่พบนักเรียน");
      const cur = await latestInYear(env, year.id, sid);
      if (cur && !LEFT_STATUSES.includes(cur.status)) fail(409, `นักเรียนคนนี้เรียนอยู่แล้วที่ ${cur.grade_level}/${cur.classroom}`);
      reason = "return";
    } else {
      const n = b.student || {};
      const code = text(n.student_code, 20), first = text(n.first_name, 80), last = text(n.last_name, 80), prefix = text(n.name_prefix, 30);
      const nid = String(n.national_id || "").replace(/\D/g, "");
      if (!code) fail(400, "กรอกเลขประจำตัวนักเรียน");
      if (!first || !last) fail(400, "กรอกชื่อและนามสกุล");
      if (nid && nid.length !== 13) fail(400, "เลขประจำตัวประชาชนต้องมี 13 หลัก");
      const dupCode = await env.DB.prepare("SELECT student_code FROM students WHERE student_code = ?").bind(code).first();
      if (dupCode) fail(409, `เลขประจำตัว ${code} มีในระบบแล้ว — ถ้าเป็นนักเรียนเก่าที่กลับมา ให้ค้นหาแล้วกด "รับกลับเข้าเรียน"`);
      if (nid) {
        const dupNid = await env.DB.prepare("SELECT student_code FROM students WHERE national_id = ?").bind(nid).first();
        if (dupNid) fail(409, `เลขประจำตัวประชาชนนี้เป็นของนักเรียนเดิม (เลขประจำตัว ${dupNid.student_code}) — ให้ใช้ "รับกลับเข้าเรียน" เพื่อใช้เลขประจำตัวเดิม`);
      }
      const r = await env.DB.prepare(
        `INSERT INTO students (student_code, full_name, national_id, name_prefix, first_name, last_name, birth_date, grade_level, classroom, status)
         VALUES (?,?,?,?,?,?,?,?,?,'enrolled')`
      ).bind(code, `${prefix}${first} ${last}`, nid || null, prefix || null, first, last, dateOrNull(n.birth_date), grade, room).run();
      sid = r.meta.last_row_id;
      const gender = n.gender === "ช" || n.gender === "ญ" ? n.gender : (/ชาย/.test(prefix) ? "ช" : /หญิง/.test(prefix) ? "ญ" : null);
      if (gender) await env.DB.prepare(`INSERT INTO student_details (student_id, gender) VALUES (?, ?)
        ON CONFLICT(student_id) DO UPDATE SET gender = excluded.gender`).bind(sid, gender).run().catch(() => null);
      reason = "new";
    }
    await env.DB.batch([
      ...enrollStatements(env, year.id, term, sid, grade, room, "enrolled"),
      env.DB.prepare(`INSERT INTO gr_transfers (academic_year_id, student_id, direction, reason, term_number, move_date, school, note, grade_level, classroom, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(year.id, sid, "in", reason, termNo, dateOrNull(b.move_date), text(b.school, 200) || null, text(b.note, 300) || null, grade, room, user.id),
    ]);
    await audit(env, user, "student.in", { student_id: sid, reason, room: `${grade}/${room}` });
    return json({ ok: true, student_id: sid, reason });
  }

  // ---------- ยกเลิกรายการย้ายออก (บันทึกผิดคน) ----------
  if (sub && parts[3] === "undo" && method === "POST") {
    const id = intParam(sub);
    const m = await env.DB.prepare("SELECT * FROM gr_transfers WHERE id = ? AND academic_year_id = ?").bind(id, year.id).first();
    if (!m) fail(404, "ไม่พบรายการ");
    if (m.undone_at) fail(409, "ยกเลิกรายการนี้ไปแล้ว");
    if (m.direction !== "out") fail(400, "ยกเลิกได้เฉพาะรายการย้ายออก/ออกกลางคัน — ถ้ารับเข้าผิดห้อง ให้รับเข้าใหม่ด้วยห้องที่ถูกต้อง หรือบันทึกย้ายออก");
    const cur = await latestInYear(env, year.id, m.student_id);
    if (cur && !LEFT_STATUSES.includes(cur.status)) fail(409, "นักเรียนคนนี้กลับเข้าเรียนแล้ว");
    await env.DB.batch([
      ...enrollStatements(env, year.id, term, m.student_id, m.grade_level, m.classroom, "enrolled"),
      env.DB.prepare("UPDATE gr_transfers SET undone_at = datetime('now'), undone_by = ? WHERE id = ?").bind(user.id, id),
    ]);
    await audit(env, user, "student.out.undo", { student_id: m.student_id });
    return json({ ok: true });
  }

  fail(404, "ไม่พบ API");
}
