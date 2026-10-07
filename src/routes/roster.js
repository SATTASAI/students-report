// รายชื่อนักเรียน (ฝ่ายวัดผล/ผู้ดูแลระบบ): แก้คำนำหน้า ชื่อ สกุล เพศ ห้อง และกำหนดเลขที่เอง
// เขียนลงตารางทะเบียนเดียวกับระบบบริหารโรงเรียน (students / student_details / student_enrollments) จึงตรงกันทั้งสองระบบ
import { json, readJson, fail, requireImporter, intParam, text, audit } from "../lib/http.js";
import { resolveYear, roomRoster, listRooms, studentName, isSchoolGrade, LEFT_STATUSES } from "../lib/data.js";
import { rosterTerm, enrollStatements, latestInYear } from "./moves.js";

const PREFIXES = ["เด็กชาย", "เด็กหญิง", "นาย", "นางสาว", "ด.ช.", "ด.ญ."];

export async function handleRoster(request, env, user, parts, method, url) {
  requireImporter(user);
  const year = await resolveYear(env, url.searchParams.get("year"));

  if (!parts[2] && method === "GET") {
    const rooms = (await listRooms(env, year.id)).filter((r) => isSchoolGrade(r.grade_level)).map((r) => ({ grade_level: r.grade_level, classroom: r.classroom, students: r.students }));
    const grade = text(url.searchParams.get("grade"), 10), room = text(url.searchParams.get("room"), 10);
    if (!grade) return json({ year, rooms });
    if (!isSchoolGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
    const roster = await roomRoster(env, year.id, grade, room);
    return json({ year, rooms, grade, room, prefixes: PREFIXES, students: roster.map((s) => ({
      id: s.id, number: s.number, manual_number: s.manual_number || null, student_code: s.student_code, name: studentName(s),
      name_prefix: s.name_prefix || "", first_name: s.first_name || "", last_name: s.last_name || "", gender: s.gender || "",
      transfer_in_term: s.transfer_in_term || null,
    })) });
  }

  if (parts[2] && method === "PUT") {
    const sid = intParam(parts[2], "นักเรียน");
    const b = await readJson(request);
    const cur = await latestInYear(env, year.id, sid);
    if (!cur || LEFT_STATUSES.includes(cur.status)) fail(404, "ไม่พบนักเรียนที่กำลังเรียนในปีการศึกษานี้");
    const st = await env.DB.prepare("SELECT id, name_prefix, first_name, last_name FROM students WHERE id = ?").bind(sid).first();
    const prefix = "name_prefix" in b ? text(b.name_prefix, 30) : st.name_prefix || "";
    const first = "first_name" in b ? text(b.first_name, 80) : st.first_name || "";
    const last = "last_name" in b ? text(b.last_name, 80) : st.last_name || "";
    if (!first || !last) fail(400, "กรอกชื่อและนามสกุล");
    const stmts = [env.DB.prepare("UPDATE students SET name_prefix = ?, first_name = ?, last_name = ?, full_name = ? WHERE id = ?")
      .bind(prefix || null, first, last, `${prefix}${first} ${last}`, sid)];
    if ("gender" in b) {
      const g = b.gender === "ช" || b.gender === "ญ" ? b.gender : null;
      stmts.push(env.DB.prepare(`INSERT INTO student_details (student_id, gender) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET gender = excluded.gender`).bind(sid, g));
    }
    let grade = cur.grade_level, room = cur.classroom;
    if ("grade_level" in b || "classroom" in b) {
      grade = text(b.grade_level ?? grade, 10); room = text(b.classroom ?? room, 10);
      if (!isSchoolGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
      const exists = (await listRooms(env, year.id)).some((r) => r.grade_level === grade && r.classroom === room);
      if (!exists) fail(400, `ไม่พบห้อง ${grade}/${room} ในปีการศึกษานี้`);
    }
    const moved = grade !== cur.grade_level || room !== cur.classroom;
    if (moved) {
      const term = await rosterTerm(env, year.id);
      stmts.push(...enrollStatements(env, year.id, term, sid, grade, room, cur.status));
      stmts.push(env.DB.prepare("DELETE FROM gr_roster_numbers WHERE academic_year_id = ? AND student_id = ?").bind(year.id, sid));
    } else if ("number" in b) {
      if (b.number === "" || b.number == null) stmts.push(env.DB.prepare("DELETE FROM gr_roster_numbers WHERE academic_year_id = ? AND student_id = ?").bind(year.id, sid));
      else {
        const n = Number(b.number);
        if (!Number.isInteger(n) || n < 1 || n > 99) fail(400, "เลขที่ต้องเป็นจำนวนเต็ม 1–99");
        const roster = await roomRoster(env, year.id, grade, room);
        const dup = roster.find((s) => s.id !== sid && s.manual_number === n);
        if (dup) fail(409, `เลขที่ ${n} กำหนดให้ ${studentName(dup)} แล้ว`);
        stmts.push(env.DB.prepare(`INSERT INTO gr_roster_numbers (academic_year_id, student_id, number, updated_by) VALUES (?,?,?,?)
          ON CONFLICT(academic_year_id, student_id) DO UPDATE SET number = excluded.number, updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(year.id, sid, n, user.id));
      }
    }
    await env.DB.batch(stmts);
    await audit(env, user, "roster.update", { student_id: sid, fields: Object.keys(b), moved: moved ? `${grade}/${room}` : null });
    return json({ ok: true, moved });
  }
  fail(404, "ไม่พบ API");
}
