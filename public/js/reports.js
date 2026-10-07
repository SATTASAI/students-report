import { shell, api, esc, showError, gradeBadge, fmt, ICONS, hashTab } from "/js/app.js";
import { NUMERIC_GRADES } from "/js/grading.js";
import { exportRoomsExcel, exportRoomCsv } from "/js/export.js";

const me = await shell("reports");
const view = document.getElementById("view");
document.getElementById("main").hidden = false;
if (!me.user.is_admin) {
  view.innerHTML = `<div class="panel empty"><strong>หน้านี้สำหรับฝ่ายวิชาการ/วัดผล</strong>ครูประจำชั้นพิมพ์ ปพ.6 ได้จากหน้าห้องของตนเอง</div>`;
  throw new Error("not admin");
}
const Y = me.year.id;
document.getElementById("yearLine").textContent = `ปีการศึกษา ${me.year.year_be}`;
const SECTIONS = { progress: me.role === "exec" ? "ภาพรวมการส่งผล" : "ติดตามการส่งผล", rooms: "เอกสารรายห้อง", summary: "สรุปผลสัมฤทธิ์" };
let tab = hashTab(Object.keys(SECTIONS), "progress");
document.getElementById("tabs")?.classList.add("by-menu");
window.addEventListener("hashchange", () => { tab = hashTab(Object.keys(SECTIONS), "progress"); renderTabs(); render(); });
function renderTabs() {
  document.getElementById("pageTitle").textContent = SECTIONS[tab];
  document.title = `${SECTIONS[tab]} — รายงานผลการเรียน`;
}

async function render() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  try { await ({ progress: renderProgress, rooms: renderRooms, summary: renderSummary })[tab](); }
  catch (err) { view.innerHTML = `<div class="panel empty"><strong>โหลดข้อมูลไม่สำเร็จ</strong>${esc(err.message)}</div>`; }
}

