// หน้าผู้ปกครอง (/parent): ดู ปพ.6 ด้วยเลขประจำตัวนักเรียน + รหัสผ่าน = เลขบัตรประจำตัวประชาชน 8 ตัวท้าย ไม่ต้องเข้าสู่ระบบ
// - เปิดเฉพาะเมื่อผู้ดูแลเลือก "เผยแพร่ ปพ.6 ให้ผู้ปกครอง" ในเกณฑ์การวัดผลของปีการศึกษาปัจจุบัน
// - จำกัดการลอง: ผิด 5 ครั้งใน 15 นาทีต่อ IP → รอ 15 นาที (ตาราง auth_login_throttles เดียวกับหน้าเข้าสู่ระบบ)
// - ข้อความผิดพลาดเหมือนกันทุกกรณี ไม่บอกว่าเลขประจำตัวมีอยู่ในระบบหรือไม่
import { json, readJson, fail } from "../lib/http.js";
import { verifyTurnstile, TURNSTILE_ERROR } from "../lib/auth-sessions.js";
import { resolveYear, getSettings, isPrimaryGrade, inPilot, LEFT_STATUSES } from "../lib/data.js";
import { recordFailure } from "./auth.js";
import { roomReport } from "./reports.js";

const NOT_FOUND = "เลขประจำตัวนักเรียนหรือรหัสผ่านไม่ถูกต้อง";

export async function parentPp6(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `parent|${ip}`.slice(0, 500);
  const throttle = await env.DB.prepare("SELECT locked_until FROM auth_login_throttles WHERE throttle_key = ?").bind(key).first();
  if (throttle?.locked_until && new Date(`${throttle.locked_until.replace(" ", "T")}Z`).getTime() > Date.now()) {
    return json({ error: "กรอกข้อมูลผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่" }, 429, { "Retry-After": "900" });
  }

  const body = await readJson(request);
  const code = String(body.student_code || "").trim().slice(0, 30);
  const pin = String(body.password || "").replace(/\D/g, "");
  if (!code) fail(400, "กรุณากรอกเลขประจำตัวนักเรียน");
  if (pin.length !== 8) fail(400, "รหัสผ่านคือเลขบัตรประจำตัวประชาชนของนักเรียน 8 ตัวท้าย");
  if (!(await verifyTurnstile(env, body.turnstile_token, request)).ok) fail(400, TURNSTILE_ERROR);

  const year = await resolveYear(env, null);
  const settings = await getSettings(env, year.id);
  const term = Number(settings.parent_pp6_term);
  if (term !== 1 && term !== 2) return json({ error: "โรงเรียนยังไม่เปิดให้ตรวจสอบผลการเรียน" }, 403);

  const notFound = async () => { await recordFailure(env, key); return json({ error: NOT_FOUND }, 404); };
  const st = await env.DB.prepare(`SELECT id, national_id FROM students WHERE student_code = ? AND national_id IS NOT NULL LIMIT 1`).bind(code).first();
  const nid = String(st?.national_id || "").replace(/\D/g, "");
  if (!st || nid.length !== 13 || nid.slice(-8) !== pin) return notFound();
  // ห้องของนักเรียน ณ ภาคเรียนล่าสุดของปีปัจจุบัน
  const en = await env.DB.prepare(
    `SELECT se.grade_level, se.classroom, se.status FROM student_enrollments se JOIN academic_terms t ON t.id = se.academic_term_id
      WHERE t.academic_year_id = ? AND se.student_id = ? ORDER BY t.term_number DESC, se.id DESC LIMIT 1`
  ).bind(year.id, st.id).first();
  if (!en || !isPrimaryGrade(en.grade_level) || LEFT_STATUSES.includes(en.status) || !inPilot(settings.pilot_rooms, en.grade_level, en.classroom)) return notFound();

  const report = await roomReport(env, year, en.grade_level, en.classroom, st.id);
  if (!report.students.length) return notFound();
  return json({ term, report });
}
