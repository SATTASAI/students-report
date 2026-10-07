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

// ---------- บทบาทและเมนู (แบบ Q-Info: ผู้ใช้หนึ่งคนสลับบทบาทได้) ----------
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const MI = {
  home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  book: I('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>'),
  room: I('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 4a3 3 0 0 1 0 6M21 20c0-2-1-4-3-4.5"/>'),
  chart: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  flag: I('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
  list: I('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  upload: I('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  people: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  bank: I('<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  check: I('<path d="M20 6L9 17l-5-5"/>'),
  doc: I('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
  key: I('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  out: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
};

export const ROLES = {
  teacher: { label: "ครูผู้สอน / ครูประจำชั้น", short: "ครู" },
  measure: { label: "เจ้าหน้าที่วัดผล", short: "วัดผล" },
  exec: { label: "ผู้บริหาร", short: "ผู้บริหาร" },
  admin: { label: "ผู้ดูแลระบบ", short: "ผู้ดูแล" },
};

// บทบาทที่ผู้ใช้เข้าได้ — ผู้ดูแลระบบ (superadmin) เข้าได้ทุกบทบาท
export function availableRoles(user) {
  const out = ["teacher"];
  if (user.role === "superadmin" || user.grade_role === "grade_admin") out.push("measure");
  if (user.role === "superadmin" || user.role === "executive") out.push("exec");
  if (user.role === "superadmin") out.push("admin");
  return out;
}

function roleMenu(role, me) {
  if (role === "teacher") return [
    { href: "/", icon: "book", label: "รายวิชาที่สอน" },
    ...me.homerooms.map((h) => ({ href: `/homeroom.html?grade=${encodeURIComponent(h.grade_level)}&room=${encodeURIComponent(h.classroom)}`, icon: "room", label: `ประจำชั้น ${h.grade_level}/${h.classroom}` })),
    ...(me.homerooms.length ? [{ href: "/activities.html", icon: "check", label: "กิจกรรมพัฒนาผู้เรียน" }] : []),
    { href: "/docs.html", icon: "doc", label: "คลังเอกสาร" },
  ];
  if (role === "measure") return [
    { href: "/reports.html#progress", icon: "chart", label: "ติดตามการส่งผล" },
    { href: "/admin.html#start", icon: "flag", label: "เริ่มต้นปีการศึกษา" },
    { href: "/admin.html#subjects", icon: "list", label: "รายวิชา" },
    { href: "/admin.html#import", icon: "upload", label: "นำเข้าจาก Excel" },
    { href: "/admin.html#review", icon: "check", label: "ตรวจผลการเรียน" },
    { href: "/admin.html#courses", icon: "people", label: "ครูผู้สอน / ส่งคืน" },
    { href: "/admin.html#homerooms", icon: "room", label: "ครูประจำชั้น" },
    { href: "/admin.html#students", icon: "people", label: "รายชื่อนักเรียน" },
    { href: "/admin.html#calendar", icon: "clock", label: "ปฏิทินวันหยุด" },
    { href: "/admin.html#moves", icon: "people", label: "นักเรียนย้ายเข้า/ย้ายออก" },
    { href: "/activities.html", icon: "check", label: "กิจกรรมพัฒนาผู้เรียน" },
    { href: "/admin.html#bank", icon: "bank", label: "คลังตัวชี้วัด" },
    { href: "/admin.html#settings", icon: "gear", label: "เกณฑ์และผู้ลงนาม" },
    { href: "/reports.html#summary", icon: "chart", label: "สรุปผลสัมฤทธิ์" },
    { href: "/docs.html", icon: "doc", label: "คลังเอกสาร" },
  ];
  if (role === "exec") return [
    { href: "/reports.html#progress", icon: "chart", label: "ภาพรวมการส่งผล" },
    { href: "/admin.html#approve", icon: "check", label: "อนุมัติผลการเรียน" },
    { href: "/reports.html#summary", icon: "chart", label: "สรุปผลสัมฤทธิ์" },
    { href: "/docs.html", icon: "doc", label: "คลังเอกสาร" },
  ];
  return [
    { href: "/admin.html#start", icon: "flag", label: "ห้องที่เปิดใช้ระบบ" },
    { href: "/admin.html#people", icon: "key", label: "สิทธิ์ทีมวัดผล" },
    { href: "/admin.html#settings", icon: "gear", label: "เกณฑ์และผู้ลงนาม" },
    { href: "/admin.html#audit", icon: "clock", label: "ประวัติการใช้งาน" },
    { href: "/docs.html", icon: "doc", label: "คลังเอกสาร" },
  ];
}

const here = () => location.pathname + (location.hash || "");
const sameItem = (href) => {
  const [path, hash = ""] = href.split("#");
  if (path !== location.pathname) return false;
  if (href.includes("?")) { // ทุกพารามิเตอร์ของเมนูต้องตรง (ไม่สน year)
    const want = new URLSearchParams(href.split("?")[1].split("#")[0]), cur = new URLSearchParams(location.search);
    return [...want].every(([k, v]) => cur.get(k) === v);
  }
  return hash ? location.hash === `#${hash}` : true;
};

// โครงหน้าทุกหน้า: เมนูซ้าย (มือถือ/แท็บเล็ตเป็นลิ้นชัก) + สลับบทบาท + ปีการศึกษา
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
  const roles = availableRoles(me.user);
  let role;
  try { role = localStorage.getItem("sr-role"); } catch { /* */ }
  if (!roles.includes(role)) role = roles.includes("measure") && !me.courses.length ? "measure" : roles.includes("exec") && !me.courses.length ? "exec" : "teacher";
  const samePath = (href) => href.split(/[?#]/)[0] === location.pathname;
  if (location.pathname === "/" && role !== "teacher") {
    // หน้าแรกเป็นของบทบาทครู — บทบาทอื่นไปหน้าแรกของบทบาทตัวเอง
    location.replace(roleMenu(role, me)[0].href);
    return new Promise(() => {});
  }
  // เปิดหน้าที่อยู่ในเมนูของบทบาทอื่น (เช่น ลิงก์ตรง) → สลับไปบทบาทนั้นให้เอง
  if (location.pathname !== "/" && !roleMenu(role, me).some((m) => sameItem(m.href) || samePath(m.href))) {
    const other = roles.find((r) => roleMenu(r, me).some((m) => sameItem(m.href))) || roles.find((r) => roleMenu(r, me).some((m) => samePath(m.href)));
    if (other) role = other;
  }
  try { localStorage.setItem("sr-role", role); } catch { /* */ }
  me.role = role;

  const drawMenu = () => roleMenu(role, me).map((m) => `<a href="${m.href}" class="nav-item" ${sameItem(m.href) ? 'aria-current="page"' : ""}>${MI[m.icon]}<span>${esc(m.label)}</span></a>`).join("");
  const side = document.createElement("aside");
  side.className = "sidebar";
  side.id = "sidebar";
  side.innerHTML = `
    <a class="brand" href="/"><img src="/logo.jpg" alt=""><div><strong>รายงานผลการเรียน</strong><span>${esc(me.settings.school_name || "โรงเรียนบ้านป่าเด็ง")}</span></div></a>
    <div class="side-ctl">
      <label>บทบาท<select id="roleSel" ${roles.length < 2 ? "disabled" : ""}>${roles.map((r) => `<option value="${r}" ${r === role ? "selected" : ""}>${ROLES[r].label}</option>`).join("")}</select></label>
      <label>ปีการศึกษา<select id="yearSel">${me.years.map((y) => `<option value="${y.id}" ${y.id === me.year.id ? "selected" : ""}>${y.year_be}</option>`).join("")}</select></label>
    </div>
    <nav class="side-nav" id="sideNav" aria-label="เมนู">${drawMenu()}</nav>
    <div class="side-foot"><div class="who-box"><span class="avatar">${esc((me.user.full_name || "?").replace(/^(นางสาว|นาง|นาย|ครู)/, "").trim().slice(0, 1))}</span>
      <span><b>${esc(me.user.full_name)}</b><small>${esc(ROLES[role].label)}</small></span></div>
      <button class="nav-item" id="logoutBtn">${MI.out}<span>ออกจากระบบ</span></button></div>`;
  const mbar = document.createElement("header");
  mbar.className = "mobilebar";
  mbar.innerHTML = `<button class="icon-btn" id="menuBtn" aria-label="เปิดเมนู" aria-controls="sidebar" aria-expanded="false">${MI.menu}</button>
    <a class="brand" href="/"><img src="/logo.jpg" alt=""><strong>รายงานผลการเรียน</strong></a>
    <span class="role-chip">${esc(ROLES[role].short)}</span>`;
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  document.body.classList.add("with-sidebar");
  document.body.prepend(scrim);
  document.body.prepend(side);
  document.body.prepend(mbar);
  const setOpen = (open) => { document.body.classList.toggle("nav-open", open); mbar.querySelector("#menuBtn").setAttribute("aria-expanded", String(open)); };
  mbar.querySelector("#menuBtn").onclick = () => setOpen(!document.body.classList.contains("nav-open"));
  scrim.onclick = () => setOpen(false);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  side.addEventListener("click", (e) => { if (e.target.closest("a.nav-item")) setOpen(false); });
  window.addEventListener("hashchange", () => { side.querySelector("#sideNav").innerHTML = drawMenu(); });
  side.querySelector("#roleSel").onchange = (e) => {
    try { localStorage.setItem("sr-role", e.target.value); } catch { /* */ }
    const href = roleMenu(e.target.value, me)[0].href;
    // หน้าเดียวกัน (ต่างแค่ #) เบราว์เซอร์จะไม่โหลดใหม่ → ต้องโหลดเองเพื่อวาดเมนูของบทบาทใหม่
    if (href.split("#")[0] === location.pathname) { location.hash = href.split("#")[1] || ""; location.reload(); }
    else location.href = href;
  };
  side.querySelector("#yearSel").onchange = (e) => {
    rememberYear(e.target.value);
    const u = new URL(location.href);
    u.searchParams.set("year", e.target.value);
    location.href = u.pathname === "/course.html" ? "/" : u.toString();
  };
  side.querySelector("#logoutBtn").onclick = logout;
  return me;
}

// แท็บในหน้าที่ใช้ #hash (เมนูซ้ายลิงก์ตรงมาได้)
export function hashTab(allowed, fallback) {
  const h = location.hash.slice(1);
  return allowed.includes(h) ? h : fallback;
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

// ---------- คำอธิบายลอย (tooltip): ใส่ data-tip="ข้อความ" ที่องค์ประกอบใดก็ได้ ----------
// เมาส์ชี้ / โฟกัสด้วยคีย์บอร์ด = แสดง · แตะบนมือถือ = แสดง/ซ่อน · Esc = ซ่อน
let tipEl, tipFor = null, tipAt = 0;
function showTip(target) {
  tipEl ||= Object.assign(document.body.appendChild(document.createElement("div")), { className: "tip-pop", role: "tooltip", id: "tipPop" });
  tipEl.textContent = target.dataset.tip;
  tipEl.hidden = false;
  if (tipFor !== target) tipAt = Date.now();
  tipFor = target;
  target.setAttribute("aria-describedby", "tipPop");
  const r = target.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 16);
  tipEl.style.maxWidth = `${w}px`;
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
  const below = r.bottom + 8 + th < window.innerHeight;
  tipEl.style.left = `${left + window.scrollX}px`;
  tipEl.style.top = `${(below ? r.bottom + 8 : r.top - th - 8) + window.scrollY}px`;
}
function hideTip() { if (tipEl) tipEl.hidden = true; tipFor?.removeAttribute("aria-describedby"); tipFor = null; }
// เมาส์เท่านั้น (บนจอสัมผัสใช้การแตะแทน เพราะเบราว์เซอร์มือถือจำลอง mouseover ที่ทำให้คำอธิบายปิดเอง)
document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const t = e.target.closest?.("[data-tip]");
  if (t && t !== tipFor) showTip(t); else if (!t && tipFor) hideTip();
});
document.addEventListener("focusin", (e) => { const t = e.target.closest?.("[data-tip]"); if (t) showTip(t); });
document.addEventListener("focusout", (e) => { if (e.target.closest?.("[data-tip]")) hideTip(); });
document.addEventListener("click", (e) => {
  const t = e.target.closest?.(".tip-btn[data-tip]");
  if (t) { e.preventDefault(); tipFor === t && !tipEl?.hidden && Date.now() - tipAt > 500 ? hideTip() : showTip(t); } // แตะบนมือถือ: mouseover เปิดให้แล้ว ไม่ต้องปิดทันที
  else if (tipFor && !e.target.closest?.("[data-tip]")) hideTip();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
// เลื่อนหน้าจอ/ตาราง: ย้ายคำอธิบายตามหัวคอลัมน์ (ซ่อนเมื่อหัวคอลัมน์หลุดจอ)
window.addEventListener("scroll", () => {
  if (!tipFor || tipEl?.hidden) return;
  const r = tipFor.getBoundingClientRect();
  if (!tipFor.isConnected || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) hideTip();
  else showTip(tipFor);
}, { passive: true, capture: true });
