// กิจกรรมพัฒนาผู้เรียน (ปพ.5.1) — หน้าเดียวสำหรับครูประจำชั้นและฝ่ายวิชาการ บันทึกครบ 4 กิจกรรม
// ค่าเริ่มต้นผ่าน: เก็บเฉพาะ "มผ" ในช่อง act_xxx_t (เวลาเรียน) / act_xxx_o (จุดประสงค์) ของ gr_assessments
// ปพ.6 / ปพ.5 / ปพ.1 อ่านจากตารางเดียวกันนี้
import { json, readJson, fail, requireUser, text, audit, batchAll } from "../lib/http.js";
import { resolveYear, roomRoster, listRooms, getSettings, assessmentsFor, studentName, isPrimaryGrade } from "../lib/data.js";
import { ASSESSMENT_GROUPS, ACTIVITY_PARTS } from "../../public/js/grading.js";

const GROUP = ASSESSMENT_GROUPS.find((g) => g.type === "activity");
const KEYS = GROUP.items.flatMap(([k]) => ACTIVITY_PARTS.map(([p]) => `${k}_${p}`));

// ห้องที่ผู้ใช้บันทึกได้: ฝ่ายวิชาการ/ทีมวัดผล = ทุกห้อง (เฉพาะห้องนำร่องถ้าตั้งไว้), ครูประจำชั้น = ห้องของตน
async function editableRooms(env, user, year) {
  if (user.can_import) {
    const settings = await getSettings(env, year.id);
    return (await listRooms(env, year.id)).filter((r) => isPrimaryGrade(r.grade_level))
      .map((r) => ({ grade_level: r.grade_level, classroom: r.classroom, students: r.students }))
      .filter((r) => !settings.pilot_rooms || settings.pilot_rooms.includes(`${r.grade_level}/${r.classroom}`));
  }
  const { results } = await env.DB.prepare(
    "SELECT grade_level, classroom FROM gr_homerooms WHERE academic_year_id = ? AND user_id = ? ORDER BY grade_level, classroom"
  ).bind(year.id, user.id).all();
  return results;
}

export async function handleActivities(request, env, user, parts, method, url) {
  requireUser(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  const rooms = await editableRooms(env, user, year);
  const pick = async (grade, room) => {
    grade = text(grade, 10); room = text(room, 10);
    if (!isPrimaryGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
    if (!rooms.some((r) => r.grade_level === grade && r.classroom === room)) fail(403, "บันทึกได้เฉพาะห้องที่เป็นครูประจำชั้น หรือฝ่ายวิชาการ");
    return { grade, room, roster: await roomRoster(env, year.id, grade, room) };
  };

  if (method === "GET") {
    const out = { year, rooms, activities: GROUP.items.map(([key, label]) => ({ key, label })), parts: ACTIVITY_PARTS.map(([key, label]) => ({ key, label })) };
    if (!url.searchParams.get("grade")) return json(out);
    const { grade, room, roster } = await pick(url.searchParams.get("grade"), url.searchParams.get("room"));
    const ass = await assessmentsFor(env, year.id, roster.map((s) => s.id));
    return json({ ...out, grade, room, students: roster.map((s) => ({
      id: s.id, number: s.number, name: studentName(s), enrollment_status: s.enrollment_status,
      values: Object.fromEntries(KEYS.filter((k) => ass[s.id]?.[k]).map((k) => [k, ass[s.id][k]])),
    })) });
  }

  if (method === "PUT") {
    const b = await readJson(request);
    const { grade, room, roster } = await pick(b.grade, b.room);
    const ids = new Set(roster.map((s) => s.id));
    const changes = Array.isArray(b.changes) ? b.changes.slice(0, 3000) : [];
    const stmts = [];
    for (const c of changes) {
      const sid = Number(c.student_id);
      if (!ids.has(sid)) fail(400, "นักเรียนไม่อยู่ในห้องนี้");
      if (!KEYS.includes(c.item_key)) fail(400, "หัวข้อกิจกรรมไม่ถูกต้อง");
      if (c.value && c.value !== "มผ") fail(400, "บันทึกได้เฉพาะ มผ (ค่าเริ่มต้นคือผ่าน)");
      stmts.push(c.value
        ? env.DB.prepare(`INSERT INTO gr_assessments (academic_year_id, student_id, item_key, value, updated_by, updated_at) VALUES (?,?,?,?,?,datetime('now'))
            ON CONFLICT(academic_year_id, student_id, item_key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(year.id, sid, c.item_key, "มผ", user.id)
        : env.DB.prepare("DELETE FROM gr_assessments WHERE academic_year_id = ? AND student_id = ? AND item_key = ?").bind(year.id, sid, c.item_key));
    }
    await batchAll(env, stmts);
    await audit(env, user, "activity.update", { grade, room, changes: changes.length });
    return json({ ok: true, saved: stmts.length });
  }
  fail(405, "ไม่รองรับ");
}
