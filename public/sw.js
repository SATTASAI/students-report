// Service worker ของระบบผลการเรียน: ทำให้ติดตั้งเป็นแอปได้ และเปิดหน้าได้เร็วขึ้น
// - ไฟล์หน้าเว็บ/สคริปต์/สไตล์: โหลดจากเครือข่ายก่อน (ได้ของใหม่เสมอ) ถ้าออฟไลน์ใช้ฉบับที่เก็บไว้
// - /api/* ไม่ผ่าน service worker เลย (ข้อมูลคะแนนและการเข้าสู่ระบบต้องสดจากเซิร์ฟเวอร์เท่านั้น)
const CACHE = "sr-shell-v1";
const PRECACHE = ["/css/app.css", "/js/app.js", "/js/mobile.js", "/logo.png", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const OFFLINE = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ออฟไลน์</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui,sans-serif;background:#f5f7fc;color:#1b2240;text-align:center;padding:24px}
b{display:block;font-size:20px;margin-bottom:6px;color:#1e2a78}button{margin-top:14px;font:inherit;border:0;border-radius:12px;padding:10px 20px;background:#1e2a78;color:#fff}</style></head>
<body><div><b>ไม่ได้เชื่อมต่ออินเทอร์เน็ต</b>ตรวจสอบสัญญาณแล้วลองอีกครั้ง<br><button onclick="location.reload()">ลองอีกครั้ง</button></div></body></html>`;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
      if (hit) return hit;
      if (req.mode === "navigate") return new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return Response.error();
    }
  })());
});
