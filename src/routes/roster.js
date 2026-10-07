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
      national_id: s.national_id || "", birth_date: s.birth_date || "",
      transfer_in_term: s.transfer_in_term || null,
    })) });
  }

  if (parts[2] && method === "PUT") {
    const sid = intParam(parts[2], "นักเรียน");
    const b = await readJson(request);
    const cur = await latestInYear(env, year.id, sid);
    if (!cur || LEFT_STATUSES.includes(cur.status)) fail(404, "ไม่พบนักเรียนที่กำลังเรียนในปีการศึกษานี้");
    const st = await env.DB.prepare("SELECT id, name_prefix, first_name, last_name, national_id, birth_date FROM students WHERE id = ?").bind(sid).first();
    const prefix = "name_prefix" in b ? text(b.name_prefix, 30) : st.name_prefix || "";
    const first = "first_name" in b ? text(b.first_name, 80) : st.first_name || "";
    const last = "last_name" in b ? text(b.last_name, 80) : st.last_name || "";
    if (!first || !last) fail(400, "กรอกชื่อและนามสกุล");
    const stmts = [env.DB.prepare("UPDATE students SET name_prefix = ?, first_name = ?, last_name = ?, full_name = ? WHERE id = ?")
      .bind(prefix || null, first, last, `${prefix}${first} ${last}`, sid)];
    // เลขประจำตัวประชาชน / วันเกิด (ระบบทะเบียนแก้ไม่ได้แล้ว — แก้ที่นี่ที่เดียว)
    if ("national_id" in b) {
      const nid = String(b.national_id || "").replace(/\D/g, "");
      if (nid && nid.length !== 13) fail(400, "เลขประจำตัวประชาชนต้องมี 13 หลัก");
      if (nid) {
        const dup = await env.DB.prepare("SELECT student_code, full_name FROM students WHERE national_id = ? AND id <> ?").bind(nid, sid).first();
        if (dup) fail(409, `เลขประจำตัวประชาชนนี้เป็นของ ${dup.full_name} (เลขประจำตัว ${dup.student_code})`);
      }
      stmts.push(env.DB.prepare("UPDATE students SET national_id = ? WHERE id = ?").bind(nid || null, sid));
    }
    if ("birth_date" in b) {
      const bd = String(b.birth_date || "");
      if (bd && (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || Number.isNaN(Date.parse(bd)))) fail(400, "วันเกิดไม่ถูกต้อง");
      stmts.push(env.DB.prepare("UPDATE students SET birth_date = ? WHERE id = ?").bind(bd || null, sid));
    }
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
  // ---------- นำเข้ารายชื่อนักเรียนจาก Excel (ระบบทะเบียนนำเข้าเองไม่ได้แล้ว) ----------
  // แถว: student_code, name_prefix, first_name, last_name, national_id, birth_date, gender, room (เช่น ป.1/2)
  // มีเลขประจำตัวอยู่แล้ว = ปรับข้อมูล (ช่องที่ว่างไม่ลบของเดิม) และย้ายเข้าห้องตามไฟล์ · ใหม่ = เพิ่มนักเรียนและลงทะเบียนในห้อง
  if (parts[2] === "import" && method === "POST") {
    const b = await readJson(request);
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 1500) : [];
    if (!rows.length) fail(400, "ไม่มีข้อมูลให้นำเข้า");
    const rooms = new Set((await listRooms(env, year.id)).filter((r) => isSchoolGrade(r.grade_level)).map((r) => `${r.grade_level}/${r.classroom}`));
    const errors = [], plan = [], seen = new Set(), seenNid = new Map();
    for (const [i, raw] of rows.entries()) {
      const err = (m) => errors.push({ row: i + 1, error: m });
      const code = text(raw.student_code, 20).replace(/\s+/g, "");
      const first = text(raw.first_name, 80), last = text(raw.last_name, 80), prefix = text(raw.name_prefix, 30);
      const nid = String(raw.national_id || "").replace(/\D/g, "");
      const bd = text(raw.birth_date, 10);
      const g = /^(ช|ชาย|m)/i.test(text(raw.gender, 10)) ? "ช" : /^(ญ|หญิง|f)/i.test(text(raw.gender, 10)) ? "ญ" : (/ชาย/.test(prefix) ? "ช" : /หญิง/.test(prefix) ? "ญ" : null);
      const roomKey = text(raw.room, 20).replace(/\s+/g, "");
      if (!code) { err("ไม่มีเลขประจำตัวนักเรียน"); continue; }
      if (seen.has(code)) { err(`เลขประจำตัว ${code} ซ้ำในไฟล์`); continue; }
      seen.add(code);
      if (!first || !last) { err("ต้องมีชื่อและนามสกุล"); continue; }
      if (nid && nid.length !== 13) { err("เลขประจำตัวประชาชนต้องมี 13 หลัก"); continue; }
      if (nid && seenNid.has(nid)) { err(`เลขประจำตัวประชาชนซ้ำกับแถวที่ ${seenNid.get(nid)}`); continue; }
      if (nid) seenNid.set(nid, i + 1);
      if (bd && (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || Number.isNaN(Date.parse(bd)))) { err("วันเกิดต้องเป็นรูปแบบ ปปปป-ดด-วว (ค.ศ.)"); continue; }
      if (roomKey && !rooms.has(roomKey)) { err(`ไม่พบห้อง ${roomKey} ในปีการศึกษานี้`); continue; }
      const existing = await env.DB.prepare("SELECT id, status FROM students WHERE student_code = ?").bind(code).first();
      if (nid) {
        const other = await env.DB.prepare("SELECT student_code FROM students WHERE national_id = ? AND student_code <> ?").bind(nid, code).first();
        if (other) { err(`เลขประจำตัวประชาชนเป็นของนักเรียนเลขประจำตัว ${other.student_code} — ใช้เลขประจำตัวเดิม`); continue; }
      }
      if (!existing && !roomKey) { err("นักเรียนใหม่ต้องระบุห้อง"); continue; }
      plan.push({ code, first, last, prefix, nid, bd, g, roomKey, existing });
    }
    const summary = { add: plan.filter((p) => !p.existing).length, update: plan.filter((p) => p.existing).length };
    if (b.dry_run || errors.length) return json({ ok: !errors.length, dry_run: true, errors, summary });
    const term = await rosterTerm(env, year.id);
    if (!term) fail(409, "ปีการศึกษานี้ยังไม่มีภาคเรียนที่มีรายชื่อ");
    for (const p of plan) {
      let sid = p.existing?.id;
      const stmts = [];
      if (sid) {
        stmts.push(env.DB.prepare(`UPDATE students SET name_prefix = COALESCE(?, name_prefix), first_name = ?, last_name = ?, full_name = ?,
          national_id = COALESCE(?, national_id), birth_date = COALESCE(?, birth_date) WHERE id = ?`)
          .bind(p.prefix || null, p.first, p.last, `${p.prefix}${p.first} ${p.last}`, p.nid || null, p.bd || null, sid));
      } else {
        const [g0, r0] = p.roomKey.split("/");
        const r = await env.DB.prepare(`INSERT INTO students (student_code, full_name, national_id, name_prefix, first_name, last_name, birth_date, grade_level, classroom, status)
          VALUES (?,?,?,?,?,?,?,?,?,'enrolled')`).bind(p.code, `${p.prefix}${p.first} ${p.last}`, p.nid || null, p.prefix || null, p.first, p.last, p.bd || null, g0, r0).run();
        sid = r.meta.last_row_id;
      }
      if (p.g) stmts.push(env.DB.prepare("INSERT INTO student_details (student_id, gender) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET gender = excluded.gender").bind(sid, p.g));
      if (p.roomKey) {
        const [g0, r0] = p.roomKey.split("/");
        stmts.push(...enrollStatements(env, year.id, term, sid, g0, r0, "enrolled"));
      }
      if (stmts.length) await env.DB.batch(stmts);
    }
    await audit(env, user, "roster.import", summary);
    return json({ ok: true, summary });
  }

  fail(404, "ไม่พบ API");
}
