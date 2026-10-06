import { json, readJson, fail, requireUser, intParam, text, audit, batchAll } from "../lib/http.js";
import { assertCourseAccess, courseBundle, loadCourse, canViewCourse, studentName } from "../lib/data.js";
import { computeStudentResult, validateRemedial } from "../../public/js/grading.js";
import { gradeSettings, getSettings } from "../lib/data.js";

const MAX_ITEMS_PER_COURSE = 80;

function serializeBundle(b, user) {
  return {
    course: { ...b.course, can_edit: !b.course.locked && (b.settings.entry_open || user.is_admin) },
    settings: b.settings,
    items: b.items,
    students: b.roster.map((s) => ({
      id: s.id, number: s.number, student_code: s.student_code, name: studentName(s),
      gender: s.gender || null, enrollment_status: s.enrollment_status,
    })),
    scores: b.scores,
    results: b.results,
    computed: b.computed,
    is_admin: user.is_admin,
  };
}

function cleanItem(raw, i = 0) {
  const term = Number(raw.term_number);
  if (![1, 2].includes(term)) fail(400, "ภาคเรียนต้องเป็น 1 หรือ 2");
  const kind = raw.kind === "final" ? "final" : "indicator";
  const title = text(raw.title, 500);
  if (!title) fail(400, `รายการที่ ${i + 1}: กรุณาระบุชื่อตัวชี้วัด/การสอบ`);
  const max = Number(raw.max_score);
  if (!Number.isFinite(max) || max <= 0 || max > 1000) fail(400, `รายการที่ ${i + 1}: คะแนนเต็มต้องมากกว่า 0 และไม่เกิน 1000`);
  return { term, kind, code: text(raw.code, 60) || null, title, max: Math.round(max * 100) / 100 };
}

