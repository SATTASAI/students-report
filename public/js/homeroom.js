import { shell, api, esc, toast, showError, gradeBadge, dialog, confirmBox, ICONS, params, withYear } from "/js/app.js";
import { ASSESSMENT_GROUPS, LEVELS, LEVEL_LABEL, summarizeGroup } from "/js/grading.js";

await shell("home");
const p = params();
const grade = p.get("grade"), room = p.get("room");
const yearQ = p.get("year") ? `&year=${encodeURIComponent(p.get("year"))}` : "";
const q = `grade=${encodeURIComponent(grade)}&room=${encodeURIComponent(room)}${yearQ}`;
const view = document.getElementById("view");
let data;
let tab = sessionStorage.getItem("sr-hr-tab") || "trait";
const pending = new Map();
let saving = false, timer;

try { data = await api(`/api/homeroom?${q}`); }
catch (err) {
  document.getElementById("main").hidden = false;
  view.innerHTML = `<div class="panel empty"><strong>เปิดห้องนี้ไม่ได้</strong>${esc(err.message)}</div>`;
  throw err;
}
document.getElementById("main").hidden = false;
document.title = `ครูประจำชั้น ${grade}/${room}`;
document.getElementById("title").textContent = `ครูประจำชั้น ${grade}/${room}`;
document.getElementById("meta").textContent = `ปีการศึกษา ${data.year.year_be} · นักเรียน ${data.students.filter((s) => s.enrollment_status === "enrolled").length} คน`;
document.getElementById("backLink").href = withYear("/", data.year.id);
const pp6 = document.getElementById("pp6Btn");
pp6.innerHTML = `${ICONS.print} พิมพ์ ปพ.6 ทั้งห้อง`;
pp6.href = `/print/pp6.html?${q}`;

