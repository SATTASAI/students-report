// ตรวจสอบการเข้าใช้งาน: ตาราง usage_daily ใช้ร่วมกับระบบบริหารโรงเรียน (banpadeng-school-db) ซึ่งเป็นผู้แสดงรายงาน
// เบราว์เซอร์ส่งสัญญาณทุก 60 วินาทีเฉพาะตอนหน้าจอเปิดอยู่ · เวลาใช้งาน = ผลรวมช่วงห่างระหว่างสัญญาณที่ต่อเนื่อง (≤ 120 วินาที)
import { json, readJson } from "../lib/http.js";

let ready = false;
async function ensureUsageSchema(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS usage_daily (
      user_id INTEGER NOT NULL, app TEXT NOT NULL, day TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0, pings INTEGER NOT NULL DEFAULT 0,
      first_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, app, day))`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_usage_daily_day ON usage_daily(day, app)"),
  ]);
  ready = true;
}

export async function handleActivity(request, env, user, parts, method) {
  if (parts[2] !== "ping" || method !== "POST") return json({ error: "ไม่พบเส้นทาง API" }, 404);
  if (!user) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const body = await readJson(request).catch(() => ({}));
  await ensureUsageSchema(env);
  const now = Math.floor(Date.now() / 1000);
  const day = new Date((now + 7 * 3600) * 1000).toISOString().slice(0, 10);
  await env.DB.prepare(`INSERT INTO usage_daily (user_id, app, day, seconds, pings, first_ts, last_ts, active)
      VALUES (?1, 'grades', ?2, 0, 1, ?3, ?3, ?4)
      ON CONFLICT(user_id, app, day) DO UPDATE SET
        seconds = seconds + CASE WHEN active = 1 AND ?3 - last_ts BETWEEN 0 AND 120 THEN ?3 - last_ts ELSE 0 END,
        pings = pings + 1, last_ts = ?3, active = ?4`)
    .bind(user.id, day, now, body?.end ? 0 : 1).run();
  return json({ ok: true });
}
