// ระบบรายงานผลการเรียน โรงเรียนบ้านป่าเด็ง (ป.1–ป.6)
// Worker เดียว + static assets; ใช้ D1 และบัญชีผู้ใช้ร่วมกับ banpadeng-school-db
import { json, HttpError, currentUser } from "./lib/http.js";
import { ensureSchema } from "./lib/schema.js";
import { login, logout } from "./routes/auth.js";
import { handleAdmin } from "./routes/admin.js";
import { handleCourses } from "./routes/courses.js";
import { handleHomeroom } from "./routes/homeroom.js";
import { handleReports, handleMe } from "./routes/reports.js";
import { handleActivities } from "./routes/activities.js";
import { handleMoves } from "./routes/moves.js";
import { handleRoster } from "./routes/roster.js";
import { handleCalendar } from "./routes/calendar.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

function withHeaders(response, extra = SECURITY_HEADERS) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

async function routeApi(request, env, url) {
  const method = request.method.toUpperCase();
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  // ป้องกัน CSRF: คำขอที่เปลี่ยนข้อมูลต้องมาจากเว็บไซต์ตัวเองเท่านั้น
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "คำขอไม่ได้มาจากหน้าเว็บของระบบ" }, 403);
  }

  if (parts[1] === "auth" && parts[2] === "login" && method === "POST") return login(request, env);
  if (parts[1] === "auth" && parts[2] === "logout" && method === "POST") return logout();

  const user = await currentUser(request, env);
  switch (parts[1]) {
    case "me": return handleMe(request, env, user, url);
    case "admin": return handleAdmin(request, env, user, parts, method, url);
    case "courses": return handleCourses(request, env, user, parts, method, url);
    case "homeroom": return handleHomeroom(request, env, user, parts, method, url);
    case "reports": return handleReports(request, env, user, parts, method, url);
    case "activities": return handleActivities(request, env, user, parts, method, url);
    case "moves": return handleMoves(request, env, user, parts, method, url);
    case "roster": return handleRoster(request, env, user, parts, method, url);
    case "calendar": return handleCalendar(request, env, user, parts, method, url);
    default: return json({ error: "ไม่พบเส้นทาง API" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const res = await env.ASSETS.fetch(request);
      return withHeaders(res);
    }
    // ตรวจความพร้อมของการติดตั้ง (ไม่เปิดเผยค่าลับ)
    if (url.pathname === "/api/health") {
      return json({ ok: !!env.JWT_SECRET && !!env.DB, jwt_secret_set: !!env.JWT_SECRET, database_bound: !!env.DB });
    }
    try {
      if (!env.JWT_SECRET) return json({ error: "ยังไม่ได้ตั้งค่า JWT_SECRET ของ Worker" }, 500);
      await ensureSchema(env);
      return withHeaders(await routeApi(request, env, url));
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      const msg = String(err?.message || err);
      console.error("API error", url.pathname, msg);
      if (/D1_ERROR.*(exceeded|limit)/i.test(msg)) return json({ error: "ฐานข้อมูลใช้งานหนักชั่วคราว กรุณาลองใหม่อีกครั้ง" }, 503);
      return json({ error: "เกิดข้อผิดพลาดภายในระบบ" }, 500);
    }
  },
};