const TABS = [...ASSESSMENT_GROUPS.map((g) => [g.key, g.short]), ["grades", "ผลการเรียนรวม"], ["absence", "ขาดเรียน (บค.)"]];
const tabs = document.getElementById("tabs");
tabs.innerHTML = TABS.map(([k, label]) => `<button role="tab" data-tab="${k}">${label}</button>`).join("");
function renderTabs() {
  for (const b of tabs.querySelectorAll("button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    b.onclick = async () => { await flush(); tab = b.dataset.tab; sessionStorage.setItem("sr-hr-tab", tab); renderTabs(); render(); };
  }
}
window.addEventListener("beforeunload", (e) => { if (pending.size || saving) { e.preventDefault(); e.returnValue = ""; } });

function render() {
  const group = ASSESSMENT_GROUPS.find((g) => g.key === tab);
  if (group) renderAssessment(group);
  else if (tab === "grades") renderGrades();
  else renderAbsence();
}

const valueOf = (sid, key) => data.assessments[sid]?.[key] ?? "";
const options = (group, v) => (group.type === "pass"
  ? [["", "–"], ["ผ", "ผ่าน (ผ)"], ["มผ", "ไม่ผ่าน (มผ)"]]
  : [["", "–"], ...LEVELS.map((l) => [l.value, `${l.value} ${l.label}`])]).map(([val, label]) => `<option value="${val}" ${String(v) === val ? "selected" : ""}>${label}</option>`).join("");
const summaryLabel = (group, v) => v == null ? "–" : group.type === "pass" ? v : `${v} ${LEVEL_LABEL[v]}`;

function renderAssessment(group) {
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="muted small">${group.type === "pass" ? "ผ = ผ่าน, มผ = ไม่ผ่าน" : "3 ดีเยี่ยม · 2 ดี · 1 ผ่าน · 0 ไม่ผ่าน"} — ผลสรุป: ข้อใดไม่ผ่านถือว่าไม่ผ่าน นอกนั้นใช้ค่าเฉลี่ยปัดลง · บันทึกอัตโนมัติ</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead><tr><th class="stick no col-head">เลขที่</th><th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
        ${group.items.map(([k, label]) => `<th class="col-head" style="min-width:100px"><span class="t">${esc(label)}</span>
          <select class="level-select" data-fill="${k}" aria-label="กรอกทั้งห้อง ${esc(label)}" style="width:90px;border:1px dashed var(--line);border-radius:6px;height:26px;margin-top:4px"><option value="">ทั้งห้อง…</option>${options(group, "").replace('<option value="" selected>–</option>', "")}</select></th>`).join("")}
        <th class="col-head">สรุป</th></tr></thead>
      <tbody>${data.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${group.items.map(([k]) => { const v = valueOf(s.id, k); return `<td><select class="level-select v${esc(v)}" data-key="${k}" aria-label="${esc(s.name)} ${esc(k)}">${options(group, v)}</select></td>`; }).join("")}
        <td class="calc" data-sum>${summaryLabel(group, summarizeGroup(group, data.assessments[s.id]))}</td></tr>`).join("")}</tbody>
    </table></div>`;
  const table = document.getElementById("sheet");
  table.addEventListener("change", (e) => {
    const sel = e.target;
    if (sel.dataset.fill) {
      const v = sel.value; sel.value = "";
      if (!v) return;
      for (const s of data.students.filter((x) => x.enrollment_status === "enrolled")) {
        const cell = table.querySelector(`tr[data-sid="${s.id}"] select[data-key="${sel.dataset.fill}"]`);
        if (cell && !cell.value) { cell.value = v; setValue(group, s.id, sel.dataset.fill, v, cell); }
      }
      toast("กรอกให้ทุกคนที่ยังว่างแล้ว");
      return;
    }
    if (sel.dataset.key) setValue(group, Number(sel.closest("tr").dataset.sid), sel.dataset.key, sel.value, sel);
  });
  showState();
}

function setValue(group, sid, key, value, sel) {
  (data.assessments[sid] ||= {});
  if (value === "") delete data.assessments[sid][key]; else data.assessments[sid][key] = value;
  sel.className = `level-select v${value}`;
  sel.closest("tr").querySelector("[data-sum]").textContent = summaryLabel(group, summarizeGroup(group, data.assessments[sid]));
  pending.set(`${sid}|${key}`, value);
  showState();
  clearTimeout(timer);
  timer = setTimeout(flush, 600);
}

async function flush() {
  if (saving || !pending.size) return;
  saving = true;
  const batch = [...pending.entries()];
  pending.clear();
  showState();
  try {
    await api(`/api/homeroom/assessments?${q}`, { method: "PUT", body: { changes: batch.map(([k, value]) => { const [sid, item_key] = k.split("|"); return { student_id: Number(sid), item_key, value }; }) } });
    saving = false; showState();
  } catch (err) {
    for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v);
    saving = false; showState(err); showError(err);
    return;
  }
  if (pending.size) flush();
}

function showState(err) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.className = "save-state";
  if (err) { el.classList.add("error"); el.innerHTML = `บันทึกไม่สำเร็จ <button class="btn small" id="retry">ลองอีกครั้ง</button>`; document.getElementById("retry").onclick = flush; }
  else if (saving || pending.size) { el.classList.add("pending"); el.textContent = "กำลังบันทึก…"; }
  else el.textContent = "บันทึกแล้ว";
}