async function renderProgress() {
  const { courses } = await api(`/api/reports/progress?year=${Y}`);
  const byTeacher = {};
  for (const c of courses) for (const t of (c.teachers.length ? c.teachers : [{ id: 0, full_name: "ยังไม่มีครูผู้สอน" }])) (byTeacher[t.full_name] ||= []).push(c);
  const rows = Object.entries(byTeacher).map(([name, list]) => ({
    name, list, avg: Math.round(list.reduce((a, c) => a + c.progress, 0) / list.length), locked: list.filter((c) => c.locked).length,
  })).sort((a, b) => a.avg - b.avg);
  view.innerHTML = `<div class="panel"><div class="panel-head"><h2>ความคืบหน้ารายครู</h2><span class="muted small">เรียงจากกรอกน้อยที่สุด</span></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>ครู</th><th class="num">รายวิชา</th><th>กรอกแล้ว</th><th class="num">ส่งผลแล้ว</th><th>รายวิชา</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.list.length}</td>
      <td style="min-width:140px"><span class="small muted">${r.avg}%</span><div class="meter ${r.avg >= 100 ? "done" : ""}"><i style="width:${r.avg}%"></i></div></td>
      <td class="num">${r.locked}/${r.list.length}</td>
      <td class="small">${r.list.map((c) => `<a href="/course.html?id=${c.id}&year=${Y}" title="${c.progress}%">${esc(c.code)} ${esc(c.grade_level)}/${esc(c.classroom)}</a>`).join(", ")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">ยังไม่มีรายวิชา</td></tr>`}</tbody></table></div></div>`;
}

async function renderRooms() {
  const { rooms } = await api(`/api/admin/rooms?year=${Y}`);
  const primary = rooms.filter((r) => /^ป\.[1-6]$/.test(r.grade_level));
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>เอกสารรายห้อง</h2><button class="btn primary" id="allXlsx">${ICONS.download} Excel ทุกห้อง</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>ห้อง</th><th class="num">นักเรียน</th><th>เอกสาร</th></tr></thead>
    <tbody>${primary.map((r, i) => `<tr><td>${esc(r.grade_level)}/${esc(r.classroom)}</td><td class="num">${r.students}</td>
      <td class="actions">
        <a class="btn small" target="_blank" rel="noopener" href="/print/pp5.html?year=${Y}&grade=${encodeURIComponent(r.grade_level)}&room=${encodeURIComponent(r.classroom)}">${ICONS.print} ปพ.5 ทุกวิชา</a>
        <a class="btn small" target="_blank" rel="noopener" href="/print/pp6.html?year=${Y}&grade=${encodeURIComponent(r.grade_level)}&room=${encodeURIComponent(r.classroom)}">${ICONS.print} ปพ.6</a>
        ${r.grade_level === "ป.6" ? `<a class="btn small" target="_blank" rel="noopener" href="/print/pp1.html?year=${Y}&grade=${encodeURIComponent(r.grade_level)}&room=${encodeURIComponent(r.classroom)}">${ICONS.print} ปพ.1 (ร่าง)</a>` : ""}
        <button class="btn small" data-x="${i}">${ICONS.download} Excel</button>
        <button class="btn small" data-c="${i}">${ICONS.download} CSV สำหรับนำเข้า</button>
      </td></tr>`).join("")}</tbody></table></div>
    <p class="muted small" style="margin-top:10px">ไฟล์ CSV เป็นรูปแบบทั่วไป 1 แถวต่อ 1 วิชา ยังไม่ใช่รูปแบบของ SGS/Q-info — ส่งไฟล์ตัวอย่างจากระบบปลายทางมาเพื่อปรับให้ตรง</p></div>`;
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { showError(err); } btn.disabled = false; };
  document.getElementById("allXlsx").onclick = (e) => busy(e.currentTarget, () => exportRoomsExcel(Y, primary, `ผลการเรียน_${me.year.year_be}_ทุกห้อง.xlsx`));
  for (const b of view.querySelectorAll("[data-x]")) b.onclick = () => { const r = primary[Number(b.dataset.x)]; busy(b, () => exportRoomsExcel(Y, [r], `ผลการเรียน_${me.year.year_be}_${r.grade_level}-${r.classroom}.xlsx`)); };
  for (const b of view.querySelectorAll("[data-c]")) b.onclick = () => { const r = primary[Number(b.dataset.c)]; busy(b, () => exportRoomCsv(Y, r.grade_level, r.classroom)); };
}

async function renderSummary() {
  const s = await api(`/api/reports/summary?year=${Y}`);
  const cols = [...NUMERIC_GRADES, "ร", "มส"];
  const grades = [...new Set(s.subjects.map((x) => x.grade_level))];
  view.innerHTML = `<div class="actions" style="margin-bottom:14px"><a class="btn" target="_blank" rel="noopener" href="/print/summary.html?year=${Y}">${ICONS.print} พิมพ์รายงานสรุป</a></div>
    ${grades.map((g) => `<div class="panel"><div class="panel-head"><h2>${g}</h2>
      <span class="muted small">${s.rooms.filter((r) => r.grade_level === g).map((r) => `${esc(r.grade_level)}/${esc(r.classroom)} เฉลี่ย ${r.avg_gpa ?? "–"}`).join(" · ")}</span></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>วิชา</th><th class="num">คน</th>${cols.map((c) => `<th class="num">${gradeBadge(c)}</th>`).join("")}<th class="num">เฉลี่ย</th><th class="num">3 ขึ้นไป</th></tr></thead>
      <tbody>${s.subjects.filter((x) => x.grade_level === g).map((x) => `<tr><td>${esc(x.code)} ${esc(x.name)}</td><td class="num">${x.n}</td>
        ${cols.map((c) => `<td class="num">${x.counts[c] || ""}</td>`).join("")}<td class="num">${x.mean ?? "–"}</td><td class="num">${x.good_pct == null ? "–" : `${fmt(x.good_pct, 1)}%`}</td></tr>`).join("")}</tbody></table></div></div>`).join("") || `<div class="panel empty"><strong>ยังไม่มีผลการเรียน</strong></div>`}`;
}

renderTabs();
render();
