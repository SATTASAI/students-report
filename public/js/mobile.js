// ใช้บนมือถือเหมือนแอป: แถบเมนูล่าง (bottom bar), เมนูเพิ่มเติมแบบ bottom sheet,
// ปัดซ้าย/ขวาสลับแท็บ, ดึงลงเพื่อรีเฟรช, ติดตั้งเป็นแอป (PWA)
// ทำงานเฉพาะจอ ≤ 1023px (จอใหญ่ยังใช้เมนูซ้ายตามเดิม)

const MQ = typeof matchMedia === "function" ? matchMedia("(max-width: 1023px)") : { matches: false, addEventListener() {} };
export const isMobile = () => MQ.matches;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const buzz = () => { try { navigator.vibrate?.(8); } catch { /* */ } };

// เมนูตรงกับ URL ไหม (แบบเดียวกับ sameItem ใน app.js แต่เทียบกับ URL ที่ส่งมา)
export function tabMatches(href, url) {
  const [pathq, hash = ""] = href.split("#");
  const [path, q = ""] = pathq.split("?");
  if (path !== url.pathname) return 0;
  if (q) {
    const cur = url.searchParams;
    if (![...new URLSearchParams(q)].every(([k, v]) => cur.get(k) === v)) return 0;
  }
  const h = url.hash.slice(1), alias = { moves: "students" };
  if (hash) return h === hash || alias[h] === hash ? 3 : 0;
  return q ? 2 : 1;
}
export function tabIndex(tabs, url) {
  let best = -1, score = 0;
  tabs.forEach((t, i) => { const s = tabMatches(t.href, url); if (s > score) { score = s; best = i; } });
  return best;
}

// ---------- หน้าต่างหลัก: แถบล่าง + เมนูเพิ่มเติมแบบ sheet ----------
export function mountAppBar({ tabs, icons, esc, side, setOpen, go }) {
  const bar = document.createElement("nav");
  bar.className = "bbar";
  bar.setAttribute("aria-label", "เมนูหลัก");
  bar.innerHTML = `<span class="bb-pill" aria-hidden="true"></span>${tabs.map((t, i) => `<a class="bb-item" href="${t.href}" data-i="${i}">${icons[t.icon]}<span>${esc(t.short || t.label)}</span></a>`).join("")}
    <button type="button" class="bb-item bb-more" aria-controls="sidebar" aria-expanded="false">${icons.menu}<span>เพิ่มเติม</span></button>`;
  document.body.append(bar);
  document.body.classList.add("has-bbar");
  const pill = bar.querySelector(".bb-pill");
  const items = [...bar.querySelectorAll("a.bb-item")];
  const more = bar.querySelector(".bb-more");

  const update = () => {
    const i = tabIndex(tabs, new URL(location.href));
    items.forEach((a, k) => (k === i ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const el = items[i];
    pill.classList.toggle("on", !!el);
    if (el) { pill.style.width = `${el.offsetWidth}px`; pill.style.transform = `translateX(${el.offsetLeft}px)`; }
  };
  update();
  requestAnimationFrame(update);
  addEventListener("resize", update);

  bar.addEventListener("click", (e) => {
    const a = e.target.closest("a.bb-item");
    if (!a || e.metaKey || e.ctrlKey) return;
    buzz();
    a.classList.remove("tap"); void a.offsetWidth; a.classList.add("tap");
    if (go) { e.preventDefault(); go(a.href); requestAnimationFrame(update); }
  });
  more.onclick = () => { buzz(); setOpen(!document.body.classList.contains("nav-open")); };
  new MutationObserver(() => more.setAttribute("aria-expanded", String(document.body.classList.contains("nav-open"))))
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // เมนูเพิ่มเติม (sidebar บนมือถือกลายเป็น bottom sheet): ลากหูจับลงเพื่อปิด
  const grip = document.createElement("div");
  grip.className = "sheet-grip";
  grip.innerHTML = "<span></span>";
  side.prepend(grip);
  dragToClose(side, () => setOpen(false));
  installButton(side);

  const swipe = (dir) => {
    const i = tabIndex(tabs, new URL(location.href));
    const t = i < 0 ? null : tabs[i + dir];
    if (!t) return false;
    buzz();
    if (go) go(t.href, { dir }); else location.href = t.href;
    requestAnimationFrame(update);
    return true;
  };
  return { update, swipe };
}

function dragToClose(sheet, close) {
  let y0 = null, dy = 0, t0 = 0;
  sheet.addEventListener("touchstart", (e) => {
    if (!isMobile() || !document.body.classList.contains("nav-open")) return;
    const onGrip = e.target.closest(".sheet-grip");
    if (!onGrip && sheet.scrollTop > 0) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = performance.now();
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 4) { sheet.style.transition = "none"; sheet.style.transform = `translateY(${dy}px)`; if (e.cancelable) e.preventDefault(); }
  }, { passive: false });
  const end = () => {
    if (y0 == null) return;
    const fast = dy > 40 && performance.now() - t0 < 250;
    y0 = null;
    sheet.style.transition = ""; sheet.style.transform = "";
    if (dy > 110 || fast) close();
  };
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
}

// ปุ่ม "ติดตั้งเป็นแอป" ในเมนูเพิ่มเติม (Android: ใช้ prompt ของเบราว์เซอร์ · iPhone: บอกวิธีเพิ่มไปยังหน้าจอโฮม)
function installButton(side) {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const foot = side.querySelector(".side-foot");
  if (!foot) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-item install-app";
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M12 7v7M9 11l3 3 3-3"/></svg><span>ติดตั้งเป็นแอปบนมือถือ</span>';
  btn.hidden = !ios;
  foot.prepend(btn);
  let deferred = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; btn.hidden = false; });
  addEventListener("appinstalled", () => { btn.hidden = true; });
  btn.onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; btn.hidden = true; return; }
    const tip = document.createElement("div");
    tip.className = "ios-tip";
    tip.innerHTML = `<b>ติดตั้งบน iPhone / iPad</b><ol><li>เปิดหน้านี้ด้วย Safari</li><li>กดปุ่มแชร์ <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8"/></svg></li><li>เลือก “เพิ่มไปยังหน้าจอโฮม”</li></ol><button type="button" class="btn small">เข้าใจแล้ว</button>`;
    document.body.append(tip);
    tip.querySelector("button").onclick = () => tip.remove();
  };
}

