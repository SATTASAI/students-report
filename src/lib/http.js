import { AUTH_COOKIE_NAME, verifyJWT } from "./crypto.js";
import { sessionIsActive } from "./auth-sessions.js";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export const fail = (status, message) => { throw new HttpError(status, message); };

export async function readJson(request) {
  try { return await request.json(); } catch { fail(400, "รูปแบบข้อมูลไม่ถูกต้อง"); }
}

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const ADMIN_ROLES = ["superadmin", "executive"];

// อ่านผู้ใช้จาก token แล้วยืนยันกับตาราง users ทุกครั้ง (ระงับบัญชี/เปลี่ยนรหัสมีผลทันที)
export async function currentUser(request, env) {
  const token = parseCookies(request)[AUTH_COOKIE_NAME];
  if (!token || !env.JWT_SECRET) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload?.sub) return null;
  const base = `SELECT u.id, u.email, u.full_name, u.role, u.status, u.session_version, r.role AS grade_role%VIEWER%
       FROM users u LEFT JOIN gr_staff_roles r ON r.user_id = u.id
      WHERE u.id = ? AND u.deleted_at IS NULL`;
  let user;
  try {
    user = await env.DB.prepare(base.replace("%VIEWER%", `, v.user_id AS viewer_id, v.expires_at AS access_expires_at`)
      .replace("LEFT JOIN gr_staff_roles r ON r.user_id = u.id", "LEFT JOIN gr_staff_roles r ON r.user_id = u.id LEFT JOIN viewer_accounts v ON v.user_id = u.id")).bind(payload.sub).first();
  } catch (e) {
    // ตาราง viewer_accounts สร้างโดยระบบบริหารโรงเรียน — ถ้ายังไม่มี ไม่มีใครเป็นผู้ชมภายนอก
    if (!/viewer_accounts/.test(String(e?.message))) throw e;
    user = await env.DB.prepare(base.replace("%VIEWER%", "")).bind(payload.sub).first();
  }
  if (!user || user.status !== "active") return null;
  // ผู้ชมภายนอก (บัญชีในตาราง viewer_accounts, users.role = NULL): ดูรายงานภาพรวมได้อย่างเดียว ไม่เห็นชื่อนักเรียน
  if (user.viewer_id != null) {
    user.role = "viewer";
    user.grade_role = null;
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    if (user.access_expires_at && today > String(user.access_expires_at).slice(0, 10)) return null;
  }
  delete user.viewer_id;
  if (user.session_version != null && Number(payload.sv || 1) !== Number(user.session_version)) return null;
  // ออกจากระบบรายอุปกรณ์ (จัดการได้ที่หน้าบัญชีของระบบบริหารโรงเรียน): session ที่ถูกยกเลิกใช้ต่อไม่ได้
  if (!await sessionIsActive(env, payload)) return null;
  Object.defineProperty(user, "session_id", { value: payload.sid || null, enumerable: false });
  // is_admin = แก้ไขข้อมูลส่วนกลางได้ (ผู้ดูแลระบบ/ทีมวัดผล) — ผู้บริหารไม่มีสิทธิ์แก้ (16 ต.ค. 2569)
  // can_view_all = ดูได้ทุกรายวิชา/ทุกห้อง (รวมผู้บริหาร) · is_super = อนุมัติผลได้ (ผู้บริหาร/ผู้ดูแลระบบ)
  user.is_admin = user.role === "superadmin" || user.grade_role === "grade_admin";
  user.can_view_all = user.is_admin || user.role === "executive";
  user.is_super = ADMIN_ROLES.includes(user.role);
  // นำเข้าข้อมูลจำนวนมาก (Excel / คัดลอกปีก่อน / ดึงจากระบบบริหารฯ / คลังตัวชี้วัด): เฉพาะผู้ดูแลระบบและทีมวัดและประเมินผล
  user.can_import = user.role === "superadmin" || user.grade_role === "grade_admin";
  user.is_viewer = user.role === "viewer";
  return user;
}

// รายงานภาพรวม (สรุปผลสัมฤทธิ์ / ภาพรวมการส่งผล / SAR): ผู้บริหาร ฝ่ายวัดผล และผู้ชมภายนอก
export function requireReportViewer(user) {
  requireUser(user);
  if (!user.can_view_all && !user.is_viewer) fail(403, "เฉพาะผู้บริหารและผู้ดูแลงานวัดผล/วิชาการเท่านั้น");
  return user;
}