function renderGrades() {
  const subjects = [];
  for (const s of data.students) for (const g of data.grades[s.id] || []) if (!subjects.some((x) => x.code === g.code)) subjects.push(g);
  if (!subjects.length) { view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีรายวิชาของชั้นนี้</strong>ฝ่ายวิชาการต้องสร้างรายวิชาก่อน</div>`; return; }
  view.innerHTML = `<div class="sheet-wrap"><table class="sheet">
    <thead><tr><th class="stick no col-head">เลขที่</th><th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
      ${subjects.map((s) => `<th class="col-head"><span class="code">${esc(s.code)}</span><span class="t">${esc(s.name)}</span></th>`).join("")}</tr></thead>
    <tbody>${data.students.map((st) => {
      const by = Object.fromEntries((data.grades[st.id] || []).map((g) => [g.code, g]));
      return `<tr class="${st.enrollment_status !== "enrolled" ? "inactive" : ""}"><td class="stick no">${st.number ?? ""}</td><td class="stick name">${esc(st.name)}</td>
        ${subjects.map((s) => `<td class="calc grade-col">${gradeBadge(by[s.code]?.grade)}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table></div>
    <p class="muted small" style="margin-top:10px">ผลการเรียนดึงจากสมุดคะแนนของครูผู้สอนแต่ละวิชาแบบทันที — ช่องที่เป็น ร คือคะแนนยังไม่ครบ</p>`;
}

const REASON = { sick: "ป่วย", personal: "ลากิจ", unknown: "ไม่ทราบสาเหตุ", other: "อื่น ๆ" };
function renderAbsence() {
  const rows = data.students.map((s) => ({ s, list: data.absences[s.id] || [] }));
  view.innerHTML = `
    <div class="note" style="margin-bottom:14px">บันทึกเฉพาะนักเรียนที่ขาดเรียนบ่อยหรือขาดติดต่อกัน (การเช็กชื่อรายวันยังใช้ Q-info ตามเดิม) แล้วพิมพ์หนังสือแจ้งผู้ปกครองได้จากรายชื่อด้านล่าง</div>
    <div class="table-wrap"><table class="list">
      <thead><tr><th class="num">เลขที่</th><th>ชื่อ–สกุล</th><th class="num">วันที่ขาด</th><th>รายการ</th><th></th></tr></thead>
      <tbody>${rows.map(({ s, list }) => `<tr>
        <td class="num">${s.number ?? ""}</td><td>${esc(s.name)}</td><td class="num">${list.length || ""}</td>
        <td class="small">${list.map((a) => `<span class="tag ${a.reason === "unknown" ? "bad" : ""}" title="${esc(a.note || "")}">${thaiDate(a.absence_date)} ${REASON[a.reason]} <button class="linkish" style="color:inherit" data-del="${a.id}" aria-label="ลบ">×</button></span>`).join(" ")}</td>
        <td class="actions"><button class="btn small" data-add="${s.id}">บันทึกวันขาด</button>${list.length ? `<a class="btn small" target="_blank" rel="noopener" href="/print/absence-letter.html?${q}&student=${s.id}">${ICONS.print} หนังสือแจ้งผู้ปกครอง</a>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>`;
  for (const b of view.querySelectorAll("[data-add]")) b.onclick = () => addAbsence(Number(b.dataset.add));
  for (const b of view.querySelectorAll("[data-del]")) b.onclick = async () => {
    if (!(await confirmBox("ลบวันขาดเรียน", "ลบรายการนี้ใช่หรือไม่", "ลบ", true))) return;
    try { const r = await api(`/api/homeroom/absences/${b.dataset.del}?${q}`, { method: "DELETE" }); data.absences = r.absences; renderAbsence(); } catch (err) { showError(err); }
  };
}

function thaiDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

async function addAbsence(sid) {
  const s = data.students.find((x) => x.id === sid);
  const n = new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  const res = await dialog({
    title: `บันทึกวันขาดเรียน — ${s.name}`,
    body: `<div class="form-grid">
      <label class="field">ตั้งแต่วันที่<input type="date" name="from" value="${today}" required></label>
      <label class="field">ถึงวันที่<input type="date" name="to" value="${today}" required></label>
      <label class="field">สาเหตุ<select name="reason">${Object.entries(REASON).map(([k, v]) => `<option value="${k}" ${k === "unknown" ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="weekdays" checked> นับเฉพาะวันจันทร์–ศุกร์</label>
    <label class="field" style="margin-top:12px">หมายเหตุ<input name="note" maxlength="300"></label>`,
  });
  if (!res.ok) return;
  const { from, to, reason, note, weekdays } = res.data;
  const dates = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && dates.length <= 60; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (weekdays && (wd === 0 || wd === 6)) continue;
    dates.push(d.toISOString().slice(0, 10));
  }
  if (!dates.length) { toast("ช่วงวันที่ไม่มีวันเรียน", "bad"); return; }
  try {
    const r = await api(`/api/homeroom/absences?${q}`, { method: "POST", body: { student_id: sid, dates, reason, note } });
    data.absences = r.absences; toast(`บันทึก ${dates.length} วันแล้ว`); renderAbsence();
  } catch (err) { showError(err); }
}

renderTabs();
render();