// ---------- ทุกหน้า (หน้าต่างหลักและหน้าใน iframe): ปัดสลับแท็บ + ดึงลงรีเฟรช ----------
const scrollableX = (el) => {
  for (; el && el !== document.body && el.nodeType === 1; el = el.parentElement) {
    const ox = getComputedStyle(el).overflowX;
    if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 2) return true;
  }
  return false;
};
const scrolledY = (el) => {
  for (; el && el !== document.body && el.nodeType === 1; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollTop > 0) return true;
  }
  return false;
};
const blocked = (t) => !!t.closest?.("input, textarea, select, [contenteditable], dialog, .sidebar, .bbar, .mobilebar, .ios-tip, .tip-pop, .no-swipe");

export function gestures({ onSwipe, onRefresh }) {
  if (gestures.on || !("ontouchstart" in window)) return;
  gestures.on = true;
  document.documentElement.classList.add("touch-app");
  const ptr = document.createElement("div");
  ptr.className = "ptr";
  ptr.setAttribute("aria-hidden", "true");
  ptr.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>';
  let s = null; // สถานะการแตะ
  const PULL = 72, SWIPE = 70;
  const host = () => document.getElementById("main") || document.querySelector("main") || document.body;

  document.addEventListener("touchstart", (e) => {
    s = null;
    if (!isMobile() || e.touches.length !== 1 || document.body.classList.contains("nav-open") || document.querySelector("dialog[open]")) return;
    const t = e.target, p = e.touches[0];
    if (blocked(t) || p.clientX < 22 || p.clientX > innerWidth - 22) return;
    s = { x: p.clientX, y: p.clientY, axis: null, t: t, top: (document.scrollingElement?.scrollTop || 0) <= 0 && !scrolledY(t), dx: 0, dy: 0 };
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!s || e.touches.length !== 1) { s = null; return; }
    const p = e.touches[0];
    s.dx = p.clientX - s.x; s.dy = p.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(s.dx) < 10 && Math.abs(s.dy) < 10) return;
      s.axis = Math.abs(s.dx) > Math.abs(s.dy) * 1.4 ? "x" : "y";
      if (s.axis === "x" && (!onSwipe || scrollableX(s.t) || getSelection()?.toString())) { s = null; return; }
      if (s.axis === "y" && (!s.top || s.dy < 0 || !onRefresh)) { s = null; return; }
      if (s.axis === "y") { document.body.append(ptr); ptr.classList.remove("spin", "go"); }
    }
    if (s.axis === "x") {
      const m = host();
      m.style.transition = "none";
      m.style.transform = `translateX(${s.dx * 0.18}px)`;
      m.style.opacity = String(1 - Math.min(Math.abs(s.dx) / 900, 0.25));
    } else {
      if (e.cancelable) e.preventDefault();
      const d = Math.min(s.dy * 0.5, PULL * 1.5);
      ptr.style.transform = `translate(-50%, ${d}px) rotate(${d * 4}deg)`;
      ptr.style.opacity = String(Math.min(d / PULL, 1));
      ptr.classList.toggle("go", d >= PULL);
    }
  }, { passive: false });

  const end = () => {
    if (!s) return;
    const st = s; s = null;
    if (st.axis === "x") {
      const m = host();
      m.style.transition = "transform .22s ease, opacity .22s ease";
      m.style.transform = ""; m.style.opacity = "";
      if (Math.abs(st.dx) >= SWIPE) {
        const moved = onSwipe(st.dx < 0 ? 1 : -1);
        if (moved === false && !reduced()) { m.classList.remove("bump"); void m.offsetWidth; m.classList.add("bump"); }
      }
    } else if (st.axis === "y") {
      if (Math.min(st.dy * 0.5, PULL * 1.5) >= PULL) {
        ptr.classList.add("spin");
        ptr.style.transform = `translate(-50%, ${PULL * 0.8}px)`;
        try { navigator.vibrate?.(10); } catch { /* */ }
        setTimeout(onRefresh, 260);
      } else {
        ptr.style.transition = "transform .2s ease, opacity .2s ease";
        ptr.style.transform = "translate(-50%, 0)"; ptr.style.opacity = "0";
        setTimeout(() => { ptr.style.transition = ""; ptr.remove(); }, 220);
      }
    }
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
}

// ---------- PWA: service worker (เปิดได้เร็วขึ้น และมีหน้าแจ้งเมื่อออฟไลน์) ----------
export function registerSW() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:" && location.hostname !== "localhost") return;
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}), { once: true });
  if (document.readyState === "complete") navigator.serviceWorker.register("/sw.js").catch(() => {});
}
