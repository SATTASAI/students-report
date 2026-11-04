// เข้าระบบคะแนนพฤติกรรม (publicservice) ต่อจากระบบนี้โดยไม่ต้องเข้าสู่ระบบใหม่
// ออกตั๋วอายุ 60 วินาที ใช้ได้ครั้งเดียว (publicservice เก็บ jti ไว้ใน ps_sso_tickets) แล้วส่งต่อไป /api/auth/sso
// ตั๋วมี purpose จึงใช้แทน cookie เข้าสู่ระบบไม่ได้ (sessionIsActive ปฏิเสธ)
import { signJWT } from "../lib/crypto.js";

export const PUBLICSERVICE_URL = "https://publicservice.banpadengschool.ac.th";

export async function ssoPublicservice(env, user) {
  let target = `${PUBLICSERVICE_URL}/`;
  if (user && user.role !== "viewer") {
    const jti = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const t = await signJWT({ sub: user.id, sv: Number(user.session_version || 1), purpose: "sso-publicservice", jti }, env.JWT_SECRET, 60);
    target = `${PUBLICSERVICE_URL}/api/auth/sso?t=${encodeURIComponent(t)}`;
  }
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