// ผู้ชมภายนอกเรียกได้เฉพาะ API เหล่านี้ (อ่านอย่างเดียว)
const VIEWER_ALLOWED = [/^\/api\/me$/, /^\/api\/reports\/(summary|progress)$/, /^\/api\/sar$/];
export function viewerMayAccess(method, pathname) {
  return (method === "GET" || method === "HEAD") && VIEWER_ALLOWED.some((r) => r.test(pathname));
}

export function requireUser(user) {
  if (!user) fail(401, "กรุณาเข้าสู่ระบบ");
  if (!user.role) fail(403, "บัญชียังไม่ได้รับการกำหนดสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ");
  return user;
}

export function requireAdmin(user) {
  requireUser(user);
  if (!user.is_admin) fail(403, "เฉพาะผู้ดูแลงานวัดผล/วิชาการเท่านั้น");
  return user;
}

export function requireViewer(user) {
  requireUser(user);
  if (!user.can_view_all) fail(403, "เฉพาะผู้บริหารและผู้ดูแลงานวัดผล/วิชาการเท่านั้น");
  return user;
}

export function requireImporter(user) {
  requireAdmin(user);
  if (!user.can_import) fail(403, "การนำเข้าข้อมูลทำได้เฉพาะผู้ดูแลระบบและทีมวัดและประเมินผล");
  return user;
}

export function intParam(value, label = "รหัส") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(400, `${label}ไม่ถูกต้อง`);
  return n;
}

export function text(value, max = 300) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

export async function audit(env, user, action, detail) {
  try {
    await env.DB.prepare("INSERT INTO gr_audit (user_id, action, detail) VALUES (?, ?, ?)")
      .bind(user?.id ?? null, action, typeof detail === "string" ? detail : JSON.stringify(detail ?? null)).run();
  } catch { /* บันทึกประวัติไม่สำเร็จไม่ควรทำให้งานหลักล้ม */ }
}

// batch ของ D1 = transaction เดียว: สำเร็จทั้งหมดหรือไม่บันทึกเลย
// ส่งเป็นชุดเดียวเสมอเมื่อไม่เกิน ATOMIC_MAX คำสั่ง (งานปกติทุกงานอยู่ในเกณฑ์นี้)
// เกินกว่านั้น (เช่น นำเข้าข้อมูลทั้งโรงเรียน) จึงแบ่งชุด — ชุดที่ล้มจะไม่บันทึก แต่ชุดก่อนหน้าบันทึกแล้ว
export const ATOMIC_MAX = 500;
export async function batchAll(env, statements, size = ATOMIC_MAX) {
  if (!statements.length) return [];
  if (statements.length <= ATOMIC_MAX) return env.DB.batch(statements);
  const out = [];
  for (let i = 0; i < statements.length; i += size) out.push(...await env.DB.batch(statements.slice(i, i + size)));
  return out;
}

// บันทึกแบบมีเงื่อนไข: guards = คำสั่ง SELECT ที่ "ต้องไม่คืนแถว" ถ้าคืนแถวแปลว่าข้อมูลเปลี่ยนไประหว่างทาง
// → ยกเลิกทั้งชุดใน transaction เดียวกัน แล้วตอบ 409 ด้วยข้อความที่กำหนด
export async function guardedBatch(env, guards, statements, message) {
  const all = [...guards.map(({ sql, values }) => env.DB.prepare(`INSERT INTO gr_guard (ok) SELECT 0 WHERE EXISTS (${sql})`).bind(...values)), ...statements];
  if (all.length > ATOMIC_MAX) fail(400, "ข้อมูลชุดนี้ใหญ่เกินไป กรุณาบันทึกทีละน้อยลง");
  try {
    return await env.DB.batch(all);
  } catch (err) {
    if (/gr_guard_tripped/.test(String(err?.message || err))) fail(409, message);
    throw err;
  }
}

// ตัวเลขจากผู้ใช้แบบเข้มงวด (ฝั่งเซิร์ฟเวอร์ต้องเข้มเท่าหน้าเว็บ):
// null/""/ช่องว่าง → null · ตัวเลข หรือข้อความแบบ 12 / 12.5 / 12,5 → number · อย่างอื่น (1e2, 0x5, true, [5], -1) → NaN
export function decimalOf(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : NaN;
  if (typeof v !== "string") return NaN;
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
