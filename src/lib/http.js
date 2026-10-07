import { AUTH_COOKIE_NAME, verifyJWT } from "./crypto.js";

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
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.full_name, u.role, u.status, u.session_version, r.role AS grade_role
       FROM users u LEFT JOIN gr_staff_roles r ON r.user_id = u.id
      WHERE u.id = ? AND u.deleted_at IS NULL`
  ).bind(payload.sub).first();
  if (!user || user.status !== "active") return null;
  if (user.session_version != null && Number(payload.sv || 1) !== Number(user.session_version)) return null;
  user.is_admin = ADMIN_ROLES.includes(user.role) || user.grade_role === "grade_admin";
  user.is_super = ADMIN_ROLES.includes(user.role);
  // นำเข้าข้อมูลจำนวนมาก (Excel / คัดลอกปีก่อน / ดึงจากระบบบริหารฯ / คลังตัวชี้วัด): เฉพาะผู้ดูแลระบบและทีมวัดและประเมินผล
  user.can_import = user.role === "superadmin" || user.grade_role === "grade_admin";
  return user;
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

// D1 จำกัดจำนวนคำสั่งต่อ batch — แบ่งเป็นชุด
export async function batchAll(env, statements, size = 90) {
  for (let i = 0; i < statements.length; i += size) await env.DB.batch(statements.slice(i, i + size));
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
