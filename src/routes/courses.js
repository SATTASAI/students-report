import { json, readJson, fail, requireUser, intParam, text, audit, batchAll, decimalOf } from "../lib/http.js";
import { assertCourseAccess, courseBundle, loadCourse, canViewCourse, studentName } from "../lib/data.js";
import { computeStudentResult, resultWithAttendance, validateRemedial, structureIssues, indicatorWord, indicatorResult, submissionChecks } from "../../public/js/grading.js";
import { gradeSettings, getSettings, assessmentsFor } from "../lib/data.js";
import { ADMIN_ROLES } from "../lib/http.js";

const MAX_ITEMS_PER_COURSE = 80;

function serializeBundle(b, user) {
  return {
    course: { ...b.course, can_edit: (!b.course.locked && (b.settings.entry_open || user.is_admin)) || (b.course.locked && !!user.can_import), admin_edit: !!(b.course.locked && user.can_import) },
    edits: b.edits || [],
    can_approve: ADMIN_ROLES.includes(user.role),
    structure_issues: structureIssues(b.items, b.course.collect_ratio, indicatorWord(b.course.grade_level)),
    assessments: b.assessments || {},
    settings: b.settings,
    items: b.items,
    units: b.units,
    remedials: b.remedials,
    students: b.roster.map((s) => ({
      id: s.id, number: s.number, student_code: s.student_code, name: studentName(s),
      gender: s.gender || null, enrollment_status: s.enrollment_status, transfer_in_term: s.transfer_in_term || null,
    })),
    carry: b.carry || {},
    attendance: b.attendance || {},
    scores: b.scores,
    results: b.results,
    computed: b.computed,
    is_admin: user.is_admin,
  };
}

// ทศนิยมไม่เกิน 2 ตำแหน่ง (เก็บละเอียด 0.01 ตามสเปก — ไม่ปัดให้เอง)
const twoDecimals = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const MAX_UNITS_PER_COURSE = 40;

function cleanItem(raw, i = 0) {
  const term = Number(raw.term_number);
  if (![1, 2].includes(term)) fail(400, "ภาคเรียนต้องเป็น 1 หรือ 2");
  const kind = raw.kind === "final" ? "final" : "indicator";
  const title = text(raw.title, 500);
  if (!title) fail(400, `รายการที่ ${i + 1}: กรุณาระบุชื่อตัวชี้วัด/การสอบ`);
  const max = decimalOf(raw.max_score);
  if (max == null || !Number.isFinite(max) || max <= 0 || max > 1000) fail(400, `รายการที่ ${i + 1}: คะแนนเต็มต้องมากกว่า 0 และไม่เกิน 1000`);
  if (!twoDecimals(max)) fail(400, `รายการที่ ${i + 1}: คะแนนเต็มมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง`);
  const unit = raw.unit_id === "" || raw.unit_id == null ? null : Number(raw.unit_id);
  return { term, kind, code: text(raw.code, 60) || null, title, max: Math.round(max * 100) / 100, unit: kind === "final" ? null : unit };
}