export async function handleCourses(request, env, user, parts, method, url) {
  requireUser(user);
  const id = intParam(parts[2]);
  const sub = parts[3];

  if (!sub && method === "GET") {
    const course = await assertCourseAccess(env, user, id);
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  // ---------- โครงสร้างคะแนน ----------
  if (sub === "items" && method === "POST") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const b = await readJson(request);
    const list = (Array.isArray(b.items) ? b.items : [b]).map(cleanItem);
    if (!list.length) fail(400, "ไม่มีรายการให้เพิ่ม");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order),0) AS mx FROM gr_items WHERE course_id = ?").bind(course.id).first();
    if (count.n + list.length > MAX_ITEMS_PER_COURSE) fail(400, `รายวิชาหนึ่งมีช่องคะแนนได้ไม่เกิน ${MAX_ITEMS_PER_COURSE} ช่อง`);
    await batchAll(env, list.map((it, i) => env.DB.prepare(
      "INSERT INTO gr_items (course_id, term_number, kind, code, title, max_score, sort_order) VALUES (?,?,?,?,?,?,?)"
    ).bind(course.id, it.term, it.kind, it.code, it.title, it.max, count.mx + (i + 1) * 10)));
    await audit(env, user, "items.add", { course: course.id, count: list.length });
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  if (sub === "items" && parts[4] && method === "PUT") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const itemId = intParam(parts[4]);
    const existing = await env.DB.prepare("SELECT * FROM gr_items WHERE id = ? AND course_id = ?").bind(itemId, course.id).first();
    if (!existing) fail(404, "ไม่พบช่องคะแนน");
    const it = cleanItem(await readJson(request));
    if (it.max < existing.max_score) {
      const over = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores WHERE item_id = ? AND score > ?").bind(itemId, it.max).first();
      if (over.n > 0) fail(409, `ลดคะแนนเต็มไม่ได้ — มีนักเรียน ${over.n} คนได้คะแนนเกิน ${it.max} แล้ว`);
    }
    await env.DB.prepare("UPDATE gr_items SET term_number=?, kind=?, code=?, title=?, max_score=? WHERE id=?")
      .bind(it.term, it.kind, it.code, it.title, it.max, itemId).run();
    await audit(env, user, "item.update", { course: course.id, itemId, before: existing, after: it });
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  if (sub === "items" && parts[4] && method === "DELETE") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const itemId = intParam(parts[4]);
    const existing = await env.DB.prepare("SELECT * FROM gr_items WHERE id = ? AND course_id = ?").bind(itemId, course.id).first();
    if (!existing) fail(404, "ไม่พบช่องคะแนน");
    const filled = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores WHERE item_id = ? AND score IS NOT NULL").bind(itemId).first();
    if (filled.n > 0 && url.searchParams.get("confirm") !== "1") {
      return json({ error: `ช่องนี้มีคะแนนแล้ว ${filled.n} คน ต้องการลบพร้อมคะแนนหรือไม่`, needs_confirm: true, filled: filled.n }, 409);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM gr_scores WHERE item_id = ?").bind(itemId),
      env.DB.prepare("DELETE FROM gr_items WHERE id = ?").bind(itemId),
    ]);
    await audit(env, user, "item.delete", { course: course.id, item: existing, scores_removed: filled.n });
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  if (sub === "items-order" && method === "PUT") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const b = await readJson(request);
    const order = (Array.isArray(b.item_ids) ? b.item_ids : []).map((v) => intParam(v));
    await batchAll(env, order.map((itemId, i) => env.DB.prepare("UPDATE gr_items SET sort_order = ? WHERE id = ? AND course_id = ?").bind((i + 1) * 10, itemId, course.id)));
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  // คัดลอกโครงสร้างคะแนนจากรายวิชาอื่น (ห้องอื่นของวิชาเดียวกัน หรือปีก่อน)
  if (sub === "copy-items" && method === "POST") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const b = await readJson(request);
    const source = await loadCourse(env, intParam(b.source_course_id, "รายวิชาต้นทาง"));
    if (!canViewCourse(user, source) && !(await sameSubjectFamily(env, course, source))) fail(403, "ไม่มีสิทธิ์ดูรายวิชาต้นทาง");
    const terms = Array.isArray(b.terms) && b.terms.length ? b.terms.map(Number).filter((t) => [1, 2].includes(t)) : [1, 2];
    const { results: srcItems } = await env.DB.prepare(
      `SELECT term_number, kind, code, title, max_score FROM gr_items WHERE course_id = ? AND term_number IN (${terms.map(() => "?").join(",")}) ORDER BY term_number, sort_order, id`
    ).bind(source.id, ...terms).all();
    if (!srcItems.length) fail(400, "รายวิชาต้นทางยังไม่มีโครงสร้างคะแนน");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order),0) AS mx FROM gr_items WHERE course_id = ?").bind(course.id).first();
    if (count.n + srcItems.length > MAX_ITEMS_PER_COURSE) fail(400, `รวมแล้วเกิน ${MAX_ITEMS_PER_COURSE} ช่อง`);
    await batchAll(env, srcItems.map((it, i) => env.DB.prepare(
      "INSERT INTO gr_items (course_id, term_number, kind, code, title, max_score, sort_order) VALUES (?,?,?,?,?,?,?)"
    ).bind(course.id, it.term_number, it.kind, it.code, it.title, it.max_score, count.mx + (i + 1) * 10)));
    await audit(env, user, "items.copy", { course: course.id, source: source.id, count: srcItems.length });
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  // รายวิชาที่ใช้เป็นต้นแบบได้: วิชาเดียวกันห้องอื่น + รหัสเดียวกันปีก่อน
  if (sub === "siblings" && method === "GET") {
    const course = await assertCourseAccess(env, user, id);
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.classroom, s.grade_level, s.code, s.name, y.year_be,
              (SELECT COUNT(*) FROM gr_items i WHERE i.course_id = c.id) AS item_count
         FROM gr_courses c JOIN gr_subjects s ON s.id = c.subject_id JOIN academic_years y ON y.id = s.academic_year_id
        WHERE c.id <> ? AND (s.id = ? OR (s.code = ? AND s.grade_level = ?))
        ORDER BY y.year_be DESC, c.classroom`
    ).bind(course.id, course.subject_id, course.code, course.grade_level).all();
    return json({ courses: results.filter((r) => r.item_count > 0) });
  }

  if (sub === "bank" && method === "GET") {
    const course = await assertCourseAccess(env, user, id);
    const { results } = await env.DB.prepare(
      "SELECT id, code, title FROM gr_indicator_bank WHERE grade_level = ? AND learning_area = ? ORDER BY code, id LIMIT 500"
    ).bind(course.grade_level, course.learning_area).all();
    return json({ indicators: results });
  }

  // ---------- บันทึกคะแนน (ทีละหลายช่อง) ----------
  if (sub === "scores" && method === "PUT") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const b = await readJson(request);
    const changes = Array.isArray(b.changes) ? b.changes : [];
    if (!changes.length) return json({ ok: true, saved: 0 });
    if (changes.length > 3000) fail(400, "บันทึกได้ครั้งละไม่เกิน 3000 ช่อง");
    const bundle = await courseBundle(env, course);
    const items = Object.fromEntries(bundle.items.map((i) => [i.id, i]));
    const students = new Set(bundle.roster.map((s) => s.id));
    const errors = [];
    const stmts = [];
    for (const [i, c] of changes.entries()) {
      const item = items[c.item_id];
      if (!item) { errors.push({ index: i, error: "ไม่พบช่องคะแนน" }); continue; }
      if (!students.has(Number(c.student_id))) { errors.push({ index: i, error: "นักเรียนไม่อยู่ในรายวิชานี้" }); continue; }
      let score = c.score;
      if (score === "" || score == null) score = null;
      else {
        score = Number(score);
        if (!Number.isFinite(score) || score < 0) { errors.push({ index: i, item_id: c.item_id, student_id: c.student_id, error: "คะแนนต้องเป็นตัวเลขไม่ติดลบ" }); continue; }
        if (score > item.max_score + 1e-9) { errors.push({ index: i, item_id: c.item_id, student_id: c.student_id, error: `เกินคะแนนเต็ม ${item.max_score}` }); continue; }
        score = Math.round(score * 100) / 100;
      }
      stmts.push(score == null
        ? env.DB.prepare("DELETE FROM gr_scores WHERE item_id = ? AND student_id = ?").bind(item.id, Number(c.student_id))
        : env.DB.prepare(`INSERT INTO gr_scores (item_id, student_id, score, updated_by, updated_at) VALUES (?,?,?,?,datetime('now'))
            ON CONFLICT(item_id, student_id) DO UPDATE SET score = excluded.score, updated_by = excluded.updated_by, updated_at = datetime('now')`)
          .bind(item.id, Number(c.student_id), score, user.id));
    }
    if (errors.length) return json({ error: "มีคะแนนที่ไม่ถูกต้อง ระบบยังไม่ได้บันทึกชุดนี้", errors }, 400);
    await batchAll(env, stmts);
    return json({ ok: true, saved: stmts.length });
  }

  // ---------- เวลาเรียน / ร / มส / แก้ตัว ----------
  if (sub === "results" && method === "PUT") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const b = await readJson(request);
    const changes = Array.isArray(b.changes) ? b.changes.slice(0, 200) : [];
    const bundle = await courseBundle(env, course);
    const students = new Set(bundle.roster.map((s) => s.id));
    const settings = gradeSettings(course, bundle.settings);
    const stmts = [];
    for (const c of changes) {
      const sid = Number(c.student_id);
      if (!students.has(sid)) fail(400, "นักเรียนไม่อยู่ในรายวิชานี้");
      const prev = bundle.results[sid] || {};
      const next = { ...prev };
      if ("hours_attended" in c) {
        if (c.hours_attended === "" || c.hours_attended == null) next.hours_attended = null;
        else {
          const h = Number(c.hours_attended);
          if (!Number.isFinite(h) || h < 0 || h > course.hours_per_year) fail(400, `เวลาเรียนต้องอยู่ระหว่าง 0–${course.hours_per_year} ชั่วโมง`);
          next.hours_attended = Math.round(h * 10) / 10;
        }
      }
      if ("special" in c) {
        if (![null, "", "ร", "มส"].includes(c.special)) fail(400, "ผลพิเศษต้องเป็น ร หรือ มส");
        next.special = c.special || null;
        next.special_note = text(c.special_note, 300) || null;
      }
      if ("remedial_type" in c || "remedial_grade" in c) {
        const type = c.remedial_type || null, grade = c.remedial_grade === "" || c.remedial_grade == null ? null : String(c.remedial_grade);
        if (type || grade) {
          // ตรวจกับผลเดิม (ก่อนแก้) ที่คำนวณจากคะแนนจริง
          const original = computeStudentResult(bundle.items, bundle.scores[sid] || {}, { ...next, remedial_grade: null }, settings).original_grade;
          const err = validateRemedial(original, type, grade);
          if (err) fail(400, `${studentName(bundle.roster.find((s) => s.id === sid))}: ${err}`);
          next.remedial_type = type; next.remedial_grade = grade;
          next.remedial_date = /^\d{4}-\d{2}-\d{2}$/.test(c.remedial_date || "") ? c.remedial_date : null;
          next.remedial_note = text(c.remedial_note, 300) || null;
        } else {
          next.remedial_type = null; next.remedial_grade = null; next.remedial_date = null; next.remedial_note = null;
        }
      }
      stmts.push(env.DB.prepare(`INSERT INTO gr_results (course_id, student_id, hours_attended, special, special_note, remedial_type, remedial_grade, remedial_date, remedial_note, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(course_id, student_id) DO UPDATE SET hours_attended=excluded.hours_attended, special=excluded.special, special_note=excluded.special_note,
          remedial_type=excluded.remedial_type, remedial_grade=excluded.remedial_grade, remedial_date=excluded.remedial_date, remedial_note=excluded.remedial_note,
          updated_by=excluded.updated_by, updated_at=datetime('now')`)
        .bind(course.id, sid, next.hours_attended ?? null, next.special ?? null, next.special_note ?? null, next.remedial_type ?? null,
          next.remedial_grade ?? null, next.remedial_date ?? null, next.remedial_note ?? null, user.id));
    }
    await batchAll(env, stmts);
    await audit(env, user, "results.update", { course: course.id, changes });
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  // ---------- ยืนยันผล (ล็อก) ----------
  if (sub === "submit" && method === "POST") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const bundle = await courseBundle(env, course);
    if (!bundle.items.length) fail(400, "ยังไม่ได้ตั้งโครงสร้างคะแนน");
    const pending = bundle.roster.filter((s) => s.enrollment_status === "enrolled" &&bundle.computed[s.id].missing > 0 && !bundle.results[s.id]?.special);
    const b = await readJson(request);
    if (pending.length && !b.force) {
      return json({ error: `ยังมีนักเรียน ${pending.length} คนที่คะแนนไม่ครบ (จะได้ผล ร)`, needs_confirm: true, pending: pending.map((s) => studentName(s)) }, 409);
    }
    await env.DB.prepare("UPDATE gr_courses SET locked = 1, submitted_at = datetime('now'), submitted_by = ? WHERE id = ?").bind(user.id, course.id).run();
    await audit(env, user, "course.submit", { course: course.id, pending: pending.length });
    return json(serializeBundle(await courseBundle(env, await loadCourse(env, course.id)), user));
  }

  fail(404, "ไม่พบเส้นทาง API");
}

async function sameSubjectFamily(env, a, b) {
  return a.code === b.code && a.grade_level === b.grade_level;
}

export { getSettings };
