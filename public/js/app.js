// ส่วนกลางของหน้าเว็บ: เรียก API, แถบบน, แจ้งเตือน, กล่องโต้ตอบ

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export class ApiError extends Error {
  constructor(status, data) { super(data?.error || `เกิดข้อผิดพลาด (${status})`); this.status = status; this.data = data; }
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง" });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ApiError(401, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export function params() { return new URLSearchParams(location.search); }

// ปีการศึกษาที่เลือก: ใช้ ?year= ก่อน แล้วค่อยใช้ค่าที่จำไว้
export function selectedYear() {
  const p = params().get("year");
  if (p) return p;
  try { return localStorage.getItem("sr-year") || ""; } catch { return ""; }
}
export function rememberYear(id) { try { localStorage.setItem("sr-year", String(id)); } catch { /* ไม่เป็นไร */ } }
export function withYear(path, yearId) {
  const u = new URL(path, location.origin);
  if (yearId) u.searchParams.set("year", yearId);
  return u.pathname + u.search;
}

let toastZone;
export function toast(message, kind = "") {
  toastZone ||= Object.assign(document.body.appendChild(document.createElement("div")), { className: "toast-zone", role: "status" });
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = message;
  toastZone.appendChild(t);
  while (toastZone.children.length > 2) toastZone.firstChild.remove();
  setTimeout(() => t.remove(), kind === "bad" ? 6000 : 2500);
}

export function showError(err) { toast(err?.message || String(err), "bad"); }

export const ICONS = {
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
};

export function gradeBadge(g) {
  if (g == null || g === "") return '<span class="grade gnone">–</span>';
  const cls = `g${String(g).replace(".", "")}`;
  return `<span class="grade ${esc(cls)}">${esc(g)}</span>`;
}

// แถบบนทุกหน้า (ยกเว้นหน้าเข้าสู่ระบบ/พิมพ์)
export async function shell(active) {
  const yearParam = selectedYear();
  let me;
  try {
    me = await api(`/api/me${yearParam ? `?year=${encodeURIComponent(yearParam)}` : ""}`);
  } catch (err) {
    if (err.status === 403) {
      document.body.innerHTML = `<main class="auth"><div class="auth-card"><h1>ยังใช้งานไม่ได้</h1><p>${esc(err.message)}</p><button class="btn" id="out">ออกจากระบบ</button></div></main>`;
      document.getElementById("out").onclick = logout;
    } else if (err.status === 404 && yearParam) {
      try { localStorage.removeItem("sr-year"); } catch { /* */ }
      location.href = location.pathname;
    } else if (err.status !== 401) {
      document.body.innerHTML = `<main class="auth"><div class="auth-card"><h1>เปิดระบบไม่ได้</h1><p>${esc(err.message)}</p><a class="btn" href="/">ลองอีกครั้ง</a></div></main>`;
    }
    throw err;
  }
  rememberYear(me.year.id);
  const nav = [
    ["home", "/", "งานของฉัน"],
    ...(me.user.is_admin ? [["admin", "/admin.html", "ตั้งค่ารายวิชา"], ["reports", "/reports.html", "รายงาน"]] : []),
  ];
  const bar = document.createElement("header");
  bar.className = "topbar";
  bar.innerHTML = `
    <a class="brand" href="/"><img src="/logo.jpg" alt=""><div><strong>รายงานผลการเรียน</strong><span>${esc(me.settings.school_name || "โรงเรียนบ้านป่าเด็ง")}</span></div></a>
    <nav class="topnav">${nav.map(([k, href, label]) => `<a href="${href}" ${k === active ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
    <div class="top-right">
      <label class="sr-only" for="yearSel" hidden>ปีการศึกษา</label>
      <select id="yearSel" aria-label="ปีการศึกษา">${me.years.map((y) => `<option value="${y.id}" ${y.id === me.year.id ? "selected" : ""}>ปีการศึกษา ${y.year_be}</option>`).join("")}</select>
      <span class="who">${esc(me.user.full_name)}</span>
      <button class="linkish" id="logoutBtn">ออกจากระบบ</button>
    </div>`;
  document.body.prepend(bar);
  bar.querySelector("#yearSel").onchange = (e) => {
    rememberYear(e.target.value);
    const u = new URL(location.href);
    u.searchParams.set("year", e.target.value);
    location.href = u.pathname === "/course.html" ? "/" : u.toString();
  };
  bar.querySelector("#logoutBtn").onclick = logout;
  return me;
}

export async function logout() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  location.href = "/login.html";
}

// กล่องยืนยัน/ฟอร์ม
export function dialog({ title, body, okText = "บันทึก", okClass = "primary", cancelText = "ยกเลิก", wide = false, onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    if (wide) d.style.width = "min(900px, calc(100% - 24px))";
    d.innerHTML = `<form method="dialog">
      <div class="dlg-head"><h2>${esc(title)}</h2><button class="x" value="cancel" aria-label="ปิด" formnovalidate>×</button></div>
      <div class="dlg-body">${body}</div>
      <div class="dlg-foot">${cancelText ? `<button class="btn" value="cancel" formnovalidate>${esc(cancelText)}</button>` : ""}${okText ? `<button class="btn ${okClass}" value="ok">${esc(okText)}</button>` : ""}</div>
    </form>`;
    document.body.appendChild(d);
    const form = d.querySelector("form");
    let result = null;
    form.addEventListener("submit", (e) => {
      if (e.submitter?.value === "ok") {
        const data = Object.fromEntries(new FormData(form));
        result = { ok: true, data, el: d };
      }
    });
    d.addEventListener("close", () => { resolve(result || { ok: false }); d.remove(); });
    onOpen?.(d);
    d.showModal();
  });
}

export function confirmBox(title, message, okText = "ยืนยัน", danger = false) {
  return dialog({ title, body: `<p>${message}</p>`, okText, okClass: danger ? "danger" : "primary" }).then((r) => r.ok);
}

export function fmt(n, digits = 2) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "–";
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const room = (g, r) => `${g}/${r}`;