// หน่วยต้องเป็นของรายวิชานี้และอยู่ภาคเดียวกับช่องคะแนน
async function checkUnits(env, courseId, list) {
  const ids = [...new Set(list.map((it) => it.unit).filter((u) => u != null))];
  if (!ids.length) return;
  const { results } = await env.DB.prepare(`SELECT id, term_number FROM gr_units WHERE course_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(courseId, ...ids).all();
  const term = Object.fromEntries(results.map((u) => [u.id, u.term_number]));
  for (const it of list) if (it.unit != null && term[it.unit] !== it.term) fail(400, "หน่วยการเรียนรู้ที่เลือกไม่อยู่ในภาคเรียนเดียวกัน");
}

function cleanUnit(raw) {
  const term = Number(raw.term_number);
  if (![1, 2].includes(term)) fail(400, "ภาคเรียนต้องเป็น 1 หรือ 2");
  const no = Number(raw.unit_no);
  if (!Number.isInteger(no) || no < 1 || no > 99) fail(400, "หน่วยที่ต้องเป็นเลข 1–99");
  const title = text(raw.title, 300);
  if (!title) fail(400, "กรุณาระบุชื่อหน่วยการเรียนรู้");
  const hours = raw.hours === "" || raw.hours == null ? null : Number(raw.hours);
  if (hours != null && (!Number.isFinite(hours) || hours < 0 || hours > 400)) fail(400, "ชั่วโมงต้องเป็น 0–400");
  return { term, no, title, hours, task: text(raw.task, 200) || null };
}

// สร้างหน่วย + ช่องคะแนนชุดใหม่ในรายวิชา (ใช้ทั้งคัดลอกจากห้องอื่นและใช้แม่แบบ)
// units: [{key, term_number, unit_no, title, hours}], items: [{term_number, kind, code, title, max_score, unit_key}]
async function insertStructure(env, courseId, units, items) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order),0) AS mx FROM gr_items WHERE course_id = ?").bind(courseId).first();
  if (count.n + items.length > MAX_ITEMS_PER_COURSE) fail(400, `รวมแล้วเกิน ${MAX_ITEMS_PER_COURSE} ช่อง`);
  const unitId = {};
  for (const u of units) {
    const r = await env.DB.prepare("INSERT INTO gr_units (course_id, term_number, unit_no, title, hours, task) VALUES (?,?,?,?,?,?)")
      .bind(courseId, u.term_number, u.unit_no, u.title, u.hours ?? null, u.task ?? null).run();
    unitId[u.key] = r.meta.last_row_id;
  }
  await batchAll(env, items.map((it, i) => env.DB.prepare(
    "INSERT INTO gr_items (course_id, term_number, kind, code, title, max_score, sort_order, unit_id) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(courseId, it.term_number, it.kind, it.code ?? null, it.title, it.max_score, count.mx + (i + 1) * 10, it.unit_key != null ? unitId[it.unit_key] ?? null : null)));
}

async function readStructure(env, courseId, terms = [1, 2]) {
  const ph = terms.map(() => "?").join(",");
  const [{ results: units }, { results: items }] = await Promise.all([
    env.DB.prepare(`SELECT id, term_number, unit_no, title, hours, task FROM gr_units WHERE course_id = ? AND term_number IN (${ph}) ORDER BY term_number, unit_no, id`).bind(courseId, ...terms).all(),
    env.DB.prepare(`SELECT term_number, kind, code, title, max_score, unit_id FROM gr_items WHERE course_id = ? AND term_number IN (${ph}) ORDER BY term_number, kind = 'final', sort_order, id`).bind(courseId, ...terms).all(),
  ]);
  return {
    units: units.map((u) => ({ key: u.id, term_number: u.term_number, unit_no: u.unit_no, title: u.title, hours: u.hours, task: u.task })),
    items: items.map((it) => ({ term_number: it.term_number, kind: it.kind, code: it.code, title: it.title, max_score: it.max_score, unit_key: it.unit_id })),
  };
}

// ฝ่ายวัดผลแก้รายวิชาที่ส่งแล้ว: บันทึกประวัติ (ครูเห็นในหน้ารายวิชา) และถ้าอนุมัติแล้วให้กลับไปรอผู้บริหารอนุมัติใหม่
const EDIT_WHAT = {
  scores: "แก้คะแนน", results: "แก้ผลพิเศษ/ผลแก้ตัว", items: "แก้โครงสร้างคะแนน", "items-order": "จัดลำดับช่องคะแนน",
  "copy-items": "คัดลอกโครงสร้างคะแนน", units: "แก้หน่วยการเรียนรู้", "apply-template": "ใช้แม่แบบโครงสร้าง",
};
export async function handleCourses(request, env, user, parts, method, url) {
  const copy = method !== "GET" ? request.clone() : null;
  const res = await handleCoursesInner(request, env, user, parts, method, url);
  const edit = user?._adminEdit;
  if (edit && method !== "GET" && res.status < 300) {
    const what = EDIT_WHAT[parts[3]] || "แก้ไขข้อมูลรายวิชา";
    let detail = null;
    try { const b = await copy.json(); detail = Array.isArray(b?.changes) ? `${b.changes.length} รายการ` : null; } catch {}
    await env.DB.batch([
      env.DB.prepare("INSERT INTO gr_course_edits (course_id, user_id, what, detail) VALUES (?,?,?,?)").bind(edit.course_id, user.id, what, detail),
      ...(edit.approved ? [env.DB.prepare("UPDATE gr_courses SET approved_at = NULL, approved_by = NULL WHERE id = ?").bind(edit.course_id)] : []),
    ]);
    await audit(env, user, "course.admin_edit", { course: edit.course_id, what, detail, reapprove: edit.approved });
  }
  return res;
}

async function handleCoursesInner(request, env, user, parts, method, url) {
  requireUser(user);
  const id = intParam(parts[2]);
  const sub = parts[3];

  if (!sub && method === "GET") {
    const course = await assertCourseAccess(env, user, id);
    const bundle = await courseBundle(env, course);
    bundle.assessments = await assessmentsFor(env, course.academic_year_id, bundle.roster.map((s) => s.id));
    return json(serializeBundle(bundle, user));
  }

  // ---------- โครงสร้างคะแนน ----------
  if (sub === "items" && method === "POST") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const b = await readJson(request);
    const list = (Array.isArray(b.items) ? b.items : [b]).map(cleanItem);
    if (!list.length) fail(400, "ไม่มีรายการให้เพิ่ม");
    await checkUnits(env, course.id, list);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order),0) AS mx FROM gr_items WHERE course_id = ?").bind(course.id).first();
    if (count.n + list.length > MAX_ITEMS_PER_COURSE) fail(400, `รายวิชาหนึ่งมีช่องคะแนนได้ไม่เกิน ${MAX_ITEMS_PER_COURSE} ช่อง`);
    await batchAll(env, list.map((it, i) => env.DB.prepare(
      "INSERT INTO gr_items (course_id, term_number, kind, code, title, max_score, sort_order, unit_id) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(course.id, it.term, it.kind, it.code, it.title, it.max, count.mx + (i + 1) * 10, it.unit)));
    await audit(env, user, "items.add", { course: course.id, count: list.length });
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  if (sub === "items" && parts[4] && method === "PUT") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const itemId = intParam(parts[4]);
    const existing = await env.DB.prepare("SELECT * FROM gr_items WHERE id = ? AND course_id = ?").bind(itemId, course.id).first();
    if (!existing) fail(404, "ไม่พบช่องคะแนน");
    const it = cleanItem(await readJson(request));
    await checkUnits(env, course.id, [it]);
    if (it.term !== existing.term_number) {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores WHERE item_id = ?").bind(itemId).first();
      if (n.n > 0) fail(409, "ย้ายภาคเรียนไม่ได้ เพราะช่องนี้มีคะแนนแล้ว");
    }
    if (it.max < existing.max_score) {
      const over = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores WHERE item_id = ? AND score > ?").bind(itemId, it.max).first();
      if (over.n > 0) fail(409, `ลดคะแนนเต็มไม่ได้ — มีนักเรียน ${over.n} คนได้คะแนนเกิน ${it.max} แล้ว`);
      const remOver = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_scores WHERE item_id = ? AND remedial > ?").bind(itemId, it.max).first();
      if (remOver.n > 0) fail(409, `ลดคะแนนเต็มไม่ได้ — มีนักเรียน ${remOver.n} คนได้คะแนนแก้ตัวเกิน ${it.max} แล้ว`);
    }
    await env.DB.prepare("UPDATE gr_items SET term_number=?, kind=?, code=?, title=?, max_score=?, unit_id=? WHERE id=?")
      .bind(it.term, it.kind, it.code, it.title, it.max, it.unit, itemId).run();
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
    const src = await readStructure(env, source.id, terms);
    if (!src.items.length) fail(400, "รายวิชาต้นทางยังไม่มีโครงสร้างคะแนน");
    await insertStructure(env, course.id, src.units, src.items);
    const srcItems = src.items;
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


  // ---------- หน่วยการเรียนรู้ ----------
  if (sub === "units" && method === "POST") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const u = cleanUnit(await readJson(request));
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_units WHERE course_id = ?").bind(course.id).first();
    if (n.n >= MAX_UNITS_PER_COURSE) fail(400, `รายวิชาหนึ่งมีหน่วยได้ไม่เกิน ${MAX_UNITS_PER_COURSE} หน่วย`);
    await env.DB.prepare("INSERT INTO gr_units (course_id, term_number, unit_no, title, hours, task) VALUES (?,?,?,?,?,?)").bind(course.id, u.term, u.no, u.title, u.hours, u.task).run();
    await audit(env, user, "unit.add", { course: course.id, ...u });
    return json(serializeBundle(await courseBundle(env, course), user));
  }
  if (sub === "units" && parts[4] && (method === "PUT" || method === "DELETE")) {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const unitId = intParam(parts[4]);
    const existing = await env.DB.prepare("SELECT * FROM gr_units WHERE id = ? AND course_id = ?").bind(unitId, course.id).first();
    if (!existing) fail(404, "ไม่พบหน่วยการเรียนรู้");
    if (method === "PUT") {
      const u = cleanUnit(await readJson(request));
      if (u.term !== existing.term_number) {
        const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM gr_items WHERE unit_id = ?").bind(unitId).first();
        if (used.n > 0) fail(409, "ย้ายภาคไม่ได้ เพราะหน่วยนี้มีช่องคะแนนอยู่");
      }
      await env.DB.prepare("UPDATE gr_units SET term_number=?, unit_no=?, title=?, hours=?, task=? WHERE id=?").bind(u.term, u.no, u.title, u.hours, u.task, unitId).run();
      await audit(env, user, "unit.update", { course: course.id, unitId, before: existing, after: u });
    } else {
      // ลบหน่วย: ช่องคะแนนและคะแนนยังอยู่ แค่ไม่สังกัดหน่วย
      await env.DB.batch([
        env.DB.prepare("UPDATE gr_items SET unit_id = NULL WHERE unit_id = ? AND course_id = ?").bind(unitId, course.id),
        env.DB.prepare("DELETE FROM gr_units WHERE id = ?").bind(unitId),
      ]);
      await audit(env, user, "unit.delete", { course: course.id, unit: existing });
    }
    return json(serializeBundle(await courseBundle(env, course), user));
  }

  // ---------- แม่แบบโครงสร้างของวิชา (ต่อชั้น × วิชา) ----------
  // ฝ่ายวิชาการ/ทีมวัดผลบันทึกโครงสร้างของรายวิชานี้เป็นแม่แบบ ครูทุกห้องของวิชาเดียวกันกดใช้ได้
  if (sub === "template" && method === "PUT") {
    if (!user.is_admin) fail(403, "บันทึกแม่แบบได้เฉพาะฝ่ายวิชาการ/ทีมวัดผล");
    const course = await loadCourse(env, id);
    const st = await readStructure(env, course.id);
    if (!st.items.length) fail(400, "รายวิชานี้ยังไม่มีโครงสร้างให้บันทึกเป็นแม่แบบ");
    await env.DB.prepare("UPDATE gr_subjects SET template = ?, template_updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(st), course.subject_id).run();
    await audit(env, user, "template.save", { subject: course.subject_id, from_course: course.id, units: st.units.length, items: st.items.length });
    return json(serializeBundle(await courseBundle(env, await loadCourse(env, id)), user));
  }
  if (sub === "template" && method === "DELETE") {
    if (!user.is_admin) fail(403, "ลบแม่แบบได้เฉพาะฝ่ายวิชาการ/ทีมวัดผล");
    const course = await loadCourse(env, id);
    await env.DB.prepare("UPDATE gr_subjects SET template = NULL, template_updated_at = NULL WHERE id = ?").bind(course.subject_id).run();
    await audit(env, user, "template.delete", { subject: course.subject_id });
    return json(serializeBundle(await courseBundle(env, await loadCourse(env, id)), user));
  }
  if (sub === "template" && method === "GET") {
    const course = await assertCourseAccess(env, user, id);
    const row = await env.DB.prepare("SELECT template, template_updated_at FROM gr_subjects WHERE id = ?").bind(course.subject_id).first();
    return json({ template: row?.template ? JSON.parse(row.template) : null, updated_at: row?.template_updated_at || null });
  }
  if (sub === "apply-template" && method === "POST") {
    const course = await assertCourseAccess(env, user, id, { write: true });
    const b = await readJson(request);
    const row = await env.DB.prepare("SELECT template FROM gr_subjects WHERE id = ?").bind(course.subject_id).first();
    if (!row?.template) fail(404, "วิชานี้ยังไม่มีแม่แบบจากฝ่ายวิชาการ");
    const tpl = JSON.parse(row.template);
    const terms = Array.isArray(b.terms) && b.terms.length ? b.terms.map(Number).filter((t) => [1, 2].includes(t)) : [1, 2];
    const units = tpl.units.filter((u) => terms.includes(u.term_number));
    const items = tpl.items.filter((it) => terms.includes(it.term_number));
    if (!items.length) fail(400, `แม่แบบไม่มีโครงสร้างของภาคเรียนที่ ${terms.join(", ")}`);
    const have = await env.DB.prepare(`SELECT COUNT(*) AS n FROM gr_items WHERE course_id = ? AND term_number IN (${terms.map(() => "?").join(",")})`).bind(course.id, ...terms).first();
    if (have.n > 0) fail(409, "ภาคเรียนนี้มีช่องคะแนนอยู่แล้ว ลบของเดิมก่อนใช้แม่แบบ (กันช่องคะแนนซ้ำ)");
    await insertStructure(env, course.id, units, items);
    await audit(env, user, "template.apply", { course: course.id, terms, units: units.length, items: items.length });
    return json(serializeBundle(await courseBundle(env, course), user));
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
    const rawAfter = (sid, itemId) => { // คะแนนเดิมหลังรวมการแก้ในชุดนี้
      const inBatch = changes.find((x) => "score" in x && Number(x.item_id) === itemId && Number(x.student_id) === sid);
      if (inBatch) return decimalOf(inBatch.score);
      return bundle.scores[sid]?.[itemId] ?? null;
    };
    const num = (v, item, label) => {
      const n = decimalOf(v);
      if (n == null || !Number.isFinite(n)) return `${label}ต้องเป็นตัวเลขไม่ติดลบ`;
      if (n > item.max_score + 1e-9) return `${label}เกินคะแนนเต็ม ${item.max_score}`;
      if (!twoDecimals(n)) return `${label}มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง`;
      return null;
    };
    for (const [i, c] of changes.entries()) {
      const item = items[c.item_id];
      const sid = Number(c.student_id);
      if (!item) { errors.push({ index: i, error: "ไม่พบช่องคะแนน" }); continue; }
      if (!students.has(sid)) { errors.push({ index: i, error: "นักเรียนไม่อยู่ในรายวิชานี้" }); continue; }
      const where = { index: i, item_id: c.item_id, student_id: c.student_id };
      if ("score" in c) {
        let score = decimalOf(c.score);
        if (score !== null) {
          const err = num(c.score, item, "คะแนน");
          if (err) { errors.push({ ...where, error: err }); continue; }
          score = Math.round(score * 100) / 100;
        }
        // ลบคะแนนเดิม: ถ้ามีคะแนนแก้ตัวอยู่ เก็บแถวไว้ (score = NULL) เพื่อไม่ให้คะแนนแก้ตัวหายตาม
        if (score == null) stmts.push(
          env.DB.prepare("UPDATE gr_scores SET score = NULL, updated_by = ?, updated_at = datetime('now') WHERE item_id = ? AND student_id = ?").bind(user.id, item.id, sid),
          env.DB.prepare("DELETE FROM gr_scores WHERE item_id = ? AND student_id = ? AND score IS NULL AND remedial IS NULL").bind(item.id, sid));
        else stmts.push(env.DB.prepare(`INSERT INTO gr_scores (item_id, student_id, score, updated_by, updated_at) VALUES (?,?,?,?,datetime('now'))
              ON CONFLICT(item_id, student_id) DO UPDATE SET score = excluded.score, updated_by = excluded.updated_by, updated_at = datetime('now')`)
            .bind(item.id, sid, score, user.id));
      }
      if ("remedial" in c) {
        // คะแนนแก้ตัว: เฉพาะตัวชี้วัดที่คะแนนเดิมไม่ผ่าน, เก็บคะแนนจริง นับได้ไม่เกินเกณฑ์ผ่าน
        const rem = decimalOf(c.remedial);
        if (rem != null) {
          if (item.kind !== "indicator") { errors.push({ ...where, error: "บันทึกแก้ตัวได้เฉพาะคะแนนระหว่างภาค" }); continue; }
          const raw = rawAfter(sid, item.id);
          if (raw == null) { errors.push({ ...where, error: "ต้องมีคะแนนเดิมก่อนบันทึกแก้ตัว" }); continue; }
          if (indicatorResult(item, raw, bundle.settings) !== "มผ") { errors.push({ ...where, error: "คะแนนเดิมผ่านแล้ว ไม่ต้องแก้ตัว" }); continue; }
          const err = num(c.remedial, item, "คะแนนแก้ตัว");
          if (err) { errors.push({ ...where, error: err }); continue; }
        }
        stmts.push(env.DB.prepare("UPDATE gr_scores SET remedial = ?, updated_by = ?, updated_at = datetime('now') WHERE item_id = ? AND student_id = ?")
          .bind(rem == null ? null : Math.round(rem * 100) / 100, user.id, item.id, sid));
      }
    }
    if (errors.length) return json({ error: "มีคะแนนที่ไม่ถูกต้อง ระบบยังไม่ได้บันทึกชุดนี้", errors }, 400);
    await batchAll(env, stmts);
    if (changes.some((c) => "remedial" in c)) {
      await audit(env, user, "scores.remedial", { course: course.id, changes: changes.filter((c) => "remedial" in c) });
      return json(serializeBundle(await courseBundle(env, course), user));
    }
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
          const h = decimalOf(c.hours_attended);
          if (h == null || !Number.isFinite(h) || h > course.hours_per_year) fail(400, `เวลาเรียนต้องอยู่ระหว่าง 0–${course.hours_per_year} ชั่วโมง`);
          if (!twoDecimals(h)) fail(400, "เวลาเรียนมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
          next.hours_attended = h; // เก็บตามที่กรอก ไม่ปัด (ปัดขึ้นอาจทำให้ มส กลายเป็นมีสิทธิ์)
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
          const original = computeStudentResult(bundle.items, bundle.scores[sid] || {}, resultWithAttendance({ ...next, remedial_grade: null }, bundle.attendance?.[sid]?.rate, bundle.course.hours_per_year), { ...settings, finalized: true }, bundle.remedials[sid] || {}, bundle.carry?.[sid]).original_grade;
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
    const issues = structureIssues(bundle.items, course.collect_ratio, indicatorWord(course.grade_level));
    if (issues.length) return json({ error: `ยืนยันผลไม่ได้: ${issues.join(" และ ")}`, structure_issues: issues }, 400);
    const b = await readJson(request);
    // ผลการเรียนคิดจาก 2 ภาค: ภาคที่ยังไม่มีช่องคะแนนและนักเรียนไม่มีคะแนนยกมา → ส่งแล้วเกรดจะยังเป็น "-" (เช่น ห้องนำร่องที่ภาค 1 อยู่ใน Q-Info)
    // ไม่บล็อก แต่ให้ครูเห็นและยืนยันเอง
    const active = bundle.roster.filter((s) => s.enrollment_status === "enrolled");
    const missingTerms = [1, 2].filter((t) => !bundle.items.some((i) => Number(i.term_number) === t))
      .map((t) => ({ term: t, students: active.filter((s) => !(bundle.carry?.[s.id]?.[t]?.total != null)).length }))
      .filter((x) => x.students > 0);
    // ตรวจก่อนส่ง: ครูต้องเห็นและยืนยันเอง (ไม่บล็อก ยกเว้นโครงสร้างไม่ตรงสัดส่วน)
    const checks = submissionChecks(bundle.roster.map((s) => ({ id: s.id, name: studentName(s), enrollment_status: s.enrollment_status })), bundle.computed);
    const pending = checks.blanks.filter((x) => !bundle.results[x.id]?.special);
    const warn = pending.length + checks.decimals.length + checks.borderline.length + checks.ms.length + missingTerms.length;
    if (warn && !b.force) {
      return json({ error: "ตรวจพบรายการที่ควรดูก่อนส่ง", needs_confirm: true, checks: { ...checks, missing_terms: missingTerms }, pending: pending.map((x) => x.name) }, 409);
    }
    await env.DB.prepare("UPDATE gr_courses SET locked = 1, submitted_at = datetime('now'), submitted_by = ?, approved_at = NULL, approved_by = NULL, reviewed_at = NULL, reviewed_by = NULL WHERE id = ?").bind(user.id, course.id).run();
    await audit(env, user, "course.submit", { course: course.id, blanks: pending.length, decimals: checks.decimals.length, borderline: checks.borderline.length, ms: checks.ms.length });
    return json(serializeBundle(await courseBundle(env, await loadCourse(env, course.id)), user));
  }

  fail(404, "ไม่พบเส้นทาง API");
}

async function sameSubjectFamily(env, a, b) {
  return a.code === b.code && a.grade_level === b.grade_level;
}

export { getSettings };
