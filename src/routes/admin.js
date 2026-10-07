import { json, readJson, fail, requireAdmin, intParam, text, audit, batchAll, HttpError, requireImporter } from "../lib/http.js";
import { resolveYear, getSettings, listRooms, compareRoom, isPrimaryGrade, isSchoolGrade, mirrorHomerooms } from "../lib/data.js";

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
// สัดส่วนคะแนนเก็บ:ปลายภาคที่ตกลงกันไว้ (ต้องหาร 2 ลงตัวเป็นทศนิยมไม่เกิน 1 ตำแหน่ง เพราะคิดภาคละครึ่ง)
export const ALLOWED_RATIOS = [50, 60, 70, 75, 80, 90, 100];
const RATIO_TEXT = ALLOWED_RATIOS.map((r) => `${r}:${100 - r}`).join(", ");

function cleanSubject(body, settings) {
  const grade = text(body.grade_level, 10);
  if (!PRIMARY_GRADES.includes(grade)) fail(400, "ระดับชั้นต้องเป็น ป.1–ป.6");
  const code = text(body.code, 20).replace(/\s+/g, "");
  if (!code) fail(400, "กรุณาระบุรหัสวิชา");
  const name = text(body.name, 120);
  if (!name) fail(400, "กรุณาระบุชื่อวิชา");
  // ป.1–3 หลักสูตรใหม่มีกลุ่ม/ชื่อวิชาที่ไม่ตรงกลุ่มสาระแกนกลาง จึงรับข้อความอิสระได้
  const area = text(body.learning_area, 80);
  if (!area) fail(400, "กรุณาระบุกลุ่มสาระ");
  const type = ["additional", "เพิ่มเติม"].includes(text(body.subject_type, 20)) ? "additional" : "basic";
  const hours = Number(body.hours_per_year);
  if (!Number.isInteger(hours) || hours < 1 || hours > 400) fail(400, "เวลาเรียนต้องเป็นจำนวนเต็ม 1–400 ชั่วโมง");
  const ratio = body.collect_ratio == null || body.collect_ratio === "" ? settings.collect_ratio : Number(body.collect_ratio);
  if (!ALLOWED_RATIOS.includes(ratio)) fail(400, `สัดส่วนคะแนนเก็บต้องเป็นหนึ่งใน ${RATIO_TEXT}`);
  const sort = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0;
  return { grade, code, name, area, type, hours, ratio, sort };
}

