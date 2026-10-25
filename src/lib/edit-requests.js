// คำขอแก้ไข: เมื่อปิดการกรอก (entry_open = 0) หรือรายวิชาส่งผลแล้ว ครูต้องส่งคำขอถึงฝ่ายวัดผลก่อนแก้
// - รายวิชา: อนุมัติ = ส่งคืนรายวิชา (ถ้าส่งแล้ว) + ให้สิทธิ์แก้แม้ปิดการกรอก (gr_courses.edit_granted_at) จนกว่าครูจะส่งผลใหม่
// - ครูประจำชั้น: อนุมัติ = เปิดให้แก้ข้อมูลของห้อง (มาเรียน คุณลักษณะฯ กิจกรรม ความเห็น น้ำหนักส่วนสูง คะแนนยกมา) HOMEROOM_GRANT_DAYS วัน
import { fail } from "./http.js";
import { getSettings } from "./data.js";

export const HOMEROOM_GRANT_DAYS = 7;
const nowSql = () => new Date().toISOString().replace("T", " ").slice(0, 19); // รูปแบบเดียวกับ datetime('now')

// สถานะการแก้ข้อมูลครูประจำชั้นของห้อง: { open, why: 'open'|'admin'|'grant'|'closed', grant_until, pending }
export async function homeroomEditState(env, user, yearId, grade, room) {
  const settings = await getSettings(env, yearId);
  // ผู้บริหาร (ไม่ใช่ครูประจำชั้นห้องนี้) ดูได้อย่างเดียว
  if (!user.is_admin && user.can_view_all) {
    const own = await env.DB.prepare("SELECT 1 AS ok FROM gr_homerooms WHERE academic_year_id = ? AND grade_level = ? AND classroom = ? AND user_id = ?").bind(yearId, grade, room, user.id).first();
    if (!own) return { open: false, why: "viewer", entry_open: !!settings.entry_open, grant_until: null, pending: null };
  }
  const [grant, pending] = await Promise.all([
    env.DB.prepare(`SELECT open_until FROM gr_edit_requests WHERE academic_year_id = ? AND scope = 'homeroom' AND grade_level = ? AND classroom = ?
      AND status = 'approved' AND open_until > ? ORDER BY open_until DESC LIMIT 1`).bind(yearId, grade, room, nowSql()).first(),
    env.DB.prepare(`SELECT id, reason, requested_at FROM gr_edit_requests WHERE academic_year_id = ? AND scope = 'homeroom' AND grade_level = ? AND classroom = ?
      AND status = 'pending' ORDER BY id DESC LIMIT 1`).bind(yearId, grade, room).first(),
  ]);
  const why = settings.entry_open ? "open" : user.can_import ? "admin" : grant ? "grant" : "closed";
  return { open: why !== "closed", why, entry_open: !!settings.entry_open, grant_until: grant?.open_until || null, pending: pending || null };
}

export async function assertHomeroomWritable(env, user, yearId, grade, room) {
  const st = await homeroomEditState(env, user, yearId, grade, room);
  if (!st.open) fail(409, st.pending
    ? "ปิดการกรอกแล้ว — ส่งคำขอแก้ไขแล้ว รอฝ่ายวัดผลอนุมัติ"
    : "ปิดการกรอกแล้ว — ถ้าต้องการแก้ ให้ส่งคำขอแก้ไขถึงฝ่ายวัดผลก่อน");
  return st;
}

// ครูประจำชั้นแก้ข้อมูลที่ใช้คิดผลของรายวิชา (การมาเรียน → มส, คุณลักษณะฯ/อ่าน คิด เขียน/กิจกรรม → ปพ.5)
// รายวิชาของห้องที่อนุมัติแล้วกลับไปรอผู้บริหารอนุมัติใหม่ และบันทึกประวัติให้ครูผู้สอนเห็น
export async function reopenApprovedForRoom(env, user, yearId, grade, room, what) {
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM gr_courses c JOIN gr_subjects s ON s.id = c.subject_id
      WHERE s.academic_year_id = ? AND s.grade_level = ? AND c.classroom = ? AND c.approved_at IS NOT NULL`
  ).bind(yearId, grade, room).all();
  if (!results.length) return 0;
  await env.DB.batch(results.flatMap((c) => [
    env.DB.prepare("UPDATE gr_courses SET approved_at = NULL, approved_by = NULL WHERE id = ?").bind(c.id),
    env.DB.prepare("INSERT INTO gr_course_edits (course_id, user_id, what, detail) VALUES (?,?,?,?)").bind(c.id, user.id, what, "ครูประจำชั้นแก้หลังอนุมัติ — รอผู้บริหารอนุมัติใหม่"),
  ]));
  return results.length;
}

// ข้อมูลที่ใช้คิด มส (บันทึกการมาเรียน / ปฏิทินวันหยุด) ถูกแก้หลังรายวิชาส่งผลแล้ว:
// ผลเปลี่ยนตาม สถานะรายวิชาไม่เปลี่ยน แต่บันทึกประวัติไว้ให้ครูผู้สอนและฝ่ายวัดผลเห็นในหน้ารายวิชา (ผู้ใช้กำหนด 25 ต.ค. 2569)
// room = { grade, room } เฉพาะห้องนั้น หรือ null = ทุกรายวิชาของปี
export async function logLockedCourses(env, user, yearId, room, what, detail) {
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM gr_courses c JOIN gr_subjects s ON s.id = c.subject_id
      WHERE s.academic_year_id = ? AND c.locked = 1${room ? " AND s.grade_level = ? AND c.classroom = ?" : ""}`
  ).bind(yearId, ...(room ? [room.grade, room.room] : [])).all();
  if (!results.length) return 0;
  const stmts = results.map((c) => env.DB.prepare("INSERT INTO gr_course_edits (course_id, user_id, what, detail) VALUES (?,?,?,?)").bind(c.id, user.id, what, detail));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return results.length;
}

export { nowSql };
