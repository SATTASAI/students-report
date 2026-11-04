// เมนู "รายงานพฤติกรรม": เปิดระบบคะแนนพฤติกรรม (publicservice) โดยไม่ต้องล็อกอินซ้ำ
// ใช้กลไกเดียวกับระบบบริหารโรงเรียน (banpadeng-school-db src/routes/publicservice-sso.js):
// ออกรหัสใช้ครั้งเดียว อายุ 60 วินาที ใน publicservice_sso_codes (D1 ร่วม) → publicservice /sso แลกเป็น session ของตัวเอง
export const PUBLICSERVICE_URL = "https://publicservice.banpadengschool.ac.th";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ssoPublicservice(env, user) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!user || user.role === "viewer") return new Response(null, { status: 302, headers: { ...headers, Location: `${PUBLICSERVICE_URL}/` } });
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS publicservice_sso_codes (
    code_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, session_version INTEGER NOT NULL,
    expires_at INTEGER NOT NULL)`).run();
  const code = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM publicservice_sso_codes WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO publicservice_sso_codes (code_hash, user_id, session_version, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(code), user.id, Number(user.session_version ?? 1), now + 60),
  ]);
  return new Response(null, { status: 302, headers: { ...headers, Location: `${PUBLICSERVICE_URL}/sso?code=${code}` } });
}