export async function handleAdmin(request, env, user, parts, method, url) {
  requireAdmin(user);
  const [, , section, idPart, action] = parts; // /api/admin/<section>/<id>/<action>
  const isImport = method === "POST" && (section === "import" || (section === "subjects" && idPart === "copy") ||
    (section === "homerooms" && idPart === "import") || (section === "indicator-bank" && idPart === "import"));
  if (isImport) requireImporter(user);

  if (section === "settings") {
    const year = await resolveYear(env, url.searchParams.get("year"));
    if (method === "GET") return json({ year, settings: await getSettings(env, year.id) });
    if (method === "PUT") {
      const b = await readJson(request);
      const pct = (v, label) => { const n = Number(v); if (v === "" || v == null || !Number.isInteger(n) || n < 0 || n > 100) fail(400, `${label}ต้องเป็นจำนวนเต็ม 0–100`); return n; };
      const ratio = pct(b.collect_ratio, "สัดส่วนคะแนนเก็บ");
      if (!ALLOWED_RATIOS.includes(ratio)) fail(400, `สัดส่วนคะแนนเก็บต้องเป็นหนึ่งใน ${RATIO_TEXT}`);
      const s = {
        collect_ratio: ratio,
        indicator_pass_pct: pct(b.indicator_pass_pct, "เกณฑ์ผ่านตัวชี้วัดภาค 1 "),
        indicator_pass_pct_t2: b.indicator_pass_pct_t2 === "" || b.indicator_pass_pct_t2 == null ? null : pct(b.indicator_pass_pct_t2, "เกณฑ์ผ่านตัวชี้วัดภาค 2 "),
        attendance_pass_pct: pct(b.attendance_pass_pct, "เกณฑ์เวลาเรียน"),
        school_name: text(b.school_name, 120), school_area: text(b.school_area, 160), affiliation: text(b.affiliation, 160),
        school_address: text(b.school_address, 160),
        director_name: text(b.director_name, 120), deputy_director_name: text(b.deputy_director_name, 120),
        academic_head_name: text(b.academic_head_name, 120), measurement_head_name: text(b.measurement_head_name, 120),
        entry_open: b.entry_open ? 1 : 0, roster_order: b.roster_order === "code" ? "code" : "gender",
      };
      // เกณฑ์ผ่าน/เกณฑ์เวลาเรียนเปลี่ยนผลของรายวิชาที่ส่งแล้วได้ — ต้องยืนยันก่อน (confirm_locked)
      const before = await getSettings(env, year.id);
      const changed = ["indicator_pass_pct", "indicator_pass_pct_t2", "attendance_pass_pct"].filter((k) => (before[k] ?? null) !== (s[k] ?? null));
      if (changed.length && !b.confirm_locked) {
        const locked = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM gr_courses c JOIN gr_subjects x ON x.id = c.subject_id WHERE x.academic_year_id = ? AND c.locked = 1"
        ).bind(year.id).first();
        if (locked.n > 0) return json({ error: `มี ${locked.n} รายวิชาส่งผลแล้ว การเปลี่ยนเกณฑ์ผ่านหรือเกณฑ์เวลาเรียนจะเปลี่ยนผลของรายวิชาเหล่านั้นด้วย`, needs_confirm: true, locked: locked.n }, 409);
      }
      await upsertSettings(env, year.id, s, user);
      await audit(env, user, "settings.update", { year: year.id, ...s, ...(changed.length ? { criteria_changed: changed } : {}) });
      return json({ ok: true, settings: await getSettings(env, year.id) });
    }
  }

  // ห้องนำร่อง: เปิดใช้ระบบเฉพาะห้องที่เลือก (ว่าง = ทุกห้อง)
  if (section === "pilot" && method === "PUT") {
    const b = await readJson(request);
    const year = await resolveYear(env, b.year);
    const valid = new Set((await listRooms(env, year.id)).filter((r) => isPrimaryGrade(r.grade_level)).map((r) => `${r.grade_level}/${r.classroom}`));
    const rooms = [...new Set((Array.isArray(b.rooms) ? b.rooms : []).map((r) => text(r, 20)))];
    for (const r of rooms) if (!valid.has(r)) fail(400, `ไม่พบห้อง ${r} ในปีการศึกษานี้`);
    await upsertSettings(env, year.id, { pilot_rooms: rooms.length ? JSON.stringify(rooms) : null }, user);
    await audit(env, user, "pilot.set", { year: year.id, rooms });
    return json({ ok: true, pilot_rooms: rooms.length ? rooms : null });
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


  // ---------- นำเข้าจาก Excel (วางข้อมูล) ----------
  // ทุกแบบ: ส่ง dry_run = true เพื่อดูผลตรวจก่อน แล้วค่อยส่งจริง ถ้ามีแถวผิดแม้แถวเดียวจะไม่บันทึกเลย
  if (section === "import" && method === "POST") {
    const b = await readJson(request);
    const year = await resolveYear(env, b.year);
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
    if (!rows.length) fail(400, "ไม่มีข้อมูลให้นำเข้า");
    const errors = [], plan = [];
    const check = (i, fn) => { try { const r = fn(); if (r) plan.push(r); } catch (e) { if (e instanceof HttpError) errors.push({ row: i + 1, error: e.message }); else throw e; } };

    if (idPart === "subjects") {
      const settings = await getSettings(env, year.id);
      const seen = new Set();
      rows.forEach((r, i) => check(i, () => {
        const s = cleanSubject(r, settings);
        const key = `${s.grade}|${s.code}`;
        if (seen.has(key)) fail(400, `รหัส ${s.code} ของ ${s.grade} ซ้ำในไฟล์`);
        seen.add(key);
        if (!r.sort_order && r.sort_order !== 0) s.sort = (i + 1) * 10;
        return s;
      }));
      const { results: existing } = await env.DB.prepare(
        `SELECT s.grade_level, s.code, s.collect_ratio, s.hours_per_year,
                (SELECT COUNT(*) FROM gr_courses c WHERE c.subject_id = s.id AND c.locked = 1) AS locked
           FROM gr_subjects s WHERE s.academic_year_id = ?`
      ).bind(year.id).all();
      const have = new Set(existing.map((e) => `${e.grade_level}|${e.code}`));
      // เหมือนการแก้ทีละวิชา: วิชาที่มีห้องส่งผลแล้ว เปลี่ยนสัดส่วน/เวลาเรียนผ่านการนำเข้าไม่ได้
      const byKey = Object.fromEntries(existing.map((e) => [`${e.grade_level}|${e.code}`, e]));
      plan.forEach((s) => {
        const e = byKey[`${s.grade}|${s.code}`];
        if (e && e.locked > 0 && (e.collect_ratio !== s.ratio || e.hours_per_year !== s.hours)) {
          errors.push({ row: rows.findIndex((r) => text(r.code, 20).replace(/\s+/g, "") === s.code && text(r.grade_level, 10) === s.grade) + 1,
            error: `${s.code} ${s.grade}: เปลี่ยนสัดส่วนคะแนน/เวลาเรียนไม่ได้ เพราะมี ${e.locked} ห้องส่งผลแล้ว — ส่งคืนให้ครูก่อน` });
        }
      });
      const summary = { add: plan.filter((s) => !have.has(`${s.grade}|${s.code}`)).length, update: plan.filter((s) => have.has(`${s.grade}|${s.code}`)).length };
      if (b.dry_run || errors.length) return json({ ok: !errors.length, dry_run: true, errors, summary, preview: plan });
      await batchAll(env, plan.map((s) => env.DB.prepare(`INSERT INTO gr_subjects (academic_year_id, grade_level, code, name, learning_area, subject_type, hours_per_year, collect_ratio, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(academic_year_id, grade_level, code) DO UPDATE SET name=excluded.name, learning_area=excluded.learning_area,
        subject_type=excluded.subject_type, hours_per_year=excluded.hours_per_year, collect_ratio=excluded.collect_ratio, sort_order=excluded.sort_order`)
        .bind(year.id, s.grade, s.code, s.name, s.area, s.type, s.hours, s.ratio, s.sort)));
      await audit(env, user, "import.subjects", { year: year.id, ...summary });
      return json({ ok: true, summary });
    }

    if (idPart === "teachers" || idPart === "homerooms") {
      const findTeacher = await teacherMatcher(env);
      const rooms = new Set((await listRooms(env, year.id)).filter((r) => (idPart === "homerooms" ? isSchoolGrade : isPrimaryGrade)(r.grade_level)).map((r) => `${r.grade_level}/${r.classroom}`));
      const { results: subjects } = await env.DB.prepare("SELECT id, grade_level, code FROM gr_subjects WHERE academic_year_id = ?").bind(year.id).all();
      const subjectOf = Object.fromEntries(subjects.map((x) => [`${x.grade_level}|${x.code}`, x.id]));
      const seen = new Set();
      rows.forEach((r, i) => check(i, () => {
        const room = normRoom(r.room);
        if (!rooms.has(room)) fail(400, `ไม่พบห้อง "${text(r.room, 20)}" (ต้องเป็นแบบ ป.4/2 และมีนักเรียนในระบบบริหารฯ)`);
        const [grade, classroom] = room.split("/");
        const names = String(r.teachers ?? "").split(/[,;\n]/).map((x) => text(x, 120)).filter(Boolean);
        if (!names.length) fail(400, "ไม่ระบุครู");
        if (names.length > (idPart === "teachers" ? 6 : 4)) fail(400, "จำนวนครูเกินที่กำหนด");
        const teacherIds = names.map(findTeacher);
        if (idPart === "homerooms") {
          if (seen.has(room)) fail(400, `ห้อง ${room} ซ้ำในไฟล์`);
          seen.add(room);
          return { room, grade, classroom, teacherIds, names };
        }
        const code = text(r.code, 20).replace(/\s+/g, "");
        const subjectId = subjectOf[`${grade}|${code}`];
        if (!subjectId) fail(400, `ไม่พบรหัสวิชา ${code || "(ว่าง)"} ของ ${grade} — นำเข้ารายวิชาก่อน`);
        if (seen.has(`${room}|${code}`)) fail(400, `${code} ห้อง ${room} ซ้ำในไฟล์`);
        seen.add(`${room}|${code}`);
        return { room, grade, classroom, code, subjectId, teacherIds, names };
      }));
      if (b.dry_run || errors.length) return json({ ok: !errors.length, dry_run: true, errors, summary: { rows: plan.length }, preview: plan.map(({ teacherIds, subjectId, ...p }) => p) });
      if (idPart === "homerooms") {
        await batchAll(env, plan.flatMap((p) => [
          env.DB.prepare("DELETE FROM gr_homerooms WHERE academic_year_id = ? AND grade_level = ? AND classroom = ?").bind(year.id, p.grade, p.classroom),
          ...p.teacherIds.map((t) => env.DB.prepare("INSERT INTO gr_homerooms (academic_year_id, grade_level, classroom, user_id) VALUES (?,?,?,?)").bind(year.id, p.grade, p.classroom, t)),
        ]));
        await mirrorHomerooms(env, year.id, plan.map((p) => ({ grade: p.grade, classroom: p.classroom, userIds: p.teacherIds })), user.id);
      } else {
        // สร้างรายวิชาของห้องให้ถ้ายังไม่มี แล้วแทนที่ครูผู้สอนด้วยรายชื่อในไฟล์
        await batchAll(env, plan.map((p) => env.DB.prepare("INSERT OR IGNORE INTO gr_courses (subject_id, classroom) VALUES (?, ?)").bind(p.subjectId, p.classroom)));
        await batchAll(env, plan.flatMap((p) => [
          env.DB.prepare("DELETE FROM gr_course_teachers WHERE course_id = (SELECT id FROM gr_courses WHERE subject_id = ? AND classroom = ?)").bind(p.subjectId, p.classroom),
          ...p.teacherIds.map((t) => env.DB.prepare("INSERT OR IGNORE INTO gr_course_teachers (course_id, user_id) SELECT id, ? FROM gr_courses WHERE subject_id = ? AND classroom = ?").bind(t, p.subjectId, p.classroom)),
        ]));
      }
      await audit(env, user, `import.${idPart}`, { year: year.id, rows: plan.length });
      return json({ ok: true, summary: { rows: plan.length } });
    }
  }

  // คัดลอกรายวิชาจากปีการศึกษาก่อน (เพิ่มเฉพาะรหัสที่ยังไม่มี)
  if (section === "subjects" && method === "POST" && idPart === "copy") {
    const b = await readJson(request);
    const year = await resolveYear(env, b.year);
    const from = await resolveYear(env, intParam(b.from_year, "ปีต้นทาง"));
    if (from.id === year.id) fail(400, "เลือกปีต้นทางที่ไม่ใช่ปีเดียวกัน");
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO gr_subjects (academic_year_id, grade_level, code, name, learning_area, subject_type, hours_per_year, collect_ratio, sort_order)
      SELECT ?, grade_level, code, name, learning_area, subject_type, hours_per_year, collect_ratio, sort_order FROM gr_subjects WHERE academic_year_id = ?`).bind(year.id, from.id).run();
    await audit(env, user, "subjects.copy", { year: year.id, from: from.id, added: r.meta?.changes ?? 0 });
    return json({ ok: true, added: r.meta?.changes ?? 0 });
  }

  // ---------- รายวิชา (subjects) ----------
  if (section === "subjects") {
    if (method === "GET" && !idPart) {
      const year = await resolveYear(env, url.searchParams.get("year"));
      const { results } = await env.DB.prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM gr_courses c WHERE c.subject_id = s.id) AS course_count,
                (SELECT COUNT(*) FROM gr_courses c WHERE c.subject_id = s.id AND c.locked = 1) AS locked_count,
                (SELECT COUNT(DISTINCT i.course_id) FROM gr_items i JOIN gr_courses c ON c.id = i.course_id WHERE c.subject_id = s.id) AS structured_count
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
      if (s.ratio !== existing.collect_ratio || s.hours !== existing.hours_per_year) {
        // ผลของรายวิชาที่ส่ง/อนุมัติแล้วต้องไม่เปลี่ยนเงียบ ๆ — ให้ส่งคืนก่อน
        const locked = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_courses WHERE subject_id = ? AND locked = 1").bind(id).first();
        if (locked.n > 0) fail(409, `เปลี่ยนสัดส่วนคะแนน/เวลาเรียนไม่ได้ เพราะมี ${locked.n} ห้องส่งผลแล้ว — ส่งคืนให้ครูก่อน`);
      }
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
      await audit(env, user, existing.collect_ratio !== s.ratio ? "subject.ratio" : "subject.update", { id, before: existing, after: s });
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
      const pilot = (await getSettings(env, year.id)).pilot_rooms;
      const rooms = (await listRooms(env, year.id)).filter((r) => isPrimaryGrade(r.grade_level) && (!pilot || pilot.includes(`${r.grade_level}/${r.classroom}`)));
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
    // ส่งคืนให้ครูแก้ (ต้องมีเหตุผล) — ใช้ได้ทั้งตอน "ส่งแล้ว" และ "อนุมัติแล้ว" (แก้ผลย้อนหลัง)
    if (idPart && (action === "return" || (action === "lock" && !(await peekJson(request)).locked)) && method === "POST") {
      const id = intParam(idPart);
      const b = await readJson(request);
      const note = text(b.note, 500);
      if (note.length < 3) fail(400, "กรุณาระบุเหตุผลที่ส่งคืน (ครูจะเห็นข้อความนี้)");
      const before = await env.DB.prepare("SELECT locked, approved_at FROM gr_courses WHERE id = ?").bind(id).first();
      if (!before) fail(404, "ไม่พบรายวิชา");
      if (!before.locked) fail(409, "รายวิชานี้ยังไม่ได้ส่ง");
      await env.DB.prepare(`UPDATE gr_courses SET locked = 0, submitted_at = NULL, submitted_by = NULL, approved_at = NULL, approved_by = NULL, reviewed_at = NULL, reviewed_by = NULL,
        return_note = ?, returned_at = datetime('now'), returned_by = ? WHERE id = ?`).bind(note, user.id, id).run();
      await audit(env, user, before.approved_at ? "course.reopen_approved" : "course.return", { id, note });
      return json({ ok: true });
    }
    if (idPart && action === "lock" && method === "POST") {
      const id = intParam(idPart);
      const r = await env.DB.prepare("UPDATE gr_courses SET locked = 1, submitted_at = COALESCE(submitted_at, datetime('now')), submitted_by = COALESCE(submitted_by, ?) WHERE id = ?").bind(user.id, id).run();
      if (!r.meta?.changes) fail(404, "ไม่พบรายวิชา");
      await audit(env, user, "course.lock", { id });
      return json({ ok: true });
    }
    // ฝ่ายวัดผลตรวจแล้ว (เลือกได้หลายรายวิชา) → ส่งต่อให้ผู้บริหารอนุมัติ
    if (idPart === "review" && !action && method === "POST") {
      const b = await readJson(request);
      const ids = [...new Set((Array.isArray(b.course_ids) ? b.course_ids : []).map((v) => intParam(v)))];
      if (!ids.length) fail(400, "กรุณาเลือกรายวิชา");
      const ph = ids.map(() => "?").join(",");
      const r = await env.DB.prepare(`UPDATE gr_courses SET reviewed_at = datetime('now'), reviewed_by = ? WHERE id IN (${ph}) AND locked = 1 AND reviewed_at IS NULL`).bind(user.id, ...ids).run();
      await audit(env, user, "course.review", { ids, reviewed: r.meta?.changes ?? 0 });
      return json({ ok: true, reviewed: r.meta?.changes ?? 0, skipped: ids.length - (r.meta?.changes ?? 0) });
    }
    // ผู้บริหารอนุมัติผล (เลือกได้หลายรายวิชา) — อนุมัติได้เฉพาะที่ฝ่ายวัดผลตรวจแล้ว
    if (idPart === "approve" && !action && method === "POST") {
      if (!user.is_super) fail(403, "อนุมัติผลได้เฉพาะผู้บริหาร");
      const b = await readJson(request);
      const ids = [...new Set((Array.isArray(b.course_ids) ? b.course_ids : []).map((v) => intParam(v)))];
      if (!ids.length) fail(400, "กรุณาเลือกรายวิชา");
      const ph = ids.map(() => "?").join(",");
      const r = await env.DB.prepare(`UPDATE gr_courses SET approved_at = datetime('now'), approved_by = ? WHERE id IN (${ph}) AND locked = 1 AND reviewed_at IS NOT NULL AND approved_at IS NULL`).bind(user.id, ...ids).run();
      await audit(env, user, "course.approve", { ids, approved: r.meta?.changes ?? 0 });
      return json({ ok: true, approved: r.meta?.changes ?? 0, skipped: ids.length - (r.meta?.changes ?? 0) });
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
      const rooms = (await listRooms(env, year.id)).filter((r) => isSchoolGrade(r.grade_level));
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
      if (!isSchoolGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
      const ids = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map((v) => intParam(v, "ครู")))];
      if (ids.length > 4) fail(400, "ครูประจำชั้นได้ไม่เกิน 4 คนต่อห้อง");
      for (const t of ids) await assertTeacher(env, t);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gr_homerooms WHERE academic_year_id = ? AND grade_level = ? AND classroom = ?").bind(year.id, grade, room),
        ...ids.map((t) => env.DB.prepare("INSERT INTO gr_homerooms (academic_year_id, grade_level, classroom, user_id) VALUES (?,?,?,?)").bind(year.id, grade, room, t)),
      ]);
      await mirrorHomerooms(env, year.id, [{ grade, classroom: room, userIds: ids }], user.id);
      await audit(env, user, "homeroom.set", { year: year.id, grade, room, ids });
      return json({ ok: true });
    }
  }

  // ---------- ดึงข้อมูลล่าสุดจากระบบทะเบียน (เฉพาะ superadmin) ----------
  // ระบบเกรดเป็นที่แก้ข้อมูลที่เดียว ระบบทะเบียนแก้ไม่ได้ — ปุ่มนี้ใช้เมื่อต้องการนำข้อมูลเดิมในระบบทะเบียนมาทับ
  if (section === "sync") {
    if (user.role !== "superadmin") fail(403, "ดึงข้อมูลจากระบบทะเบียนได้เฉพาะผู้ดูแลระบบ (superadmin)");
    const year = await resolveYear(env, url.searchParams.get("year"));
    const regHomerooms = async () => {
      const ok = await env.DB.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='learner_class_assignments'").first();
      if (!ok) return [];
      const { results } = await env.DB.prepare(
        `SELECT DISTINCT a.grade_level, a.classroom, a.teacher_user_id AS user_id FROM learner_class_assignments a
           JOIN academic_terms t ON t.id = a.academic_term_id JOIN users u ON u.id = a.teacher_user_id AND u.status = 'active'
          WHERE t.academic_year_id = ? AND t.term_number = (SELECT MAX(t2.term_number) FROM learner_class_assignments a2 JOIN academic_terms t2 ON t2.id = a2.academic_term_id WHERE t2.academic_year_id = ?)`
      ).bind(year.id, year.id).all();
      return results.filter((r) => isSchoolGrade(r.grade_level));
    };
    const regBody = async () => {
      const { results } = await env.DB.prepare(
        `SELECT d.student_id, d.weight_kg, d.height_cm FROM student_details d
          WHERE (d.weight_kg > 0 OR d.height_cm > 30)
            AND d.student_id IN (SELECT student_id FROM student_enrollments e JOIN academic_terms t ON t.id = e.academic_term_id WHERE t.academic_year_id = ? AND e.status = 'enrolled')
            AND NOT EXISTS (SELECT 1 FROM gr_body b WHERE b.academic_year_id = ? AND b.student_id = d.student_id)`
      ).bind(year.id, year.id).all().catch(() => ({ results: [] }));
      return results;
    };
    if (method === "GET") {
      const reg = await regHomerooms();
      const { results: cur } = await env.DB.prepare("SELECT grade_level, classroom, user_id FROM gr_homerooms WHERE academic_year_id = ?").bind(year.id).all();
      const key = (r) => `${r.grade_level}/${r.classroom}#${r.user_id}`;
      const a = new Set(reg.map(key)), c = new Set(cur.map(key));
      return json({ year, homerooms: { registry: reg.length, current: cur.length, add: [...a].filter((k) => !c.has(k)).length, remove: [...c].filter((k) => !a.has(k)).length },
        body: { fill: (await regBody()).length } });
    }
    if (method === "POST") {
      const b = await readJson(request);
      if (b.what === "homerooms") {
        const reg = await regHomerooms();
        if (!reg.length) fail(409, "ระบบทะเบียนยังไม่มีข้อมูลครูประจำชั้นของปีนี้ — ไม่ได้เปลี่ยนอะไร");
        await env.DB.batch([
          env.DB.prepare("DELETE FROM gr_homerooms WHERE academic_year_id = ?").bind(year.id),
          ...reg.map((r) => env.DB.prepare("INSERT OR IGNORE INTO gr_homerooms (academic_year_id, grade_level, classroom, user_id) VALUES (?,?,?,?)").bind(year.id, r.grade_level, r.classroom, r.user_id)),
        ]);
        await audit(env, user, "sync.homerooms", { year: year.id, rows: reg.length });
        return json({ ok: true, rows: reg.length });
      }
      if (b.what === "body") {
        const rows = await regBody();
        for (let i = 0; i < rows.length; i += 90) await env.DB.batch(rows.slice(i, i + 90).map((r) => env.DB.prepare(
          "INSERT OR IGNORE INTO gr_body (academic_year_id, student_id, round, weight, height, updated_by) VALUES (?,?,1,?,?,?)"
        ).bind(year.id, r.student_id, r.weight_kg > 0 && r.weight_kg < 200 ? r.weight_kg : null, r.height_cm > 30 && r.height_cm < 230 ? r.height_cm : null, user.id)));
        await audit(env, user, "sync.body", { year: year.id, rows: rows.length });
        return json({ ok: true, rows: rows.length });
      }
      fail(400, "เลือกข้อมูลที่จะดึง");
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

// บันทึกค่าตั้งของปี เฉพาะคอลัมน์ที่ส่งมา (คอลัมน์อื่นคงเดิม)
const SETTING_COLUMNS = ["collect_ratio", "indicator_pass_pct", "indicator_pass_pct_t2", "attendance_pass_pct", "school_name", "school_area",
  "affiliation", "school_address", "director_name", "deputy_director_name", "academic_head_name", "measurement_head_name", "entry_open", "roster_order", "pilot_rooms"];
async function upsertSettings(env, yearId, values, user) {
  const cols = Object.keys(values).filter((k) => SETTING_COLUMNS.includes(k));
  await env.DB.prepare("INSERT OR IGNORE INTO gr_settings (academic_year_id) VALUES (?)").bind(yearId).run();
  await env.DB.prepare(`UPDATE gr_settings SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_by = ?, updated_at = datetime('now') WHERE academic_year_id = ?`)
    .bind(...cols.map((c) => values[c]), user.id, yearId).run();
}

// "ป.4/2", "ป4/2", "ป. 4 / 2", "4/2" → "ป.4/2"
export function normRoom(v) {
  const m = String(v ?? "").replace(/\s+/g, "").match(/^(?:ป\.?)?([1-6])\/(\d+)$/);
  return m ? `ป.${m[1]}/${m[2]}` : String(v ?? "").trim();
}

// จับคู่ชื่อครูในไฟล์กับบัญชีผู้ใช้: ตรงกับอีเมล หรือชื่อ-สกุล (ไม่สนคำนำหน้าและช่องว่าง)
const PREFIX = /^(นางสาว|นาง|นาย|น\.ส\.|ว่าที่ร้อยตรี|ว่าที่ ร\.ต\.|ดร\.|ครู)\s*/;
const normName = (n) => {
  let s = String(n || "").trim(), prev;
  do { prev = s; s = s.replace(PREFIX, ""); } while (s !== prev); // คำนำหน้าซ้อนกันได้ เช่น "นางครู…"
  return s.replace(/\s+/g, "");
};
async function teacherMatcher(env) {
  const { results } = await env.DB.prepare("SELECT id, email, full_name FROM users WHERE status = 'active' AND deleted_at IS NULL AND role IS NOT NULL").all();
  const byEmail = new Map(results.map((u) => [String(u.email).toLowerCase(), u.id]));
  const byName = new Map();
  for (const u of results) { const k = normName(u.full_name); byName.set(k, byName.has(k) ? -1 : u.id); }
  return (name) => {
    const id = byEmail.get(name.toLowerCase()) ?? byName.get(normName(name));
    if (id === -1) fail(400, `ชื่อ "${name}" ซ้ำกันหลายบัญชี ให้ใช้อีเมลแทน`);
    if (!id) fail(400, `ไม่พบบัญชีครู "${name}" (ใช้ชื่อ-สกุลตามระบบ หรืออีเมล)`);
    return id;
  };
}

// อ่าน body โดยไม่กิน stream (ใช้แยกเส้นทาง lock เก่า)
async function peekJson(request) {
  try { return await request.clone().json(); } catch { return {}; }
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
    `SELECT c.id, c.classroom, c.locked, c.submitted_at, c.approved_at, c.reviewed_at, c.return_note, c.returned_at, s.id AS subject_id, s.grade_level, s.code, s.name, s.learning_area,
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
  const { results: edits } = await env.DB.prepare("SELECT course_id, COUNT(*) AS n FROM gr_course_edits GROUP BY course_id").all();
  const editCounts = Object.fromEntries(edits.map((e) => [e.course_id, e.n]));
  const size = Object.fromEntries(rooms.map((r) => [`${r.grade_level}|${r.classroom}`, r.students]));
  for (const c of courses) {
    c.teachers = teachers.filter((t) => t.course_id === c.id).map((t) => ({ id: t.id, full_name: t.full_name }));
    c.students = size[`${c.grade_level}|${c.classroom}`] || 0;
    const expected = c.item_count * c.students;
    c.progress = expected ? Math.min(100, Math.round((c.filled / expected) * 100)) : 0;
    c.status = !c.locked ? "draft" : c.approved_at ? "approved" : c.reviewed_at ? "reviewed" : "submitted";
    c.edit_count = editCounts[c.id] || 0;
  }
  return courses.sort((a, b) => compareRoom(a, b) || (a.subject_type === "additional") - (b.subject_type === "additional") || a.sort_order - b.sort_order || a.code.localeCompare(b.code));
}
