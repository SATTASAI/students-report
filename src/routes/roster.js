// รายชื่อนักเรียน (ฝ่ายวัดผล/ผู้ดูแลระบบ): แก้คำนำหน้า ชื่อ สกุล เพศ ห้อง และกำหนดเลขที่เอง
// เขียนลงตารางทะเบียนเดียวกับระบบบริหารโรงเรียน (students / student_details / student_enrollments) จึงตรงกันทั้งสองระบบ
import { json, readJson, fail, requireImporter, intParam, text, audit } from "../lib/http.js";
import { resolveYear, roomRoster, listRooms, studentName, isSchoolGrade, LEFT_STATUSES } from "../lib/data.js";
import { rosterTerm, enrollStatements, latestInYear, termStarted, nextNumber, pinStatement, holdNumbersAfter } from "./moves.js";
import { normRoom } from "./admin.js";
import { decideStudent, ensureMatchReviews, MATCH_FIELDS } from "../lib/student-match.js";

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
      transfer_in_term: s.transfer_in_term || null, enrollment_status: s.enrollment_status,
    })) });
  }

  // เรียงเลขที่ใหม่ทั้งห้อง: ล้างเลขที่ที่ตรึงไว้/เว้นไว้ทั้งหมดของห้อง แล้วเรียงตามเกณฑ์ปกติ (ใช้ตอนขึ้นภาค/ปีใหม่)
  if (parts[2] === "renumber" && method === "POST") {
    const b = await readJson(request);
    const grade = text(b.grade_level, 10), room = text(b.classroom, 10);
    if (!isSchoolGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
    const r = await env.DB.prepare(
      `DELETE FROM gr_roster_numbers WHERE academic_year_id = ? AND student_id IN (
         SELECT student_id FROM (SELECT se.student_id, se.grade_level, se.classroom,
                ROW_NUMBER() OVER (PARTITION BY se.student_id ORDER BY t.term_number DESC, se.id DESC) AS rn
           FROM student_enrollments se JOIN academic_terms t ON t.id = se.academic_term_id WHERE t.academic_year_id = ?)
          WHERE rn = 1 AND grade_level = ? AND classroom = ?)`
    ).bind(year.id, year.id, grade, room).run();
    await audit(env, user, "roster.renumber", { grade, room, cleared: r.meta?.changes ?? 0 });
    return json({ ok: true, cleared: r.meta?.changes ?? 0 });
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
      const started = await termStarted(env, term);
      // หลังเปิดภาค: ห้องเดิมเว้นเลขที่ของคนที่ย้ายไว้ (คนถัดไปไม่เลื่อน) และห้องใหม่ได้เลขที่ต่อท้าย
      if (started) stmts.push(...await holdNumbersAfter(env, year.id, cur.grade_level, cur.classroom, sid, user.id));
      const n = started ? await nextNumber(env, year.id, grade, room, new Map()) : null;
      stmts.push(n != null ? pinStatement(env, year.id, sid, n, user.id)
        : env.DB.prepare("DELETE FROM gr_roster_numbers WHERE academic_year_id = ? AND student_id = ?").bind(year.id, sid));
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
  // ---------- นำเข้ารายชื่อนักเรียนจาก Excel / DMC (ระบบทะเบียนนำเข้าเองไม่ได้แล้ว) ----------
  // แถว: student_code, name_prefix, first_name, last_name, national_id, birth_date, gender, room (เช่น ป.1/2)
  // จับคู่กับทะเบียนแบบหลายช่อง (src/lib/student-match.js): ตรง ≥ 3 ช่องและไม่ขัดกัน = คนเดิม (ปรับข้อมูล + ย้ายห้องตามไฟล์)
  // ไม่พบใครเลย = นักเรียนใหม่ · มีคนคล้ายแต่ข้อมูลไม่ตรง = ไม่นำเข้าแถวนั้น ส่งให้ผู้ดูแลตรวจ (gr_student_match_reviews)
  if (parts[2] === "import" && method === "POST") {
    const b = await readJson(request);
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 1500) : [];
    if (!rows.length) fail(400, "ไม่มีข้อมูลให้นำเข้า");
    const rooms = new Set((await listRooms(env, year.id)).filter((r) => isSchoolGrade(r.grade_level)).map((r) => `${r.grade_level}/${r.classroom}`));
    const students = await registryStudents(env);
    const errors = [], plan = [], review = [], seen = new Set(), seenNid = new Map();
    for (const [i, raw] of rows.entries()) {
      const err = (m) => errors.push({ row: i + 1, error: m });
      const p = parseImportRow(raw);
      if (!p.code) { err("ไม่มีเลขประจำตัวนักเรียน"); continue; }
      if (seen.has(p.code)) { err(`เลขประจำตัว ${p.code} ซ้ำในไฟล์`); continue; }
      seen.add(p.code);
      if (!p.first || !p.last) { err("ต้องมีชื่อและนามสกุล"); continue; }
      if (p.nid && p.nid.length !== 13) { err("เลขประจำตัวประชาชนต้องมี 13 หลัก"); continue; }
      if (p.nid && seenNid.has(p.nid)) { err(`เลขประจำตัวประชาชนซ้ำกับแถวที่ ${seenNid.get(p.nid)}`); continue; }
      if (p.nid) seenNid.set(p.nid, i + 1);
      if (p.bd && (!/^\d{4}-\d{2}-\d{2}$/.test(p.bd) || Number.isNaN(Date.parse(p.bd)))) { err("วันเกิดต้องเป็นรูปแบบ ปปปป-ดด-วว (ค.ศ.)"); continue; }
      if (p.roomKey && !rooms.has(p.roomKey)) { err(`ไม่พบห้อง ${p.roomKey} ในปีการศึกษานี้`); continue; }
      const d = decideStudent(matchInput(p), students);
      if (d.decision === "review") { review.push({ row: i + 1, p, candidates: d.candidates.map(briefCandidate) }); continue; }
      if (d.decision === "new" && !p.roomKey) { err("นักเรียนใหม่ต้องระบุห้อง"); continue; }
      plan.push({ ...p, existing: d.decision === "existing" ? { id: d.student.id, status: d.student.status } : null });
    }
    const summary = { add: plan.filter((p) => !p.existing).length, update: plan.filter((p) => p.existing).length, review: review.length };
    const reviewOut = review.map((r) => ({ row: r.row, file: publicFile(r.p), candidates: r.candidates }));
    if (b.dry_run || errors.length) return json({ ok: !errors.length, dry_run: true, errors, summary, review: reviewOut });
    const term = await rosterTerm(env, year.id);
    if (!term) fail(409, "ปีการศึกษานี้ยังไม่มีภาคเรียนที่มีรายชื่อ");
    const ctx = { env, year, term, user, started: await termStarted(env, term), next: new Map(), appended: 0 };
    for (const p of plan) await applyImportRow(ctx, p);
    if (review.length) await saveReviews(env, year.id, user.id, review);
    await audit(env, user, "roster.import", { ...summary, appended: ctx.appended });
    return json({ ok: true, summary, appended: ctx.appended, review: reviewOut });
  }

  // ---------- รายการที่ข้อมูลไม่ตรง รอผู้ดูแลตรวจ ----------
  if (parts[2] === "reviews" && user.role !== "superadmin") fail(403, "ตรวจข้อมูลนักเรียนที่ไม่ตรงได้เฉพาะผู้ดูแลระบบ");
  if (parts[2] === "reviews" && !parts[3] && method === "GET") {
    await ensureMatchReviews(env);
    const { results } = await env.DB.prepare(`SELECT r.id, r.payload, r.candidates, r.created_at, u.full_name AS created_by_name FROM gr_student_match_reviews r
      LEFT JOIN users u ON u.id = r.created_by WHERE r.status = 'pending' ORDER BY r.id LIMIT 500`).all();
    return json({ fields: MATCH_FIELDS, reviews: (results || []).map((r) => ({ id: r.id, created_at: r.created_at, created_by: r.created_by_name || "",
      file: publicFile(JSON.parse(r.payload)), candidates: JSON.parse(r.candidates) })) });
  }
  if (parts[2] === "reviews" && parts[3] && method === "POST") {
    await ensureMatchReviews(env);
    const id = intParam(parts[3]);
    const row = await env.DB.prepare("SELECT * FROM gr_student_match_reviews WHERE id = ? AND status = 'pending'").bind(id).first();
    if (!row) fail(404, "ไม่พบรายการ หรือมีผู้ตรวจไปแล้ว");
    const b = await readJson(request);
    const p = JSON.parse(row.payload);
    const done = (status, sid) => env.DB.prepare("UPDATE gr_student_match_reviews SET status = ?, resolved_student_id = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .bind(status, sid ?? null, user.id, id).run();
    if (b.action === "dismiss") { await done("dismissed"); await audit(env, user, "roster.review", { id, action: "dismiss" }); return json({ ok: true }); }
    const ryear = await resolveYear(env, String(row.academic_year_id));
    const term = await rosterTerm(env, ryear.id);
    if (!term) fail(409, "ปีการศึกษานี้ยังไม่มีภาคเรียนที่มีรายชื่อ");
    const ctx = { env, year: ryear, term, user, started: await termStarted(env, term), next: new Map(), appended: 0 };
    if (b.action === "match") {
      const sid = intParam(b.student_id, "นักเรียน");
      const st = await env.DB.prepare("SELECT id, status FROM students WHERE id = ?").bind(sid).first();
      if (!st) fail(404, "ไม่พบนักเรียน");
      // ยืนยันว่าเป็นคนเดิม: ใช้เลขประจำตัว/เลขบัตรตามไฟล์ถ้าไม่ชนกับคนอื่น
      const clash = await env.DB.prepare("SELECT student_code FROM students WHERE id <> ? AND (student_code = ? OR (? <> '' AND national_id = ?))").bind(sid, p.code, p.nid || "", p.nid || "").first();
      if (clash) fail(409, `เลขประจำตัว/เลขบัตรตามไฟล์เป็นของนักเรียนเลขประจำตัว ${clash.student_code} — ตรวจข้อมูลอีกครั้ง`);
      await applyImportRow(ctx, { ...p, existing: { id: sid, status: st.status }, setCode: true });
      await done("matched", sid);
      await audit(env, user, "roster.review", { id, action: "match", student_id: sid });
      return json({ ok: true });
    }
    if (b.action === "create") {
      const clash = await env.DB.prepare("SELECT student_code FROM students WHERE student_code = ? OR (? <> '' AND national_id = ?)").bind(p.code, p.nid || "", p.nid || "").first();
      if (clash) fail(409, `เลขประจำตัว/เลขบัตรซ้ำกับนักเรียนเลขประจำตัว ${clash.student_code} — เพิ่มเป็นคนใหม่ไม่ได้`);
      if (!p.roomKey) fail(400, "นักเรียนใหม่ต้องระบุห้อง — แก้ไฟล์แล้วนำเข้าใหม่");
      const sid = await applyImportRow(ctx, { ...p, existing: null });
      await done("created", sid);
      await audit(env, user, "roster.review", { id, action: "create", student_id: sid });
      return json({ ok: true });
    }
    fail(400, "การดำเนินการไม่ถูกต้อง");
  }

  fail(404, "ไม่พบ API");
}

function parseImportRow(raw) {
  const prefix = text(raw.name_prefix, 30);
  const gRaw = text(raw.gender, 10);
  return {
    code: text(raw.student_code, 20).replace(/\s+/g, ""),
    first: text(raw.first_name, 80), last: text(raw.last_name, 80), prefix,
    nid: String(raw.national_id || "").replace(/\D/g, ""),
    bd: text(raw.birth_date, 10),
    g: /^(ช|ชาย|m)/i.test(gRaw) ? "ช" : /^(ญ|หญิง|f)/i.test(gRaw) ? "ญ" : (/ชาย/.test(prefix) ? "ช" : /หญิง/.test(prefix) ? "ญ" : null),
    roomKey: raw.room ? normRoom(text(raw.room, 20)) : "", // "ป4/2", "ป. 4/2", "อ1/1" → รูปแบบเดียวกับห้องในระบบ
  };
}
const matchInput = (p) => ({ code: p.code, nid: p.nid, first: p.first, last: p.last, birth: p.bd, gender: p.g, grade: p.roomKey.split("/")[0] });
const publicFile = (p) => ({ student_code: p.code, name_prefix: p.prefix, first_name: p.first, last_name: p.last, national_id: p.nid, birth_date: p.bd, gender: p.g || "", room: p.roomKey });
const briefCandidate = (s) => ({ id: s.id, student_code: s.student_code, name: studentName(s), national_id: s.national_id || "", birth_date: s.birth_date || "",
  gender: s.gender || "", room: s.grade_level ? `${s.grade_level}/${s.classroom || ""}` : "", status: s.status, matched: s.matched, conflicts: s.conflicts });

async function registryStudents(env) {
  const { results } = await env.DB.prepare(`SELECT s.id, s.student_code, s.national_id, s.name_prefix, s.first_name, s.last_name, s.full_name, s.birth_date,
    s.grade_level, s.classroom, s.status, d.gender FROM students s LEFT JOIN student_details d ON d.student_id = s.id`).all();
  return results || [];
}

async function saveReviews(env, yearId, userId, review) {
  await ensureMatchReviews(env);
  const stmts = [];
  for (const r of review) {
    const key = [r.p.code, r.p.nid, `${r.p.first}${r.p.last}`].join("|");
    // แถวเดิมที่ยังรอตรวจ: แทนที่ด้วยข้อมูลล่าสุด ไม่สร้างซ้ำ
    stmts.push(env.DB.prepare("DELETE FROM gr_student_match_reviews WHERE academic_year_id = ? AND row_key = ? AND status = 'pending'").bind(yearId, key));
    stmts.push(env.DB.prepare("INSERT INTO gr_student_match_reviews (academic_year_id, row_key, payload, candidates, created_by) VALUES (?,?,?,?,?)")
      .bind(yearId, key, JSON.stringify(r.p), JSON.stringify(r.candidates), userId));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
}

// เขียนนักเรียน 1 คนตามไฟล์ (ปรับคนเดิม หรือเพิ่มคนใหม่) และลงทะเบียนเข้าห้อง — คืน student id
async function applyImportRow(ctx, p) {
  const { env, year, term, user } = ctx;
  let sid = p.existing?.id;
  const stmts = [];
  if (sid) {
    stmts.push(env.DB.prepare(`UPDATE students SET name_prefix = COALESCE(?, name_prefix), first_name = ?, last_name = ?, full_name = ?,
      national_id = COALESCE(?, national_id), birth_date = COALESCE(?, birth_date) WHERE id = ?`)
      .bind(p.prefix || null, p.first, p.last, `${p.prefix}${p.first} ${p.last}`, p.nid || null, p.bd || null, sid));
    if (p.setCode && p.code) stmts.push(env.DB.prepare("UPDATE students SET student_code = ? WHERE id = ?").bind(p.code, sid));
  } else {
    const [g0, r0] = p.roomKey.split("/");
    const r = await env.DB.prepare(`INSERT INTO students (student_code, full_name, national_id, name_prefix, first_name, last_name, birth_date, grade_level, classroom, status)
      VALUES (?,?,?,?,?,?,?,?,?,'enrolled')`).bind(p.code, `${p.prefix}${p.first} ${p.last}`, p.nid || null, p.prefix || null, p.first, p.last, p.bd || null, g0, r0).run();
    sid = r.meta.last_row_id;
  }
  if (p.g) stmts.push(env.DB.prepare("INSERT INTO student_details (student_id, gender) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET gender = excluded.gender").bind(sid, p.g));
  if (p.roomKey) {
    const [g0, r0] = p.roomKey.split("/");
    const cur = p.existing ? await latestInYear(env, year.id, sid) : null;
    const changed = !cur || LEFT_STATUSES.includes(cur.status) || cur.grade_level !== g0 || cur.classroom !== r0;
    // หลังเปิดภาค: คนที่เพิ่ม/ย้ายเข้าห้องนี้ต่อท้ายเลขที่ (คนเดิมไม่เลื่อน) — ก่อนเปิดภาคเรียงใหม่ตามปกติ
    const n = changed && ctx.started ? await nextNumber(env, year.id, g0, r0, ctx.next) : null;
    if (changed && ctx.started && cur && !LEFT_STATUSES.includes(cur.status)) stmts.push(...await holdNumbersAfter(env, year.id, cur.grade_level, cur.classroom, sid, user.id));
    stmts.push(...enrollStatements(env, year.id, term, sid, g0, r0, "enrolled"));
    if (n != null) { stmts.push(pinStatement(env, year.id, sid, n, user.id)); ctx.appended++; }
    else if (changed && cur) stmts.push(env.DB.prepare("DELETE FROM gr_roster_numbers WHERE academic_year_id = ? AND student_id = ?").bind(year.id, sid));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return sid;
}
