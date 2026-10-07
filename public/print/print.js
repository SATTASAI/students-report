// ส่วนช่วยของหน้าพิมพ์เอกสาร
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const params = () => new URLSearchParams(location.search);

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
let thaiDigits = false;
try { thaiDigits = localStorage.getItem("sr-thai-digits") === "1"; } catch { /* */ }
export const td = (v) => thaiDigits ? String(v ?? "").replace(/[0-9]/g, (d) => THAI_DIGITS[d]) : String(v ?? "");

export function fmt(n) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  return td(Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
}

const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
export function thaiDate(iso, short = false) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return td(`${d} ${short ? MONTHS[m - 1].slice(0, 3) + "." : MONTHS[m - 1]} ${y + 543}`);
}
export const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

export async function get(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; throw new Error("login"); }
  if (!res.ok) throw new Error(data.error || `โหลดข้อมูลไม่สำเร็จ (${res.status})`);
  return data;
}

export function toolbar(title, extra = "") {
  const bar = document.createElement("div");
  bar.className = "toolbar";
  bar.innerHTML = `<button id="printBtn">พิมพ์ / บันทึกเป็น PDF</button>
    <label><input type="checkbox" id="thaiNum" ${thaiDigits ? "checked" : ""}> ใช้เลขไทย</label>${extra}<span class="msg">${esc(title)}</span>`;
  document.body.prepend(bar);
  bar.querySelector("#printBtn").onclick = () => window.print();
  bar.querySelector("#thaiNum").onchange = (e) => { try { localStorage.setItem("sr-thai-digits", e.target.checked ? "1" : "0"); } catch { /* */ } location.reload(); };
  return bar;
}

export function status(msg) {
  const el = document.getElementById("doc");
  el.innerHTML = `<div class="status">${esc(msg)}</div>`;
}

export const GRADE_TEXT = { "4": "ดีเยี่ยม", "3.5": "ดีมาก", "3": "ดี", "2.5": "ค่อนข้างดี", "2": "น่าพอใจ", "1.5": "พอใช้", "1": "ผ่านเกณฑ์ขั้นต่ำ", "0": "ต่ำกว่าเกณฑ์", "ร": "รอการตัดสิน", "มส": "ไม่มีสิทธิ์สอบ" };
export const gradeOut = (g) => g == null ? "" : td(g);

// วันที่จากฐานข้อมูล (UTC) → วันที่ไทยแบบเต็ม เช่น "8 ตุลาคม 2569" (ตามตัวเลือกเลขไทย)
export function thaiDateUtc(s) {
  if (!s) return "";
  const str = String(s).replace(" ", "T");
  const d = new Date(str.length > 10 && !/[zZ]$/.test(str) ? `${str}Z` : str);
  if (Number.isNaN(d.getTime())) return td(String(s));
  return thaiDate(new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10));
}
