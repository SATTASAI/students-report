import { shell, api, esc, toast, showError, gradeBadge, dialog, confirmBox, fmt, ICONS, params, withYear, thaiTime } from "/js/app.js";
import { computeStudentResult, resultWithAttendance, NUMERIC_GRADES, indicatorWord, indicatorResult, structureIssues, indicatorPassPct, remedialCap } from "/js/grading.js";
import { parseIndicatorLines } from "/js/indicators.js";

const me = await shell("home");
const courseId = params().get("id");
const view = document.getElementById("view");
let data;              // ข้อมูลจาก /api/courses/:id
let bankCache = null;  // คลังตัวชี้วัดของรายวิชานี้ [{id, code, title, kind}]
let builder = null;    // หน้าสร้างโครงสร้างรายวิชาที่เปิดอยู่ {term, units, loose, finals, dirty}
let tab = sessionStorage.getItem(`sr-tab-${courseId}`) || "t1";
// ร่างโครงสร้างรายวิชาในเบราว์เซอร์ (ประกาศก่อนแสดงผลครั้งแรก)
const draftKey = (term) => `sr-draft-${courseId}-${term}`;
const openKey = `sr-building-${courseId}`;
const draftNote = () => (builder?.dirty ? "ยังไม่บันทึก · ร่างเก็บไว้ในเบราว์เซอร์นี้แล้ว (รีเฟรชไม่หาย)" : "");
const whenText = (ms) => new Date(ms).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
let targetsCache = null;
const pending = new Map(); // "itemId:studentId" → score|null รอบันทึก
let saving = false;
let saveTimer;

try {
  data = await api(`/api/courses/${courseId}`);
} catch (err) {
  document.getElementById("main").hidden = false;
  view.innerHTML = `<div class="panel empty"><strong>เปิดรายวิชานี้ไม่ได้</strong>${esc(err.message)}</div>`;
  throw err;
}
document.getElementById("main").hidden = false;
const W = indicatorWord(data.course.grade_level); // ป.1–3 = ผลการเรียนรู้, ป.4–6 = ตัวชี้วัด
if (!data.items.length && tab !== "setup") tab = "setup";
window.addEventListener("beforeunload", (e) => {
  if (pending.size || saving || invalidCount()) { e.preventDefault(); e.returnValue = ""; }
});
const invalidCount = () => document.querySelectorAll("#sheet td.cell.invalid").length;
// ค่าก่อนเริ่มพิมพ์ในช่อง (ใช้คืนค่าเมื่อพิมพ์ผิด เช่นพิมพ์ 12 ในช่องเต็ม 10 — ห้ามให้ "1" ที่พิมพ์ระหว่างทางถูกบันทึก)
const editStart = new Map(); // "item:sid" → { val, pend }
// ข้อมูลที่โหลดใหม่จากเซิร์ฟเวอร์อาจยังไม่มีคะแนนที่รอบันทึก — ใส่กลับก่อนแสดงผล
function reapplyPending() {
  for (const [k, v] of pending) {
    const [itemId, sid] = k.split(":").map(Number);
    const sc = studentScores(sid);
    if (v == null) delete sc[itemId]; else sc[itemId] = v;
  }
  for (const sid of new Set([...pending.keys()].map((k) => Number(k.split(":")[1])))) if (data.computed) recompute(sid);
}

// ---------------- ส่วนหัว ----------------
function renderHeader() {
  const c = data.course;
  document.title = `${c.code} ${c.name} ${c.grade_level}/${c.classroom} — สมุดคะแนน`;
  document.getElementById("title").textContent = `${c.code} ${c.name}`;
  document.getElementById("meta").textContent =
    `${c.grade_level}/${c.classroom} · ปีการศึกษา ${c.year_be} · ${c.hours_per_year} ชม./ปี · ต่อภาค: ระหว่างภาค ${fmt(c.collect_ratio / 2)} + ปลายภาค ${fmt(50 - c.collect_ratio / 2)} = 50` +
    (c.teachers.length ? ` · ครูผู้สอน ${c.teachers.map((t) => t.full_name).join(", ")}` : "");
  const back = document.getElementById("backLink");
  if (me.role === "exec") { back.textContent = "อนุมัติผลการเรียน"; back.href = "/admin.html#approve"; }
  else if (me.role === "measure" || me.role === "admin") { back.textContent = "ตรวจผลการเรียน"; back.href = "/admin.html#review"; }
  else back.href = withYear("/", c.academic_year_id);
  const pb = document.getElementById("printBtn");
  pb.innerHTML = `${ICONS.print} ปพ.5 ในคลังเอกสาร`;
  pb.href = `/docs.html?room=${encodeURIComponent(`${c.grade_level}/${c.classroom}`)}`;
  const sb = document.getElementById("submitBtn");
  const note = document.getElementById("lockNote");
  const when = (t) => t ? ` เมื่อ ${thaiTime(t)}` : "";
  note.className = "note";
  if (c.locked) {
    // ครูส่ง → ฝ่ายวัดผลตรวจ → ผู้บริหารอนุมัติ
    const by = (name, t) => `${name ? ` โดย ${esc(name)}` : ""}${esc(when(t))}`;
    const line = c.status === "approved" ? `อนุมัติผลแล้ว${by(c.approved_by_name, c.approved_at)}`
      : c.status === "reviewed" ? `ฝ่ายวัดผลตรวจแล้ว${by(c.reviewed_by_name, c.reviewed_at)} รอผู้บริหารอนุมัติ`
      : `ส่งผลแล้ว${by(c.submitted_by_name, c.submitted_at)} รอฝ่ายวัดผลตรวจ`;
    if (c.status === "submitted" && data.is_admin) { sb.innerHTML = `${ICONS.check || ICONS.lock} ตรวจแล้ว ส่งผู้บริหาร`; sb.disabled = false; sb.onclick = reviewCourse; }
    else if (c.status === "reviewed" && data.can_approve) { sb.innerHTML = `${ICONS.lock} อนุมัติผล`; sb.disabled = false; sb.onclick = approveCourse; }
    else { sb.innerHTML = `${ICONS.lock} ${c.status === "approved" ? "อนุมัติผลแล้ว" : c.status === "reviewed" ? "รอผู้บริหารอนุมัติ" : "ส่งแล้ว รอตรวจ"}`; sb.disabled = true; }
    note.hidden = false;
    if (c.status === "approved") note.classList.add("ok");
    note.innerHTML = `${line}${c.admin_edit
      ? `<br><b>คุณแก้ไขได้ในฐานะฝ่ายวัดผล</b> — ทุกการแก้ไขจะถูกบันทึกให้ครูผู้สอนเห็น${c.status === "approved" ? " และต้องให้ผู้บริหารอนุมัติใหม่" : ""}`
      : ` — ถ้าต้องแก้ ให้ส่งคำขอแก้ไขถึงฝ่ายวัดผล${requestBit()}`}
      ${data.is_admin || data.can_approve ? ' <button class="btn small" id="returnLink">ส่งคืนให้ครูแก้</button>' : ""}`;
    const rl = document.getElementById("returnLink");
    if (rl) rl.onclick = returnCourse;
    bindRequest();
  } else {
    sb.innerHTML = `${ICONS.lock} ส่งผลการเรียน`;
    sb.disabled = !c.can_edit;
    sb.onclick = submitCourse;
    if (c.return_note) {
      note.hidden = false; note.classList.add("warn");
      note.textContent = `ส่งคืนให้แก้${c.returned_by_name ? `โดย ${c.returned_by_name}` : ""}${when(c.returned_at)}: "${c.return_note}" — แก้แล้วกดส่งผลอีกครั้ง`;
    } else {
      note.hidden = c.can_edit;
      note.classList.add("warn");
      note.innerHTML = !data.is_admin && !data.is_teacher ? "ดูและตรวจสอบได้อย่างเดียว — ผู้บริหารแก้คะแนนไม่ได้"
        : `ปิดการกรอกคะแนนแล้ว — ถ้าต้องแก้ ให้ส่งคำขอแก้ไขถึงฝ่ายวัดผล${requestBit()}`;
      bindRequest();
    }
  }
}

// คำขอแก้ไข (รายวิชาส่งแล้ว / ปิดการกรอกแล้ว) → ฝ่ายวัดผลอนุมัติแล้วจึงแก้ได้
function requestBit() {
  if (data.is_admin || !data.is_teacher) return ""; // ฝ่ายวัดผล/ผู้ดูแลใช้ปุ่มส่งคืนแทน · ผู้บริหารดูอย่างเดียว
  const r = data.edit_request;
  if (r) return `<br><span class="tag">ส่งคำขอแก้ไขแล้ว ${esc(thaiTime(r.requested_at))} รอฝ่ายวัดผลอนุมัติ</span> <span class="small muted">"${esc(r.reason)}"</span>`;
  return ' <button class="btn small" id="reqEdit">ขอแก้ไข</button>';
}
function bindRequest() {
  const b = document.getElementById("reqEdit");
  if (!b) return;
  b.onclick = async () => {
    const r = await dialog({ title: "ขอแก้ไขรายวิชา", okText: "ส่งคำขอ",
      body: `<p class="muted" style="margin-top:0">ฝ่ายวัดผลจะเห็นคำขอนี้ เมื่ออนุมัติแล้วรายวิชาจะกลับมาแก้ได้ แก้เสร็จต้องกดส่งผลอีกครั้ง (ผ่านการตรวจและอนุมัติใหม่)</p>
        <label class="field">ต้องการแก้อะไร เพราะอะไร<textarea name="reason" required minlength="3" maxlength="500"></textarea></label>` });
    if (!r.ok) return;
    try { data.edit_request = (await api(`/api/courses/${courseId}/edit-request`, { method: "POST", body: { reason: r.data.reason } })).edit_request; toast("ส่งคำขอแล้ว รอฝ่ายวัดผลอนุมัติ"); renderHeader(); }
    catch (err) { showError(err); }
  };
}

function renderEdits() {
  let box = document.getElementById("editLog");
  if (!data.edits?.length) { box?.remove(); return; }
  if (!box) { box = document.createElement("details"); box.id = "editLog"; box.className = "note"; document.getElementById("lockNote").after(box); }
  box.innerHTML = `<summary>ประวัติการแก้ไขหลังส่งผล ${data.edits.length} ครั้ง (ล่าสุด ${esc(thaiTime(data.edits[0].created_at))})</summary>
    <ul class="small" style="margin:8px 0 0;padding-left:20px">${data.edits.map((e) => `<li>${esc(thaiTime(e.created_at))} · ${esc(e.by_name || "")} · ${esc(e.what)}${e.detail ? ` (${esc(e.detail)})` : ""}</li>`).join("")}</ul>`;
}

function renderTabs() {
  for (const b of document.querySelectorAll("#tabs button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    b.onclick = () => { tab = b.dataset.tab; sessionStorage.setItem(`sr-tab-${courseId}`, tab); renderTabs(); render(); };
  }
}

function render() {
  reapplyPending();
  if (tab === "t1" || tab === "t2") renderSheet(tab === "t1" ? 1 : 2);
  else if (tab === "sum") renderSummary();
  else if (tab === "rem") renderRemedial();
  else if (builder) drawBuilder();
  else renderSetup();
}

const editable = () => !!data.course.can_edit; // ฝ่ายวัดผลแก้รายวิชาที่ส่งแล้วได้ (server ส่ง can_edit มาให้)
// ต้องตรงกับ gradeSettings() ฝั่งเซิร์ฟเวอร์ทุกค่า เพื่อให้ตัวเลขบนจอ = ตัวเลขในเอกสาร
const settingsForCalc = () => ({
  collect_ratio: data.course.collect_ratio, hours_per_year: data.course.hours_per_year,
  attendance_pass_pct: data.settings.attendance_pass_pct, indicator_pass_pct: data.settings.indicator_pass_pct,
  indicator_pass_pct_t2: data.settings.indicator_pass_pct_t2, finalized: !!data.course.locked,
});
const studentScores = (sid) => data.scores[sid] || (data.scores[sid] = {});
const studentRemedials = (sid) => data.remedials?.[sid] || {};
const unitOf = (it) => (data.units || []).find((u) => u.id === it.unit_id);
function recompute(sid) {
  data.computed[sid] = computeStudentResult(data.items, studentScores(sid), resultWithAttendance(data.results[sid], data.attendance?.[sid]?.rate, data.course.hours_per_year), settingsForCalc(), studentRemedials(sid), data.carry?.[sid]);
  return data.computed[sid];
}
const statusTag = (s) => s.transfer_in_term ? ` <span class="tag" title="ย้ายเข้าระหว่างปี">ย้ายเข้าภาค ${s.transfer_in_term}</span>`
  : s.enrollment_status === "transferred" ? ' <span class="tag warn">ย้ายออก</span>'
  : s.enrollment_status === "withdrawn" ? ' <span class="tag warn">ออกกลางคัน</span>'
  : s.enrollment_status === "moved" ? ' <span class="tag">ย้ายห้อง</span>' : "";

// ---------------- ตารางกรอกคะแนนรายภาค ----------------
function renderSheet(term) {
  const items = data.items.filter((i) => i.term_number === term);
  if (!items.length) {
    view.innerHTML = `<div class="panel empty"><strong>ภาคเรียนที่ ${term} ยังไม่มีช่องคะแนน</strong>
      เพิ่ม${W}และการสอบปลายภาคในแท็บโครงสร้างคะแนนก่อน<br><br>
      <button class="btn primary" id="goSetup">ไปตั้งโครงสร้างคะแนน</button></div>`;
    document.getElementById("goSetup").onclick = () => { tab = "setup"; renderTabs(); render(); };
    return;
  }
  const can = editable();
  const termMax = items.reduce((a, i) => a + i.max_score, 0);
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="muted small">${can ? "พิมพ์คะแนนแล้วกด Enter เพื่อลงไปคนถัดไป · คัดลอกคะแนนจาก Excel (หลายแถวหลายคอลัมน์) คลิกช่องแรกแล้ววาง Ctrl+V ได้ทีเดียว — ถ้าคัดลอกติดชื่อหรือเลขประจำตัวมาด้วย ระบบวางให้ตรงคนเอง · บันทึกอัตโนมัติ" : "ดูได้อย่างเดียว"}</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap">
      <table class="sheet" id="sheet">
        <thead><tr>
          <th class="stick no col-head">เลขที่</th>
          <th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
          ${items.map((it) => `<th class="col-head ${it.kind === "final" ? "final" : ""}" title="${esc(it.title)}">
            <button data-edit-item="${it.id}" ${can ? "" : "disabled"}>${unitOf(it) ? `<span class="unitno">หน่วยที่ ${unitOf(it).unit_no}</span>` : ""}<span class="code">${esc(it.kind === "final" ? "ปลายภาค" : it.code || "เก็บ")}</span><span class="t">${esc(it.title)}</span><span class="max">เต็ม ${fmt(it.max_score)}</span></button></th>`).join("")}
          <th class="col-head">รวมภาค ${term}<span class="max">เต็ม ${fmt(termMax)}</span></th>
          <th class="col-head">รวมทั้งปี<span class="max">เต็ม 100</span></th>
          <th class="col-head">ผล</th>
        </tr></thead>
        <tbody>${data.students.map((s) => rowHtml(s, items, term)).join("")}</tbody>
        <tfoot><tr><td class="stick no"></td><td class="stick name" style="text-align:left">ค่าเฉลี่ย</td>${items.map((it) => `<td data-avg="${it.id}"></td>`).join("")}<td></td><td></td><td></td></tr></tfoot>
      </table>
    </div>
    <div class="legend"><span><b style="color:var(--warn)">ตัวเลขสีส้ม</b> = ต่ำกว่าเกณฑ์ผ่าน${W} ${indicatorPassPct(data.settings, term)}% (บันทึกแก้ตัวได้ที่แท็บ "แก้ตัว")</span><span><b style="color:var(--ok)">แก้</b> = มีคะแนนแก้ตัว</span><span>ช่องว่าง = ยังไม่ได้กรอก</span></div>`;
  updateAverages(items);
  bindSheet(items, term);
  for (const b of view.querySelectorAll("[data-edit-item]")) b.onclick = () => editItem(Number(b.dataset.editItem));
  showSaveState();
}

function rowHtml(s, items, term) {
  const sc = studentScores(s.id);
  const calc = data.computed[s.id];
  const inactive = s.enrollment_status !== "enrolled";
  const rem = studentRemedials(s.id);
  const carried = !!calc?.term_scores?.[term]?.carried;
  return `<tr data-sid="${s.id}" class="${inactive ? "inactive" : ""} ${s.enrollment_status === "moved" ? "moved" : ""}">
    <td class="stick no">${s.number ?? ""}</td>
    <td class="stick name" title="${esc(s.name)}">${esc(s.name)}${statusTag(s)}</td>
    ${items.map((it) => {
      if (carried) return `<td class="cell carried-cell" title="ใช้คะแนนภาค ${term} ที่ยกมาจาก ปพ.6 โรงเรียนเดิม"><input readonly tabindex="-1" placeholder="ยกมา" aria-label="${esc(s.name)} ${esc(it.title)} (ยกมา)" data-item="${it.id}" data-max="${it.max_score}" value=""></td>`;
      const v = sc[it.id];
      const hasRem = rem[it.id] != null;
      const low = it.kind === "indicator" && !hasRem && indicatorResult(it, v, data.settings) === "มผ";
      return `<td class="cell ${it.kind === "final" ? "final" : ""} ${low ? "low" : ""} ${hasRem ? "remed" : ""}" ${hasRem ? `title="แก้ตัวได้ ${fmt(rem[it.id])} นับ ${fmt(Math.min(rem[it.id], remedialCap(it, data.settings)))}"` : ""}><input inputmode="decimal" autocomplete="off" aria-label="${esc(s.name)} ${esc(it.title)}"
        data-item="${it.id}" data-max="${it.max_score}" value="${v == null ? "" : fmt(v)}" ${editable() ? "" : "readonly"}></td>`;
    }).join("")}
    <td class="calc" data-termsum>${termSumText(calc, items, sc)}</td>
    <td class="calc" data-total>${yearTotalText(calc)}</td>
    <td class="calc grade-col" data-grade>${sheetGrade(calc)}</td>
  </tr>`;
}

// รวมภาค: ว่างถ้ายังไม่กรอกเลย; รวมทั้งปี: แสดงเมื่อมีโครงสร้างครบ 2 ภาค (ภาคเดียวยังไม่ใช่คะแนนทั้งปี)
function termSumText(calc, items, sc) {
  const t = calc.term_scores?.[items[0].term_number];
  if (t?.carried) return `${fmt(t.total)} <span class="tag" title="ยกมาจาก ปพ.6 โรงเรียนเดิม">ยกมา</span>`;
  if (!items.some((i) => sc[i.id] != null)) return "";
  return fmt(calc.term_scores?.[items[0].term_number]?.total ?? 0);
}
function yearTotalText(calc) {
  return calc.total == null || calc.total_max !== 100 ? "–" : fmt(calc.total);
}

// ระหว่างกรอก ถ้าคะแนนยังไม่ครบ แสดงว่า "ยังไม่ครบ" แทน ร สีแดง เพื่อไม่ให้ดูเหมือนตัดสินแล้ว
function sheetGrade(calc) {
  if (calc.grade == null && calc.reason) return `<span class="grade gnone" title="${esc(calc.reason)}">${calc.missing > 0 ? "ยังไม่ครบ" : "–"}</span>`;
  if (calc.original_grade === "ร" && calc.missing > 0 && !calc.reason?.startsWith("ครู")) return `<span class="grade gnone" title="${esc(calc.reason)}">ยังไม่ครบ</span>`;
  return gradeBadge(calc.grade);
}

function updateAverages(items) {
  for (const it of items) {
    const vals = data.students.filter((s) => s.enrollment_status === "enrolled").map((s) => studentScores(s.id)[it.id]).filter((v) => v != null);
    const cell = view.querySelector(`[data-avg="${it.id}"]`);
    if (cell) cell.textContent = vals.length ? fmt(vals.reduce((a, v) => a + Number(v), 0) / vals.length, 1) : "";
  }
}

function bindSheet(items, term) {
  const table = document.getElementById("sheet");
  const inputs = () => [...table.querySelectorAll("tbody input")];
  const cols = items.length;

  const move = (input, dr, dc) => {
    const all = inputs();
    const idx = all.indexOf(input);
    const r = Math.floor(idx / cols), c = idx % cols;
    const nr = r + dr, nc = c + dc;
    if (nc < 0 || nc >= cols) return;
    const target = all[nr * cols + nc];
    if (target) { target.focus(); target.select(); }
  };

  table.addEventListener("focusin", (e) => {
    const t = e.target;
    if (!t.matches("input")) return;
    t.select();
    const key = `${t.dataset.item}:${t.closest("tr").dataset.sid}`;
    if (!editStart.has(key)) editStart.set(key, { val: studentScores(Number(t.closest("tr").dataset.sid))[Number(t.dataset.item)], pend: pending.has(key) ? pending.get(key) : undefined });
  });
  table.addEventListener("focusout", (e) => {
    const t = e.target;
    if (t.matches("input") && !t.parentElement.classList.contains("invalid")) editStart.delete(`${t.dataset.item}:${t.closest("tr").dataset.sid}`);
  });
  table.addEventListener("keydown", (e) => {
    const t = e.target;
    if (!t.matches("input")) return;
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); move(t, 1, 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(t, -1, 0); }
    else if (e.key === "ArrowRight" && (t.selectionEnd === t.value.length || t.readOnly)) { e.preventDefault(); move(t, 0, 1); }
    else if (e.key === "ArrowLeft" && (t.selectionStart === 0 || t.readOnly)) { e.preventDefault(); move(t, 0, -1); }
    else if (e.key === "Escape") { const sid = t.closest("tr").dataset.sid; const v = studentScores(sid)[t.dataset.item]; t.value = v == null ? "" : fmt(v); markCell(t, true); }
  });
  if (!editable()) return;
  table.addEventListener("input", (e) => { if (e.target.matches("input")) acceptCell(e.target, items, term); });
  table.addEventListener("paste", (e) => {
    const t = e.target;
    if (!t.matches("input")) return;
    const textData = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(textData.trim())) return; // ค่าเดียว — ให้ช่องจัดการเอง
    e.preventDefault();
    let rows = textData.replace(/\r/g, "").replace(/\n+$/, "").split("\n").map((r) => r.split("\t").map((x) => x.trim()));
    const all = inputs();
    const start = all.indexOf(t);
    const r0 = Math.floor(start / cols), c0 = start % cols;
    let count = 0, skipped = 0, bad = 0, unmatched = 0;
    const put = (target, val) => {
      if (target.readOnly) return; // ภาคที่ใช้คะแนนยกมา
      target.value = val === "-" ? "" : val;
      if (acceptCell(target, items, term)) count++; else bad++;
    };
    // คัดลอกมาพร้อมเลขที่/เลขประจำตัว/ชื่อ → วางตามตัวนักเรียน (ลำดับใน Excel ไม่ตรงกับระบบก็ได้)
    const matched = rows.map(matchPastedRow);
    const filled = rows.filter((r) => r.some((x) => x !== ""));
    if (filled.length && matched.filter(Boolean).length >= Math.ceil(filled.length * 0.6)) {
      rows.forEach((row, i) => {
        const m = matched[i];
        if (!m) { if (row.some((x) => x !== "" && parseScore(x).ok)) unmatched++; return; }
        const tr = table.querySelector(`tr[data-sid="${m.sid}"]`);
        const cells = tr ? [...tr.querySelectorAll("input")] : [];
        row.slice(m.start).forEach((val, dc) => { if (c0 + dc >= cols) { skipped++; return; } if (cells[c0 + dc]) put(cells[c0 + dc], val); });
      });
    } else {
      // หัวตาราง (แถวแรกไม่มีตัวเลขเลย) ไม่ต้องวาง
      if (rows.length > 1 && !rows[0].some((x) => x !== "" && parseScore(x).ok)) rows = rows.slice(1);
      rows.forEach((row, dr) => row.forEach((val, dc) => {
        const target = all[(r0 + dr) * cols + (c0 + dc)];
        if (!target || c0 + dc >= cols) { skipped++; return; }
        put(target, val);
      }));
    }
    toast(`วางคะแนน ${count} ช่อง${bad ? ` · ไม่ถูกต้อง ${bad} ช่อง (ช่องสีแดง ยังไม่บันทึก)` : ""}${unmatched ? ` · ไม่พบชื่อนักเรียน ${unmatched} แถว` : ""}${skipped ? ` · ข้อมูลเกินตาราง ${skipped} ช่องไม่ได้วาง` : ""}`, bad || unmatched ? "bad" : "");
  });
}

// แถวที่วางจาก Excel ขึ้นต้นด้วยเลขที่ / เลขประจำตัว / ชื่อ–สกุล → {sid, start: คอลัมน์แรกที่เป็นคะแนน}
const normName = (x) => String(x || "").replace(/^(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นางสาว|นาย|นาง|น\.ส\.)\s*/, "").replace(/\s+/g, "");
function matchPastedRow(row) {
  const studs = data.students;
  const byCell = (cell) => {
    if (!cell) return null;
    const n = normName(cell);
    return studs.find((s) => s.student_code && String(s.student_code) === cell) || (n.length >= 3 ? studs.find((s) => normName(s.name) === n) : null) || null;
  };
  for (let i = 0; i < Math.min(3, row.length); i++) {
    const s = byCell(row[i]);
    if (!s) continue;
    // คอลัมน์ก่อนหน้าต้องเป็นเลขที่ของคนเดียวกันหรือว่าง (กันจับผิดคน)
    if (row.slice(0, i).some((x) => x !== "" && x !== String(s.number ?? "") && !byCell(x))) continue;
    let end = i + 1;
    // คอลัมน์ถัดไปที่เป็นเลขประจำตัว/ชื่อ/นามสกุลของคนเดียวกัน ไม่ใช่คะแนน
    const ownText = (x) => x !== "" && !parseScore(x).ok && normName(x).length >= 2 && normName(s.name).includes(normName(x));
    while (end < row.length && (byCell(row[end])?.id === s.id || ownText(row[end]))) end++;
    return { sid: s.id, start: end };
  }
  // ชื่อและนามสกุลแยก 2 คอลัมน์
  for (let i = 0; i < Math.min(3, row.length - 1); i++) {
    const n = normName(`${row[i]}${row[i + 1]}`);
    const s = n.length >= 3 && studs.find((x) => normName(x.name) === n);
    if (s) return { sid: s.id, start: i + 2 };
  }
  return null;
}

function parseScore(raw) {
  const v = String(raw).trim().replace(",", ".");
  if (v === "") return { ok: true, value: null };
  // ทศนิยมได้ไม่เกิน 2 ตำแหน่ง (ไม่ปัดให้เอง เพื่อให้ครูเห็นตรงกับที่กรอก)
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { ok: false };
  return { ok: true, value: Number(v) };
}

function markCell(input, ok) {
  input.parentElement.classList.toggle("invalid", !ok);
}

function acceptCell(input, items, term) {
  const tr = input.closest("tr");
  const sid = Number(tr.dataset.sid), itemId = Number(input.dataset.item), max = Number(input.dataset.max);
  const p = parseScore(input.value);
  if (!p.ok || (p.value != null && p.value > max)) {
    markCell(input, false);
    input.title = !p.ok ? "กรอกได้เฉพาะตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง" : `เกินคะแนนเต็ม ${fmt(max)}`;
    // คืนค่าที่บันทึก/รอบันทึกไว้ก่อนเริ่มพิมพ์ช่องนี้ — ค่าที่พิมพ์ผิดไม่ถูกส่ง
    const key = `${itemId}:${sid}`, start = editStart.get(key);
    if (start) {
      const sc0 = studentScores(sid);
      if (start.val == null) delete sc0[itemId]; else sc0[itemId] = start.val;
      // ส่งค่าเดิมกลับเสมอ — ถ้าตัวเลขบางส่วน (เช่น "1" ของ "12") ถูกบันทึกไปแล้วระหว่างพิมพ์ จะถูกแก้กลับเป็นค่าเดิม
      pending.set(key, start.pend === undefined ? (start.val ?? null) : start.pend);
      scheduleSave();
      const calc0 = recompute(sid);
      tr.querySelector("[data-termsum]").textContent = termSumText(calc0, items, sc0);
      tr.querySelector("[data-total]").textContent = yearTotalText(calc0);
      tr.querySelector("[data-grade]").innerHTML = sheetGrade(calc0);
    }
    showSaveState();
    return false;
  }
  markCell(input, true);
  input.title = "";
  const sc = studentScores(sid);
  if (p.value == null) delete sc[itemId]; else sc[itemId] = p.value;
  const item = data.items.find((i) => i.id === itemId);
  input.parentElement.classList.toggle("low", item.kind === "indicator" && studentRemedials(sid)[itemId] == null && indicatorResult(item, p.value, data.settings) === "มผ");
  pending.set(`${itemId}:${sid}`, p.value);
  const calc = recompute(sid);
  tr.querySelector("[data-termsum]").textContent = termSumText(calc, items, sc);
  tr.querySelector("[data-total]").textContent = yearTotalText(calc);
  tr.querySelector("[data-grade]").innerHTML = sheetGrade(calc);
  updateAverages(items);
  scheduleSave();
  return true;
}

function scheduleSave() {
  showSaveState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}

async function flush() {
  if (saving || !pending.size) return;
  saving = true;
  const batch = [...pending.entries()];
  pending.clear();
  showSaveState();
  try {
    await api(`/api/courses/${courseId}/scores`, {
      method: "PUT",
      body: { changes: batch.map(([k, score]) => { const [item_id, student_id] = k.split(":").map(Number); return { item_id, student_id, score }; }) },
    });
    saving = false;
    showSaveState();
  } catch (err) {
    saving = false;
    if (err.status === 409) { showSaveState(err); showError(err); pending.clear(); setTimeout(() => location.reload(), 2500); return; }
    if (err.status === 400 && Array.isArray(err.data?.errors) && err.data.errors.length) {
      // บางช่องไม่ถูกต้อง (เช่น ครูอีกคนลดคะแนนเต็มหรือลบช่อง): ทิ้งเฉพาะช่องนั้น ทำเครื่องหมายสีแดง แล้วบันทึกช่องที่เหลือต่อ
      const badIdx = new Set(err.data.errors.map((x) => x.index));
      batch.forEach(([k, v], i) => {
        if (badIdx.has(i)) {
          const [itemId, sid] = k.split(":");
          const cell = document.querySelector(`#sheet tr[data-sid="${sid}"] input[data-item="${itemId}"]`);
          if (cell) { markCell(cell, false); cell.title = err.data.errors.find((x) => x.index === i)?.error || "บันทึกไม่ได้"; }
        } else if (!pending.has(k)) pending.set(k, v);
      });
      showError(`บันทึกไม่ได้ ${badIdx.size} ช่อง: ${err.data.errors[0].error} — โหลดหน้าใหม่เพื่อดูโครงสร้างล่าสุด`);
      showSaveState();
      if (pending.size) flush();
      return;
    }
    // เครือข่าย/เซิร์ฟเวอร์ขัดข้อง: คืนรายการที่ยังไม่บันทึก (ถ้ามีการแก้ใหม่ระหว่างนั้น ให้ใช้ค่าใหม่) แล้วให้กดลองใหม่
    for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v);
    showSaveState(err);
    showError(err);
    return;
  }
  if (pending.size) flush();
}

function showSaveState(err) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.className = "save-state";
  if (err) { el.classList.add("error"); el.innerHTML = `บันทึกไม่สำเร็จ <button class="btn small" id="retry">ลองอีกครั้ง</button>`; document.getElementById("retry").onclick = () => flush(); }
  else if (saving || pending.size) { el.classList.add("pending"); el.textContent = "กำลังบันทึก…"; }
  else if (invalidCount()) { el.classList.add("error"); el.textContent = `มีช่องไม่ถูกต้อง ${invalidCount()} ช่อง (ยังไม่บันทึก)`; }
  else el.textContent = "บันทึกแล้ว";
}

// การมาเรียนจากบันทึกของครูประจำชั้น: แสดงจำนวนวันขาด/ลา ชี้แล้วเห็นรายละเอียด
function attText(sid) {
  const a = data.attendance?.[sid] || {}, rate = a.rate;
  const off = (a["ข"] || 0) + (a["ล"] || 0) + (a["ป"] || 0);
  const detail = [["ข", "ขาด"], ["ล", "ลากิจ"], ["ป", "ลาป่วย"], ["ส", "มาสาย"]].filter(([k]) => a[k]).map(([k, l]) => `${l} ${a[k]}`).join(" · ");
  if (!rate || rate.pct == null) return detail ? `<span data-tip="${esc(detail)} (วัน)" tabindex="0">${off}</span>` : "–";
  const low = rate.pct < Number(data.settings.attendance_pass_pct);
  const tip = `มาเรียน ${rate.days - rate.absent}/${rate.days} วัน (${fmt(rate.pct, 2)}%) นับถึงวันนี้${detail ? ` · ${detail}` : ""}`;
  return `<span data-tip="${esc(tip)}" tabindex="0" ${low ? 'style="color:var(--bad);font-weight:700"' : ""}>${fmt(rate.pct, 2)}%</span>`;
}

// ---------------- สรุปผล / ร มส / แก้ตัว ----------------
function renderSummary() {
  const c = data.course;
  const can = editable();
  const need = c.hours_per_year * data.settings.attendance_pass_pct / 100;
  const counts = {};
  for (const s of data.students) if (s.enrollment_status === "enrolled") { const g = data.computed[s.id].grade ?? "–"; counts[g] = (counts[g] || 0) + 1; }
  view.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="actions">${[...NUMERIC_GRADES, "ร", "มส"].map((g) => `<span>${gradeBadge(g)} <span class="num">${counts[g] || 0}</span></span>`).join("")}</div>
      <p class="muted small" style="margin:10px 0 0">การมาเรียนคิดจากบันทึกของครูประจำชั้นและปฏิทินวันหยุด (ครูผู้สอนไม่ต้องเช็กชื่อ) — มาเรียนต่ำกว่า ${data.settings.attendance_pass_pct}% ระบบให้ผล มส อัตโนมัติ
        · คะแนนรวมไม่ปัดเศษ เช่น 79.99 ได้เกรด 3.5</p>
    </div>
    <div class="table-wrap">
      <table class="list">
        <thead><tr><th class="num">เลขที่</th><th>ชื่อ–สกุล</th><th class="num">ระหว่างภาค (${c.collect_ratio})</th><th class="num">ปลายภาค (${100 - c.collect_ratio})</th>
          <th class="num">รวม</th><th class="num">มาเรียน</th><th>ผลพิเศษ</th><th>ผลเดิม</th><th>แก้ไข/ซ่อม</th><th>ผลการเรียน</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${data.students.map((s) => {
          const k = data.computed[s.id], r = data.results[s.id] || {};
          const failed = k.failed_indicators.length;
          return `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "muted" : ""} ${s.enrollment_status === "transferred" || s.enrollment_status === "withdrawn" ? "inactive" : ""}">
            <td class="num">${s.number ?? ""}</td><td>${esc(s.name)}${statusTag(s)}</td>
            <td class="num">${fmt(k.collect_scaled)}</td><td class="num">${fmt(k.final_scaled)}</td><td class="num"><b>${yearTotalText(k)}</b></td>
            <td class="num">${attText(s.id)}</td>
            <td><select data-special style="width:80px" ${can ? "" : "disabled"} aria-label="ผลพิเศษ ${esc(s.name)}"><option value="">–</option><option ${r.special === "ร" ? "selected" : ""}>ร</option><option ${r.special === "มส" ? "selected" : ""}>มส</option></select></td>
            <td>${gradeBadge(k.original_grade)}</td>
            <td>${r.remedial_grade ? `<span class="tag">${r.remedial_type === "repeat" ? "เรียนซ้ำ" : "แก้ตัว"} → ${esc(r.remedial_grade)}</span> ` : ""}
              ${k.remedial_stale ? `<span class="tag" style="color:var(--bad);font-weight:700" title="ผลเดิมเปลี่ยนไปหลังบันทึกผลแก้ไข ระบบจึงใช้ผลเดิม — ตรวจแล้วแก้ไขหรือล้างผลแก้ไข">ผลแก้ไขไม่ตรงกับผลเดิมแล้ว ไม่ได้นำมาใช้</span> ` : ""}
              ${can && !["transferred", "withdrawn"].includes(s.enrollment_status) && (["0", "ร", "มส"].includes(k.original_grade) || r.remedial_grade) ? `<button class="btn small" data-remedial>${r.remedial_grade ? "แก้ไข" : "บันทึกผลแก้ตัว"}</button>` : ""}</td>
            <td>${gradeBadge(k.grade)}</td>
            <td class="small muted">${[k.reason, failed ? `ไม่ผ่าน ${failed} ${W}` : ""].filter(Boolean).map(esc).join(" · ")}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
  if (!can) return;
  for (const tr of view.querySelectorAll("tbody tr")) {
    const sid = Number(tr.dataset.sid);
    tr.querySelector("[data-special]").onchange = (e) => saveResult({ student_id: sid, special: e.target.value || null });
    const rb = tr.querySelector("[data-remedial]");
    if (rb) rb.onclick = () => remedialDialog(sid);
  }
}

async function saveResult(change) {
  try {
    data = await api(`/api/courses/${courseId}/results`, { method: "PUT", body: { changes: [change] } });
    toast("บันทึกแล้ว");
  } catch (err) { showError(err); }
  renderSummary();
}

async function remedialDialog(sid) {
  const s = data.students.find((x) => x.id === sid);
  const k = data.computed[sid], r = data.results[sid] || {};
  const res = await dialog({
    title: `ผลแก้ตัว / เรียนซ้ำ — ${s.name}`,
    body: `<p class="muted">ผลเดิม ${gradeBadge(k.original_grade)} ${esc(k.reason || "")}</p>
      <div class="form-grid">
        <label class="field">ประเภท<select name="remedial_type">
          <option value="remedial" ${r.remedial_type !== "repeat" ? "selected" : ""}>สอบแก้ตัว / แก้ ร / แก้ มส</option>
          <option value="repeat" ${r.remedial_type === "repeat" ? "selected" : ""}>เรียนซ้ำรายวิชา</option></select></label>
        <label class="field">ผลการเรียนหลังแก้ไข<select name="remedial_grade"><option value="">— ล้างผลแก้ไข —</option>
          ${NUMERIC_GRADES.map((g) => `<option ${r.remedial_grade === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
        <label class="field">วันที่<input type="date" name="remedial_date" value="${esc(r.remedial_date || "")}"></label>
      </div>
      <label class="field" style="margin-top:12px">หมายเหตุ<input name="remedial_note" value="${esc(r.remedial_note || "")}" maxlength="300"></label>
      <p class="note" style="margin-top:12px">ตามระเบียบ: แก้ 0 หรือ มส ได้ผลการเรียนไม่เกิน 1 · แก้ ร ได้ตามคะแนนจริง · เรียนซ้ำได้ตามคะแนนจริง</p>`,
  });
  if (!res.ok) return;
  const d = res.data;
  await saveResult({ student_id: sid, remedial_type: d.remedial_grade ? d.remedial_type : null, remedial_grade: d.remedial_grade || null, remedial_date: d.remedial_date, remedial_note: d.remedial_note });
}


// ---------------- แก้ตัวรายตัวชี้วัด ----------------
// แสดงเฉพาะคู่ นักเรียน × ตัวชี้วัด ที่คะแนนเดิมไม่ถึงเกณฑ์ หรือมีคะแนนแก้ตัวแล้ว
function renderRemedial() {
  const can = editable();
  const rows = [];
  for (const term of [1, 2]) for (const it of data.items.filter((i) => i.term_number === term && i.kind === "indicator")) {
    for (const s of data.students) {
      const raw = studentScores(s.id)[it.id];
      const rem = studentRemedials(s.id)[it.id];
      if (rem != null || (raw != null && indicatorResult(it, raw, data.settings) === "มผ")) rows.push({ term, it, s, raw, rem });
    }
  }
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>สอบแก้ตัวราย${W}</h2><span class="muted small">${rows.length} รายการ</span></div>
    <p class="muted small" style="margin-top:0">กรอกคะแนนที่นักเรียนทำได้จริงจากการแก้ตัว ระบบนับให้ไม่เกินเกณฑ์ผ่าน (ภาค 1: ${indicatorPassPct(data.settings, 1)}%, ภาค 2: ${indicatorPassPct(data.settings, 2)}% ของคะแนนเต็ม)
      และใช้คะแนนที่สูงกว่าระหว่างคะแนนเดิมกับคะแนนที่นับได้ · เว้นว่างเพื่อลบคะแนนแก้ตัว</p>
    ${rows.length ? `<div class="rem-row small muted" style="font-weight:600"><span>ภาค</span><span>นักเรียน</span><span>${W}</span><span>คะแนนเดิม</span><span>คะแนนแก้ตัว</span><span>นับได้</span></div>
      ${rows.map((r) => {
        const cap = remedialCap(r.it, data.settings);
        const counted = r.rem == null ? "–" : fmt(Math.max(r.raw ?? 0, Math.min(r.rem, cap)));
        return `<div class="rem-row" data-item="${r.it.id}" data-sid="${r.s.id}">
          <span>${r.term}</span><span>${r.s.number ?? ""} ${esc(r.s.name)}</span>
          <span class="small">${esc(r.it.code || "")} ${esc(r.it.title)} <span class="muted">(เต็ม ${fmt(r.it.max_score)} · ผ่าน ${fmt(cap)})</span></span>
          <span class="num" style="color:var(--warn)">${r.raw == null ? "–" : fmt(r.raw)}</span>
          <span><input inputmode="decimal" value="${r.rem == null ? "" : fmt(r.rem)}" ${can ? "" : "disabled"} aria-label="คะแนนแก้ตัว ${esc(r.s.name)}"></span>
          <span class="num" data-counted>${counted}</span></div>`;
      }).join("")}`
      : `<div class="empty"><strong>ไม่มี${W}ที่ต้องแก้ตัว</strong>นักเรียนทุกคนได้คะแนนถึงเกณฑ์ผ่านแล้ว (หรือยังไม่ได้กรอกคะแนน)</div>`}
  </div>`;
  if (!can) return;
  for (const row of view.querySelectorAll(".rem-row[data-item]")) {
    const input = row.querySelector("input");
    input.onchange = async () => {
      const p = parseScore(input.value);
      const it = data.items.find((i) => i.id === Number(row.dataset.item));
      if (!p.ok || (p.value != null && p.value > it.max_score)) { markCell(input, false); toast(!p.ok ? "กรอกตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง" : `เกินคะแนนเต็ม ${fmt(it.max_score)}`, "bad"); return; }
      await flush();
      try {
        data = await api(`/api/courses/${courseId}/scores`, { method: "PUT", body: { changes: [{ item_id: it.id, student_id: Number(row.dataset.sid), remedial: p.value }] } });
        toast(p.value == null ? "ลบคะแนนแก้ตัวแล้ว" : "บันทึกคะแนนแก้ตัวแล้ว");
        renderRemedial();
      } catch (err) { showError(err.data?.errors?.[0]?.error || err); }
    };
  }
}

// ---------------- โครงสร้างคะแนน ----------------
function renderSetup() {
  view.oninput = null;
  const c = data.course;
  const can = editable();
  const sum = (term, kind) => data.items.filter((i) => (!term || i.term_number === term) && i.kind === kind).reduce((a, i) => a + i.max_score, 0);
  const cT = c.collect_ratio / 2, fT = 50 - cT;
  const issues = structureIssues(data.items, c.collect_ratio, W).filter((x) => x.startsWith("ภาค"));
  const termLine = (t) => {
    const has = data.items.some((i) => i.term_number === t);
    if (!has) return "";
    const ci = Number(sum(t, "indicator").toPrecision(12)), fi = Number(sum(t, "final").toPrecision(12));
    const ok = !issues.some((x) => x.startsWith(`ภาค ${t}`));
    return `<span class="tag ${ok ? "ok" : "warn"}">${W} ${fmt(ci)}/${fmt(cT)} · ปลายภาค ${fmt(fi)}/${fmt(fT)}</span>`;
  };
  const itemRow = (it) => { const k = it.kind === "final" ? "" : bankKindOf(it); return `<div class="item ${it.kind}">
        <span class="code">${esc(it.kind === "final" ? "สอบปลายภาค" : it.code || "คะแนนเก็บ")}</span>
        <span>${esc(it.title)}${k && !k.startsWith("ผล") ? ` <span class="tag ${k === "ปลายทาง" ? "ok" : ""}">${esc(k)}</span>` : ""}${it.kind === "final" ? `<br><span class="muted small">${(it.indicators || []).length ? `วัด${W}: ${(it.indicators || []).map((x) => esc(x.code || x.title)).join(", ")}` : `<span class="tag warn">ยังไม่ได้ระบุ${W}ที่สอบ</span>`}</span>` : ""}</span><span class="num">เต็ม ${fmt(it.max_score)}</span><span></span>
      </div>`; };
  const list = (term) => {
    const items = data.items.filter((i) => i.term_number === term);
    const units = (data.units || []).filter((u) => u.term_number === term);
    if (!items.length && !units.length) return `<p class="muted small">ยังไม่มีโครงสร้างรายวิชา${can ? ` — กด "สร้างโครงสร้างรายวิชา" เพื่อพิมพ์หน่วยการเรียนรู้ ภาระงาน และเลือก${W}` : ""}</p>`;
    const inUnit = (u) => items.filter((i) => i.unit_id === u.id);
    const sumMax = (list) => Number(list.reduce((a, i) => a + i.max_score, 0).toPrecision(12));
    const loose = items.filter((i) => i.kind !== "final" && !units.some((u) => u.id === i.unit_id));
    const finals = items.filter((i) => i.kind === "final");
    return units.map((u) => `<div class="unit">
        <div class="unit-head"><span><b>หน่วยที่ ${u.unit_no} ${esc(u.title)}</b>
          <span class="muted small">${u.hours != null ? ` · ${fmt(u.hours, 1)} ชม.` : ""} · ${fmt(sumMax(inUnit(u)))} คะแนน</span></span></div>
        ${u.task ? `<p class="small" style="margin:0 0 8px"><span class="muted">ภาระงาน/ชิ้นงาน:</span> ${esc(u.task)}</p>` : ""}
        <div class="item-list">${inUnit(u).map(itemRow).join("") || `<p class="muted small">ยังไม่มี${W}ในหน่วยนี้</p>`}</div></div>`).join("")
      + (loose.length ? `<div class="unit loose"><div class="unit-head"><span class="muted small">${W}ที่ยังไม่ได้จัดเข้าหน่วย</span></div><div class="item-list">${loose.map(itemRow).join("")}</div></div>` : "")
      + (finals.length ? `<div class="item-list" style="margin-top:10px">${finals.map(itemRow).join("")}</div>` : "");
  };
  const termEmpty = (t) => !data.items.some((i) => i.term_number === t);
  const tplPanel = (c.has_template || data.is_admin) ? `<div class="panel"><div class="panel-head"><h2>แม่แบบโครงสร้างของวิชา ${esc(c.code)} ${esc(c.grade_level)}</h2></div>
      ${c.has_template ? `<p class="muted small" style="margin-top:0">${c.template_inherited ? "ใช้แม่แบบจากปีการศึกษาก่อน (ฝ่ายวิชาการตั้งไว้ ยังไม่ได้ตั้งใหม่ปีนี้)" : `ฝ่ายวิชาการตั้งแม่แบบไว้แล้ว${c.template_updated_at ? ` (ปรับล่าสุด ${esc(c.template_updated_at.slice(0, 10))})` : ""}`} ใช้กับภาคที่ยังไม่มีช่องคะแนนได้ แล้วปรับคะแนนเต็มต่อได้อิสระ</p>
        ${can ? `<div class="actions">${[1, 2].map((t) => `<button class="btn ${termEmpty(t) ? "primary" : ""}" data-tpl="${t}" ${termEmpty(t) ? "" : "disabled title=\"ภาคนี้มีช่องคะแนนแล้ว\""}>ใช้แม่แบบ ภาค ${t}</button>`).join("")}</div>` : ""}`
        : `<p class="muted small" style="margin-top:0">ยังไม่มีแม่แบบ</p>`}
      ${data.is_admin ? `<div class="actions" style="margin-top:10px"><button class="btn" id="tplSave" ${data.items.length ? "" : "disabled"}>บันทึกโครงสร้างนี้เป็นแม่แบบของวิชา</button>${c.has_template && !c.template_inherited ? '<button class="btn danger" id="tplDel">ลบแม่แบบ</button>' : ""}</div>
        <p class="muted small">เฉพาะฝ่ายวิชาการ/ทีมวัดผล — ครูทุกห้องของวิชานี้จะกดใช้แม่แบบได้ ห้องที่ใช้ไปแล้วไม่เปลี่ยนตาม</p>` : ""}</div>` : "";
  view.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>สัดส่วนคะแนนต่อภาคเรียน</h2></div>
      <div class="ratio-bar"><span class="c" style="width:${c.collect_ratio}%">ระหว่างภาค ${fmt(cT)}</span><span class="f" style="width:${100 - c.collect_ratio}%">ปลายภาค ${fmt(fT)}</span></div>
      <p class="muted small">แต่ละภาคเต็ม 50 คะแนน (ทั้งปี 100) · คะแนนเต็มของ${W}รวมกันต้องเท่ากับ ${fmt(cT)} และสอบปลายภาครวม ${fmt(fT)} พอดี
        ระบบใช้คะแนนจริงตามที่กรอก ไม่ย่อขยายและไม่ปัดเศษ · ฝ่ายวิชาการเป็นผู้กำหนดสัดส่วนของแต่ละวิชา</p>
      ${issues.length ? `<p class="note warn" style="margin-top:8px">${issues.map(esc).join("<br>")}<br>แก้ให้ตรงก่อนยืนยันผล</p>` : ""}
    </div>
    ${[1, 2].map((t) => `<div class="panel">
      ${can && readDraft(t) ? `<div class="note warn" style="margin:0 0 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">มีร่างโครงสร้างภาคเรียนที่ ${t} ที่ยังไม่บันทึก (${esc(whenText(readDraft(t).at))})
        <button class="btn small primary" data-resume="${t}">เปิดร่างทำต่อ</button><button class="btn small" data-dropdraft="${t}">ทิ้งร่าง</button></div>` : ""}
      <div class="panel-head"><h2>ภาคเรียนที่ ${t} ${termLine(t)}</h2>${can ? `<div class="actions">
        <button class="btn ${termEmpty(t) ? "primary" : ""}" data-build="${t}">${termEmpty(t) && !(data.units || []).some((u) => u.term_number === t) ? "สร้างโครงสร้างรายวิชา" : "แก้ไขโครงสร้างรายวิชา"}</button></div>` : ""}</div>
      ${list(t)}</div>`).join("")}
    ${tplPanel}
    ${can ? `<div class="panel"><div class="panel-head"><h2>ใช้โครงสร้างจากห้องอื่น / ปีการศึกษาก่อน</h2></div>
      <p class="muted small">ดึงหน่วยการเรียนรู้ ภาระงาน ${W} และคะแนนเต็มของวิชาเดียวกัน (รหัสวิชาและชั้นเดียวกัน) มาเป็นร่าง ปรับได้ก่อนกดบันทึก — ไม่คัดลอกคะแนนนักเรียน</p>
      <div id="siblings" class="muted small">กำลังค้นหา…</div></div>
    <div class="panel" id="pushPanel" hidden><div class="panel-head"><h2>นำโครงสร้างนี้ไปใช้กับห้องอื่นที่สอน</h2>
      <button class="btn" id="pushBtn" ${data.items.length ? "" : "disabled"}>${ICONS.copy} เลือกห้อง</button></div>
      <p class="muted small" id="pushInfo" style="margin:0"></p></div>` : ""}`;
  for (const b of view.querySelectorAll("[data-build]")) b.onclick = () => openBuilder(Number(b.dataset.build));
  for (const b of view.querySelectorAll("[data-tpl]")) b.onclick = () => applyTemplate(Number(b.dataset.tpl));
  const ts = document.getElementById("tplSave"), td = document.getElementById("tplDel");
  if (ts) ts.onclick = saveTemplate;
  if (td) td.onclick = deleteTemplate;
  if (can) { loadSiblings(); loadPushPanel(); }
  for (const b of view.querySelectorAll("[data-resume]")) b.onclick = () => openBuilder(Number(b.dataset.resume), { resume: true });
  for (const b of view.querySelectorAll("[data-dropdraft]")) b.onclick = async () => { if (await confirmBox("ทิ้งร่าง", "ร่างที่ยังไม่บันทึกจะหายไป", "ทิ้งร่าง", true)) { clearDraft(Number(b.dataset.dropdraft)); renderSetup(); } };
  if (!bankCache) loadBank().then(() => { if (tab === "setup" && !builder) renderSetup(); }).catch(() => {});
}

function itemForm(it = {}) {
  return `<div class="form-grid">
    <label class="field">ภาคเรียน<select name="term_number"><option value="1" ${it.term_number === 1 ? "selected" : ""}>ภาคเรียนที่ 1</option><option value="2" ${it.term_number === 2 ? "selected" : ""}>ภาคเรียนที่ 2</option></select></label>
    <label class="field">ประเภท<select name="kind"><option value="indicator" ${it.kind !== "final" ? "selected" : ""}>คะแนนเก็บ (${W})</option><option value="final" ${it.kind === "final" ? "selected" : ""}>สอบปลายภาค</option></select></label>
    <label class="field">คะแนนเต็ม<input name="max_score" inputmode="decimal" required value="${it.max_score ?? ""}"></label>
  </div>
  ${(() => { const us = (data.units || []); return us.length ? `<label class="field" style="margin-top:12px">หน่วยการเรียนรู้<select name="unit_id"><option value="">— ไม่จัดเข้าหน่วย —</option>
    ${us.map((u) => `<option value="${u.id}" ${it.unit_id === u.id ? "selected" : ""}>ภาค ${u.term_number} · หน่วยที่ ${u.unit_no} ${esc(u.title)}</option>`).join("")}</select></label>` : ""; })()}
  <label class="field" style="margin-top:12px">รหัส${W} (ถ้ามี)<input name="code" maxlength="60" placeholder="เช่น ท 1.1 ป.1/1" value="${esc(it.code || "")}"></label>
  <label class="field" style="margin-top:12px">ชื่อ${W} / การสอบ<textarea name="title" required maxlength="500" style="min-height:80px">${esc(it.title || "")}</textarea></label>`;
}

async function applyTemplate(term) {
  let tpl;
  try { tpl = (await api(`/api/courses/${courseId}/template`)).template; } catch (err) { showError(err); return; }
  const units = tpl?.units.filter((u) => u.term_number === term) || [], items = tpl?.items.filter((i) => i.term_number === term) || [];
  if (!items.length) { toast(`แม่แบบไม่มีโครงสร้างภาคเรียนที่ ${term}`, "bad"); return; }
  const ok = await confirmBox(`ใช้แม่แบบ ภาคเรียนที่ ${term}`, `เพิ่ม ${units.length} หน่วย ${items.length} ช่องคะแนน (รวม ${fmt(items.reduce((a, i) => a + i.max_score, 0))} คะแนน) — ปรับคะแนนเต็มภายหลังได้`, "ใช้แม่แบบ");
  if (!ok) return;
  try { data = await api(`/api/courses/${courseId}/apply-template`, { method: "POST", body: { terms: [term] } }); toast("ใช้แม่แบบแล้ว"); render(); } catch (err) { showError(err); }
}

async function saveTemplate() {
  const ok = await confirmBox("บันทึกเป็นแม่แบบ", `ใช้โครงสร้างของห้องนี้ (${data.units.length} หน่วย ${data.items.length} ช่องคะแนน) เป็นแม่แบบของ ${esc(data.course.code)} ${esc(data.course.grade_level)}${data.course.has_template ? " แทนแม่แบบเดิม" : ""}`, "บันทึก");
  if (!ok) return;
  try { data = await api(`/api/courses/${courseId}/template`, { method: "PUT", body: {} }); toast("บันทึกแม่แบบแล้ว"); render(); } catch (err) { showError(err); }
}

async function deleteTemplate() {
  if (!(await confirmBox("ลบแม่แบบ", "ห้องที่ใช้แม่แบบไปแล้วไม่ได้รับผลกระทบ", "ลบแม่แบบ", true))) return;
  try { data = await api(`/api/courses/${courseId}/template`, { method: "DELETE" }); toast("ลบแม่แบบแล้ว"); render(); } catch (err) { showError(err); }
}

async function editItem(id) {
  if (!editable()) return;
  const it = data.items.find((i) => i.id === id);
  const res = await dialog({ title: "แก้ไขช่องคะแนน", body: itemForm(it) });
  if (!res.ok) return;
  await flush();
  try { data = await api(`/api/courses/${courseId}/items/${id}`, { method: "PUT", body: res.data }); toast("แก้ไขแล้ว"); render(); }
  catch (err) { showError(err); }
}

async function loadSiblings() {
  const box = document.getElementById("siblings");
  try {
    const { courses } = await api(`/api/courses/${courseId}/siblings`);
    if (!courses.length) { box.textContent = "ยังไม่มีห้องอื่นหรือปีก่อนที่ตั้งโครงสร้างวิชานี้ไว้"; return; }
    const Y = data.course.year_be;
    const group = (label, list) => list.length ? `<div style="margin-top:6px"><b class="small">${label}</b>${list.map((s) => `<div class="actions" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line-soft)">
      <span>${esc(s.grade_level)}/${esc(s.classroom)} ปีการศึกษา ${s.year_be} — ${s.item_count} ช่องคะแนน</span>
      <span class="actions">${[1, 2].map((t) => `<button class="btn small" data-pull="${s.id}:${t}" ${s[`t${t}_items`] ? "" : "disabled"}>${ICONS.copy} ใช้ภาค ${t}</button>`).join("")}</span></div>`).join("")}</div>` : "";
    box.innerHTML = group("ปีการศึกษานี้ (ห้องอื่น)", courses.filter((s) => s.year_be === Y)) + group("ปีการศึกษาก่อน ๆ", courses.filter((s) => s.year_be !== Y));
    for (const b of box.querySelectorAll("[data-pull]")) b.onclick = () => { const [sid, t] = b.dataset.pull.split(":").map(Number); pullStructure(sid, t); };
  } catch (err) { box.textContent = err.message; }
}

async function loadPushPanel() {
  const panel = document.getElementById("pushPanel");
  if (!panel) return;
  try {
    const targets = await loadTargets();
    if (!targets.length || !document.body.contains(panel)) return;
    panel.hidden = false;
    document.getElementById("pushInfo").textContent = `ห้องอื่นของ ${data.course.code || data.course.name} ที่คุณสอน: ${targets.map((c) => `${c.grade_level}/${c.classroom}`).join(", ")}`;
    document.getElementById("pushBtn").onclick = () => applyToRooms([1, 2].filter((t) => data.items.some((i) => i.term_number === t)));
  } catch { /* ไม่แสดงแผงนี้ */ }
}

// ---------------- ส่งผล / ส่งคืน / อนุมัติ ----------------
// รอให้คะแนนที่พิมพ์ไว้บันทึกเสร็จ (รวมชุดที่กำลังส่งอยู่) ก่อนส่งผล — ไม่เกินราว 15 วินาที
async function settleSaves() {
  clearTimeout(saveTimer);
  for (let i = 0; i < 60 && (saving || pending.size); i++) {
    if (!saving && pending.size) await flush();
    else await new Promise((r) => setTimeout(r, 250));
  }
  return !saving && !pending.size;
}

async function reloadCourse() {
  try { data = await api(`/api/courses/${courseId}`); renderHeader(); render(); } catch (e) { showError(e); }
}

async function submitCourse() {
  if (!(await settleSaves())) { toast("ยังบันทึกคะแนนไม่เสร็จ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง", "bad"); return; }
  if (invalidCount()) { toast(`มีช่องคะแนนไม่ถูกต้อง ${invalidCount()} ช่อง แก้ก่อนส่งผล`, "bad"); return; }
  if (data.structure_issues?.length) { toast(`ส่งไม่ได้: ${data.structure_issues[0]}`, "bad"); tab = "setup"; renderTabs(); render(); return; }
  let res;
  try {
    res = await api(`/api/courses/${courseId}/submit`, { method: "POST", body: {} });
  } catch (err) {
    if (!err.data?.needs_confirm) { showError(err); if (err.status === 409) await reloadCourse(); return; }
    const ch = err.data.checks;
    const list = (arr, fn) => arr.slice(0, 10).map((x) => `<li>${fn(x)}</li>`).join("") + (arr.length > 10 ? `<li>… อีก ${arr.length - 10} คน</li>` : "");
    const block = (title, arr, fn, cls = "warn") => arr.length ? `<div class="note ${cls}" style="margin-top:10px"><b>${title} (${arr.length})</b><ul style="margin:4px 0 0;padding-left:20px">${list(arr, fn)}</ul></div>` : "";
    const ok = await dialog({
      title: "ตรวจก่อนส่งผล", okText: "ส่งผลตามนี้", okClass: "primary", wide: true,
      body: `<p class="muted" style="margin-top:0">ระบบไม่ปัดเศษและไม่แก้คะแนนให้ ตรวจรายการต่อไปนี้ ถ้าถูกต้องแล้วกด "ส่งผลตามนี้" หรือกดยกเลิกเพื่อกลับไปแก้</p>
        ${block("ยังไม่มีคะแนนครบ 2 ภาค — เกรดทั้งปีจะยังไม่ออก (แสดง –) จนกว่าจะมีคะแนนภาคนั้น", ch.missing_terms || [], (x) => `ภาคเรียนที่ ${x.term}: ยังไม่มีโครงสร้างคะแนน และนักเรียน ${x.students} คนไม่มีคะแนนยกมา`, "bad")}
        ${block("คะแนนยังไม่ครบ (จะได้ ร เมื่อปิดปี)", ch.blanks, (x) => `${esc(x.name)} — ว่าง ${x.missing} ช่อง`, "bad")}
        ${block("คะแนนรวมมีทศนิยม — ครูตัดสินใจปัดเองได้", ch.decimals, (x) => `${esc(x.name)} — ${esc(x.detail)}`)}
        ${block("ขาดอีกไม่ถึง 1 คะแนนจะได้เกรดถัดไป", ch.borderline, (x) => `${esc(x.name)} — ${fmt(x.total)} (เกรด ${esc(x.grade)} ต้องได้ ${x.need})`)}
        ${block("ได้ มส", ch.ms, (x) => esc(x.name), "bad")}`,
    });
    if (!ok.ok) return;
    try { res = await api(`/api/courses/${courseId}/submit`, { method: "POST", body: { force: true, expect_rev: err.data.data_rev } }); }
    catch (e2) { showError(e2); if (e2.status === 409) await reloadCourse(); return; }
  }
  data = res;
  toast("ส่งผลการเรียนแล้ว");
  renderHeader(); render();
}

async function returnCourse() {
  const approved = data.course.status === "approved";
  const r = await dialog({
    title: approved ? "ส่งคืนเพื่อแก้ผลย้อนหลัง" : "ส่งคืนให้ครูแก้",
    body: `<p class="muted" style="margin-top:0">${approved ? "ผลที่อนุมัติแล้วจะถูกยกเลิก ต้องส่งและอนุมัติใหม่ " : ""}ครูผู้สอนจะเห็นข้อความนี้ที่หน้ารายวิชา และระบบบันทึกไว้ในประวัติ</p>
      <label class="field">เหตุผล / สิ่งที่ต้องแก้<textarea name="note" required minlength="3" maxlength="500"></textarea></label>`,
    okText: "ส่งคืน", okClass: "danger",
  });
  if (!r.ok) return;
  try {
    await api(`/api/admin/courses/${courseId}/return`, { method: "POST", body: { note: r.data.note } });
    data = await api(`/api/courses/${courseId}`);
    toast("ส่งคืนแล้ว"); renderHeader(); render();
  } catch (err) { showError(err); }
}

async function reviewCourse() {
  if (!(await confirmBox("ตรวจผลการเรียนแล้ว", `ยืนยันว่าตรวจ ${esc(data.course.code)} ${esc(data.course.name)} ${esc(data.course.grade_level)}/${esc(data.course.classroom)} แล้ว และส่งต่อให้ผู้บริหารอนุมัติ`, "ตรวจแล้ว"))) return;
  try {
    await api("/api/admin/courses/review", { method: "POST", body: { course_ids: [Number(courseId)] } });
    data = await api(`/api/courses/${courseId}`);
    toast("ส่งต่อให้ผู้บริหารแล้ว"); renderHeader(); render();
  } catch (err) { showError(err); }
}

async function approveCourse() {
  if (!(await confirmBox("อนุมัติผลการเรียน", `อนุมัติผล ${esc(data.course.code)} ${esc(data.course.name)} ${esc(data.course.grade_level)}/${esc(data.course.classroom)}`, "อนุมัติ"))) return;
  try {
    await api("/api/admin/courses/approve", { method: "POST", body: { course_ids: [Number(courseId)] } });
    data = await api(`/api/courses/${courseId}`);
    toast("อนุมัติแล้ว"); renderHeader(); render();
  } catch (err) { showError(err); }
}

// เริ่มแสดงผลหลังประกาศฟังก์ชัน/ค่าคงที่ทั้งหมดแล้ว
renderHeader();
renderEdits();
renderTabs();
render();


// ---------- หน้าสร้างโครงสร้างรายวิชา (ทั้งภาคในหน้าเดียว) ----------
// ครูพิมพ์หน่วยการเรียนรู้ ชั่วโมง ภาระงานเอง · ตัวชี้วัดเลือกจากคลัง แยกระหว่างทาง/ปลายทาง · บันทึกครั้งเดียว
async function loadBank() { bankCache = (await api(`/api/courses/${courseId}/bank`)).indicators || []; return bankCache; }
const itemKey = (x) => `${x.code || ""}|${x.title}`;
function bankKindOf(it) { const b = (bankCache || []).find((x) => itemKey(x) === itemKey(it)); return b?.kind || ""; }
const KIND_GROUPS = [["ระหว่างทาง", "ตัวชี้วัดระหว่างทาง"], ["ปลายทาง", "ตัวชี้วัดปลายทาง"], ["ผลการเรียนรู้", "ผลการเรียนรู้"], ["ผลลัพธ์การเรียนรู้", "ผลลัพธ์การเรียนรู้"], ["", "อื่น ๆ"]];
const r2 = (n) => Number(Number(n).toPrecision(12)); // ลบแค่ความคลาดเคลื่อนของเลขทศนิยมในคอมพิวเตอร์ ไม่ปัด

// ---- ร่างในเบราว์เซอร์: หน้าสร้างโครงสร้างไม่บันทึกอัตโนมัติ แต่เก็บร่างไว้กันเผลอรีเฟรช/ปิดหน้า ----
function readDraft(term) { try { const d = JSON.parse(localStorage.getItem(draftKey(term)) || "null"); return d && Array.isArray(d.units) ? d : null; } catch { return null; } }
function clearDraft(term) { try { localStorage.removeItem(draftKey(term)); } catch { /* */ } }
function saveDraft() {
  if (!builder?.dirty) return;
  const { term, units, loose, finals, from } = builder;
  try { localStorage.setItem(draftKey(term), JSON.stringify({ at: Date.now(), units, loose, finals, from: from || null })); } catch { /* พื้นที่เต็ม/ปิดไว้ — ทำงานต่อได้ */ }
}
function markDirty() { if (!builder) return; builder.dirty = true; saveDraft(); const st = document.getElementById("bDraft"); if (st) st.textContent = draftNote(); }
// id ในร่างอาจเก่า (มีคนแก้โครงสร้างหลังเก็บร่าง) → id ที่ไม่มีแล้วถือเป็นรายการใหม่
function sanitizeDraft(d, term) {
  const uIds = new Set((data.units || []).filter((u) => u.term_number === term).map((u) => u.id));
  const iIds = new Set(data.items.filter((i) => i.term_number === term).map((i) => i.id));
  const seen = new Set();
  const fixI = (it) => { const id = iIds.has(it.id) && !seen.has(it.id) ? it.id : null; if (id) seen.add(id); return { ...it, id }; };
  return { units: d.units.map((u) => ({ ...u, id: uIds.has(u.id) ? u.id : null, items: (u.items || []).map(fixI) })), loose: (d.loose || []).map(fixI),
    finals: (d.finals || []).map((f) => ({ ...fixI(f), inds: f.inds || [] })), from: d.from || null };
}

async function openBuilder(term, { resume = false } = {}) {
  try { if (!bankCache) await loadBank(); } catch (err) { showError(err); bankCache = []; }
  const toB = (i) => ({ id: i.id, code: i.code || "", title: i.title, max: i.max_score });
  const items = data.items.filter((i) => i.term_number === term);
  const units = (data.units || []).filter((u) => u.term_number === term).sort((a, b) => a.unit_no - b.unit_no)
    .map((u) => ({ id: u.id, title: u.title, hours: u.hours ?? "", task: u.task || "", items: items.filter((i) => i.kind !== "final" && i.unit_id === u.id).map(toB) }));
  const loose = items.filter((i) => i.kind !== "final" && !units.some((u) => u.id === i.unit_id)).map(toB);
  const finals = items.filter((i) => i.kind === "final").map((i) => ({ ...toB(i), inds: (i.indicators || []).map((x) => ({ code: x.code || "", title: x.title })) }));
  const fT = 50 - data.course.collect_ratio / 2;
  if (!units.length) units.push({ id: null, title: "", hours: "", task: "", items: [] });
  if (!finals.length) finals.push({ id: null, code: "", title: `สอบปลายภาคเรียนที่ ${term}`, max: fT, inds: [] });
  builder = { term, units, loose, finals, dirty: false };
  const draft = readDraft(term);
  if (draft) {
    const use = resume || (await dialog({ title: "พบร่างที่ยังไม่บันทึก", okText: "ใช้ร่างต่อ", cancelText: "เปิดฉบับที่บันทึกไว้",
      body: `<p>มีร่างโครงสร้างภาคเรียนที่ ${term} ที่แก้ค้างไว้เมื่อ ${esc(whenText(draft.at))} แต่ยังไม่ได้กดบันทึก${draft.from ? ` (ดึงมาจาก ${esc(draft.from)})` : ""}</p>
        <p class="muted small">ถ้าเปิดฉบับที่บันทึกไว้ ร่างนี้จะยังอยู่จนกว่าจะเริ่มแก้ใหม่</p>` })).ok;
    if (use) builder = { term, ...sanitizeDraft(draft, term), dirty: true };
  }
  try { sessionStorage.setItem(openKey, String(term)); } catch { /* */ }
  tab = "setup"; renderTabs(); drawBuilder();
  window.scrollTo({ top: 0 });
}
function closeBuilder(discard) {
  if (discard && builder) clearDraft(builder.term);
  builder = null;
  try { sessionStorage.removeItem(openKey); } catch { /* */ }
}

// ดึงโครงสร้างของห้องอื่น/ปีก่อนมาเป็นร่างในหน้าสร้างโครงสร้าง (ยังไม่บันทึกจนกว่าครูจะกดบันทึก)
async function pullStructure(sourceId, term) {
  let src;
  try { src = await api(`/api/courses/${courseId}/source-structure?source=${sourceId}`); } catch (err) { showError(err); return; }
  const from = `${src.source.grade_level}/${src.source.classroom} ปีการศึกษา ${src.source.year_be}`;
  const sItems = src.items.filter((i) => i.term_number === term);
  if (!sItems.length) { toast(`${from} ไม่มีโครงสร้างภาคเรียนที่ ${term}`, "bad"); return; }
  if (builder && builder.term !== term && builder.dirty && !(await confirmBox("ปิดร่างที่เปิดอยู่", `ร่างภาคเรียนที่ ${builder.term} ยังเก็บไว้ในเบราว์เซอร์ เปิดต่อได้ภายหลัง`, "ต่อไป"))) return;
  const hasNow = data.items.some((i) => i.term_number === term) || readDraft(term);
  if (hasNow && !(await confirmBox(`ใช้โครงสร้างจาก ${from}`, `แทนที่โครงสร้างภาคเรียนที่ ${term} ในหน้าสร้างโครงสร้าง — ยังไม่บันทึกจนกว่าจะกด "บันทึกโครงสร้าง" ช่องที่ชื่อตรงกันคงคะแนนนักเรียนไว้`, "ดึงมาแก้ไข"))) return;
  try { if (!bankCache) await loadBank(); } catch { bankCache = []; }
  // ช่องที่มีอยู่แล้ว (ประเภท รหัส ชื่อตรงกัน) ใช้ id เดิม → คะแนนที่กรอกไว้ไม่หาย
  const old = data.items.filter((i) => i.term_number === term), used = new Set();
  const idOf = (it) => { const m = old.find((o) => !used.has(o.id) && o.kind === it.kind && (o.code || "") === (it.code || "") && o.title === it.title); if (m) used.add(m.id); return m?.id ?? null; };
  const oldU = (data.units || []).filter((u) => u.term_number === term), usedU = new Set();
  const toB = (i) => ({ id: idOf(i), code: i.code || "", title: i.title, max: i.max_score });
  const sUnits = src.units.filter((u) => u.term_number === term).sort((a, b) => a.unit_no - b.unit_no), keys = new Set(sUnits.map((u) => u.key));
  const units = sUnits.map((u) => { const m = oldU.find((o) => !usedU.has(o.id) && o.title === u.title); if (m) usedU.add(m.id);
    return { id: m?.id ?? null, title: u.title, hours: u.hours ?? "", task: u.task || "", items: sItems.filter((i) => i.kind !== "final" && i.unit_key === u.key).map(toB) }; });
  if (!units.length) units.push({ id: null, title: "", hours: "", task: "", items: [] });
  builder = { term, units, loose: sItems.filter((i) => i.kind !== "final" && !keys.has(i.unit_key)).map(toB),
    finals: sItems.filter((i) => i.kind === "final").map((i) => ({ ...toB(i), inds: (i.indicators || []).map((x) => ({ code: x.code || "", title: x.title })) })), dirty: false, from };
  markDirty();
  try { sessionStorage.setItem(openKey, String(term)); } catch { /* */ }
  tab = "setup"; renderTabs(); drawBuilder(); window.scrollTo({ top: 0 });
  toast(`ดึงโครงสร้างจาก ${from} แล้ว — ตรวจ/แก้ แล้วกดบันทึก`);
}

// นำโครงสร้างของห้องนี้ไปใช้กับห้องอื่นของวิชาเดียวกันที่ครูคนเดียวกันสอน
async function loadTargets() { if (!targetsCache) targetsCache = (await api(`/api/courses/${courseId}/apply-targets`)).courses; return targetsCache; }
async function applyToRooms(defaultTerms = [1, 2], { afterSave = false } = {}) {
  let targets;
  try { targets = await loadTargets(); } catch (err) { showError(err); return; }
  if (!targets.length) { if (!afterSave) toast("ไม่มีห้องอื่นของวิชานี้ที่คุณสอน", "bad"); return; }
  const has = (t) => data.items.some((i) => i.term_number === t);
  const terms = [1, 2].filter(has);
  if (!terms.length) { toast("ห้องนี้ยังไม่มีโครงสร้าง", "bad"); return; }
  const st = (c, t) => c.terms[t].scores ? `<span class="tag warn">มีคะแนนแล้ว</span>` : c.terms[t].items ? `<span class="tag">มีโครงสร้างแล้ว</span>` : `<span class="tag ok">ยังว่าง</span>`;
  const res = await dialog({
    title: afterSave ? "ใช้โครงสร้างนี้กับห้องอื่นด้วยไหม" : "นำโครงสร้างไปใช้กับห้องอื่น", okText: "นำไปใช้", cancelText: afterSave ? "ไม่ใช้" : "ยกเลิก", wide: true,
    body: `<p class="muted small" style="margin-top:0">คัดลอกหน่วยการเรียนรู้ ภาระงาน ${W} คะแนนเต็ม และสอบปลายภาคของ ${esc(data.course.grade_level)}/${esc(data.course.classroom)} ไปแทนที่ของห้องที่เลือก
        · ช่องที่ชื่อตรงกันคงคะแนนนักเรียนไว้ · คะแนนนักเรียนไม่ถูกคัดลอก</p>
      <div class="actions" style="margin-bottom:8px">${terms.map((t) => `<label class="check"><input type="checkbox" name="term${t}" ${defaultTerms.includes(t) ? "checked" : ""}> ภาคเรียนที่ ${t}</label>`).join("")}</div>
      <div style="display:grid;gap:6px">${targets.map((c) => `<label class="check pick-row"><input type="checkbox" name="c${c.id}" ${c.locked ? "disabled" : ""} ${!c.locked && !c.terms[1].scores && !c.terms[2].scores ? "checked" : ""}>
        <span><b>${esc(c.grade_level)}/${esc(c.classroom)}</b> ${c.locked ? '<span class="tag">ส่งผลแล้ว แก้ไม่ได้</span>' : terms.map((t) => `ภาค ${t} ${st(c, t)}`).join(" ")}</span></label>`).join("")}</div>`,
  });
  if (!res.ok) return;
  const body = { terms: terms.filter((t) => res.data[`term${t}`]), target_ids: targets.filter((c) => res.data[`c${c.id}`]).map((c) => c.id) };
  if (!body.terms.length || !body.target_ids.length) { toast("เลือกภาคเรียนและห้องก่อน", "bad"); return; }
  let r;
  try { r = await api(`/api/courses/${courseId}/apply-to`, { method: "POST", body }); }
  catch (err) {
    if (!err.data?.needs_confirm) { showError(err); return; }
    const list = err.data.blocked.map((x) => `<li>${esc(x.room)} ภาค ${x.term}: ${esc(x.items.join(", "))}</li>`).join("");
    if (!(await confirmBox("มีคะแนนนักเรียนในช่องที่จะถูกแทนที่", `ช่องต่อไปนี้ไม่มีในโครงสร้างใหม่ ถ้านำไปใช้ คะแนนของช่องเหล่านี้จะถูกลบถาวร<ul>${list}</ul>`, "นำไปใช้และลบคะแนน", true))) return;
    try { r = await api(`/api/courses/${courseId}/apply-to`, { method: "POST", body: { ...body, confirm: true } }); } catch (e2) { showError(e2); return; }
  }
  targetsCache = null;
  toast(`นำโครงสร้างไปใช้กับ ${r.applied.join(", ")} แล้ว`);
  if (!builder && tab === "setup") renderSetup();
}

function builderTotals() {
  const all = [...builder.units.flatMap((u) => u.items), ...builder.loose];
  return { collect: r2(all.reduce((a, i) => a + (Number(i.max) || 0), 0)), final: r2(builder.finals.reduce((a, i) => a + (Number(i.max) || 0), 0)), count: all.length };
}

function drawBuilder() {
  const B = builder, c = data.course, cT = c.collect_ratio / 2, fT = 50 - cT;
  const itemRow = (it, where, idx) => { const k = bankKindOf(it); return `<div class="b-item">
      <span class="code">${esc(it.code || "–")}</span>
      <span>${esc(it.title)}${k && !k.startsWith("ผล") ? ` <span class="tag ${k === "ปลายทาง" ? "ok" : ""}">${esc(k)}</span>` : ""}</span>
      <label class="b-max">เต็ม<input inputmode="decimal" data-max="${where}:${idx}" value="${esc(it.max ?? "")}" aria-label="คะแนนเต็ม ${esc(it.code || it.title)}"></label>
      <button type="button" class="icon-btn" data-rm="${where}:${idx}" aria-label="เอาออก">✕</button></div>`; };
  view.innerHTML = `
    <div class="panel builder">
      <div class="panel-head"><h2>สร้างโครงสร้างรายวิชา — ภาคเรียนที่ ${B.term}</h2><button class="btn small" id="bBack">← กลับ</button></div>
      ${B.from ? `<p class="note" style="margin:0 0 8px">ดึงโครงสร้างมาจาก ${esc(B.from)} — ตรวจและปรับให้เหมาะกับห้องนี้ แล้วกด "บันทึกโครงสร้าง"</p>` : ""}
      <p class="muted small" style="margin-top:0">${esc(c.code || "")} ${esc(c.name)} ${esc(c.grade_level)}/${esc(c.classroom)} ·
        1) พิมพ์ชื่อหน่วยการเรียนรู้ ชั่วโมง และภาระงาน/ชิ้นงาน 2) กด "เลือก${W}" ของแต่ละหน่วย 3) ใส่คะแนนเต็ม — คะแนนเก็บรวม ${fmt(cT)} · สอบปลายภาค ${fmt(fT)}</p>
      ${bankCache.length ? "" : `<p class="note warn">ยังไม่มี${W}ของวิชานี้ในคลัง — พิมพ์${W}เองได้ในหน้าต่างเลือก${W} หรือแจ้งฝ่ายวัดผลให้นำเข้าคลัง</p>`}
    </div>
    ${B.units.map((u, ui) => `<div class="panel b-unit">
      <div class="unit-head"><b>หน่วยการเรียนรู้ที่ ${ui + 1}</b><span class="actions">
        <button type="button" class="btn small" data-mv="${ui}:-1" ${ui ? "" : "disabled"} aria-label="เลื่อนขึ้น">↑</button>
        <button type="button" class="btn small" data-mv="${ui}:1" ${ui < B.units.length - 1 ? "" : "disabled"} aria-label="เลื่อนลง">↓</button>
        <button type="button" class="btn small danger" data-udel="${ui}">ลบหน่วย</button></span></div>
      <div class="b-grid">
        <label class="field">ชื่อหน่วยการเรียนรู้<input data-uf="${ui}:title" maxlength="300" value="${esc(u.title)}" placeholder="เช่น ภาษาไทยของเรา"></label>
        <label class="field">จำนวนชั่วโมง<input data-uf="${ui}:hours" inputmode="decimal" value="${esc(u.hours)}"></label>
      </div>
      <label class="field" style="margin-top:10px">ภาระงาน / ชิ้นงาน<textarea data-uf="${ui}:task" maxlength="500" placeholder="เช่น ใบงานการอ่านจับใจความ, แผนภาพโครงเรื่อง">${esc(u.task)}</textarea></label>
      <div class="b-items">${u.items.map((it, ii) => itemRow(it, `u${ui}`, ii)).join("") || `<p class="muted small" style="margin:0">ยังไม่ได้เลือก${W}</p>`}</div>
      <button type="button" class="btn small primary" data-pick="${ui}" style="margin-top:8px">${ICONS.plus} เลือก${W}</button>
    </div>`).join("")}
    ${B.loose.length ? `<div class="panel b-unit"><div class="unit-head"><b>${W}ที่ยังไม่อยู่ในหน่วยใด</b><span class="muted small">เลือกเข้าหน่วยได้จากปุ่ม "เลือก${W}" ของหน่วยนั้น</span></div>
      <div class="b-items">${B.loose.map((it, ii) => itemRow(it, "loose", ii)).join("")}</div></div>` : ""}
    <div class="actions" style="margin:4px 0 16px"><button type="button" class="btn" id="bAddUnit">${ICONS.plus} เพิ่มหน่วยการเรียนรู้</button></div>
    <div class="panel"><div class="panel-head"><h2>สอบปลายภาค</h2><button type="button" class="btn small" id="bAddFinal">${ICONS.plus} เพิ่มการสอบ</button></div>
      <div class="b-items">${B.finals.map((it, ii) => `<div class="b-item">
        <span class="code">สอบปลายภาค</span><input data-ft="${ii}" maxlength="500" value="${esc(it.title)}" aria-label="ชื่อการสอบ">
        <label class="b-max">เต็ม<input inputmode="decimal" data-max="final:${ii}" value="${esc(it.max ?? "")}"></label>
        <button type="button" class="icon-btn" data-rm="final:${ii}" aria-label="เอาออก">✕</button></div>
        <div class="f-inds"><span class="muted small">${W}${finalKindLabel()}ที่สอบ:</span>
          ${(it.inds || []).map((x, xi) => `<span class="chip" title="${esc(x.title)}">${esc(x.code || x.title.slice(0, 24))}<button type="button" data-frm="${ii}:${xi}" aria-label="เอาออก">✕</button></span>`).join("") || `<span class="tag warn">ยังไม่ได้เลือก</span>`}
          <button type="button" class="btn small primary" data-fpick="${ii}">${ICONS.plus} เลือก${W}${finalKindLabel()}</button></div>`).join("") || '<p class="muted small" style="margin:0">ไม่มีการสอบปลายภาค</p>'}</div></div>
    <div class="b-foot"><span><span id="bTotals"></span><span class="muted small" id="bDraft" style="display:block;margin-top:2px">${draftNote()}</span></span><span class="actions">
      <button type="button" class="btn" id="bSplit" title="แบ่งคะแนนเก็บ ${fmt(cT)} คะแนนให้ทุก${W}เท่า ๆ กัน">แบ่งคะแนนเก็บเท่ากัน</button>
      <button type="button" class="btn primary" id="bSave">บันทึกโครงสร้าง</button></span></div>`;
  const totals = () => {
    const t = builderTotals(), ok = t.collect === cT && t.final === fT;
    document.getElementById("bTotals").innerHTML = `<span class="tag ${t.collect === cT ? "ok" : "warn"}">คะแนนเก็บ ${fmt(t.collect)}/${fmt(cT)} (${t.count} ${W})</span>
      <span class="tag ${t.final === fT ? "ok" : "warn"}">ปลายภาค ${fmt(t.final)}/${fmt(fT)}</span>${ok ? "" : ' <span class="muted small">บันทึกได้ แต่ต้องรวมให้พอดีก่อนส่งผล</span>'}`;
  };
  totals();
  const at = (ref) => { const [w, i] = ref.split(":"); const list = w === "loose" ? B.loose : w === "final" ? B.finals : B.units[Number(w.slice(1))].items; return [list, Number(i)]; };
  view.oninput = (e) => {
    if (!builder) return;
    const el = e.target;
    if (el.dataset.uf) { const [ui, f] = el.dataset.uf.split(":"); B.units[ui][f] = el.value; markDirty(); }
    else if (el.dataset.max) { const [list, i] = at(el.dataset.max); list[i].max = el.value.trim(); markDirty(); totals(); }
    else if (el.dataset.ft) { B.finals[Number(el.dataset.ft)].title = el.value; markDirty(); }
  };
  for (const b of view.querySelectorAll("[data-rm]")) b.onclick = () => { const [list, i] = at(b.dataset.rm); list.splice(i, 1); markDirty(); drawBuilder(); };
  for (const b of view.querySelectorAll("[data-udel]")) b.onclick = async () => {
    const u = B.units[Number(b.dataset.udel)];
    if ((u.title || u.items.length) && !(await confirmBox("ลบหน่วยการเรียนรู้", u.items.length ? `${W}ในหน่วยนี้ ${u.items.length} ข้อจะย้ายไปอยู่กลุ่ม "ยังไม่อยู่ในหน่วยใด"` : "ลบหน่วยนี้", "ลบหน่วย", true))) return;
    B.loose.push(...u.items); B.units.splice(Number(b.dataset.udel), 1); markDirty(); drawBuilder();
  };
  for (const b of view.querySelectorAll("[data-mv]")) b.onclick = () => { const [ui, d] = b.dataset.mv.split(":").map(Number); const [u] = B.units.splice(ui, 1); B.units.splice(ui + d, 0, u); markDirty(); drawBuilder(); };
  for (const b of view.querySelectorAll("[data-pick]")) b.onclick = () => pickIndicators(Number(b.dataset.pick));
  document.getElementById("bAddUnit").onclick = () => { B.units.push({ id: null, title: "", hours: "", task: "", items: [] }); markDirty(); drawBuilder(); view.querySelectorAll(".b-unit")[B.units.length - 1]?.scrollIntoView({ block: "center" }); };
  document.getElementById("bAddFinal").onclick = () => { B.finals.push({ id: null, code: "", title: `สอบปลายภาคเรียนที่ ${B.term}`, max: "", inds: [] }); markDirty(); drawBuilder(); };
  for (const b of view.querySelectorAll("[data-fpick]")) b.onclick = () => pickFinalIndicators(Number(b.dataset.fpick));
  for (const b of view.querySelectorAll("[data-frm]")) b.onclick = () => { const [fi, i] = b.dataset.frm.split(":").map(Number); B.finals[fi].inds.splice(i, 1); markDirty(); drawBuilder(); };
  document.getElementById("bSplit").onclick = () => {
    const all = [...B.units.flatMap((u) => u.items), ...B.loose];
    if (!all.length) { toast(`ยังไม่ได้เลือก${W}`, "bad"); return; }
    const each = Math.floor((cT / all.length) * 100) / 100;
    all.forEach((it, i) => { it.max = String(i === all.length - 1 ? r2(cT - each * (all.length - 1)) : each); });
    markDirty(); drawBuilder();
  };
  document.getElementById("bBack").onclick = async () => {
    if (B.dirty) {
      const r = await dialog({ title: "ยังไม่ได้บันทึกโครงสร้าง", okText: "ทิ้งร่าง", okClass: "danger", cancelText: "เก็บร่างไว้ก่อน",
        body: `<p>สิ่งที่แก้ยังไม่ถูกบันทึกเข้าระบบ</p><p class="muted small">"เก็บร่างไว้ก่อน" = ออกจากหน้านี้ ร่างยังอยู่ในเบราว์เซอร์นี้ กดแก้ไขโครงสร้างภาค ${B.term} เพื่อทำต่อได้</p>` });
      closeBuilder(r.ok);
    } else closeBuilder(false);
    render();
  };
  document.getElementById("bSave").onclick = () => saveBuilder();
}

async function pickIndicators(ui) {
  const B = builder, u = B.units[ui];
  const where = new Map(); // itemKey → ข้อความบอกว่าอยู่ที่ไหน
  B.units.forEach((x, i) => { if (i !== ui) for (const it of x.items) where.set(itemKey(it), `หน่วยที่ ${i + 1}`); });
  const mine = new Set(u.items.map(itemKey)), loose = new Set(B.loose.map(itemKey));
  // ตัวชี้วัดที่เคยบันทึกในรายวิชาแต่ไม่อยู่ในคลัง ก็ให้เห็นในรายการด้วย
  const extra = [...u.items, ...B.loose].filter((it) => !bankCache.some((b) => itemKey(b) === itemKey(it))).map((it) => ({ code: it.code, title: it.title, kind: "" }));
  const list = [...bankCache, ...extra];
  const groups = KIND_GROUPS.map(([k, label]) => [label, list.filter((b) => (b.kind || "") === k)]).filter(([, l]) => l.length);
  const row = (b, i) => { const k = itemKey(b), other = where.get(k);
    return `<label class="check pick-row"><input type="checkbox" name="p${i}" ${mine.has(k) ? "checked" : ""} ${other ? "disabled" : ""}>
      <span><b>${esc(b.code || "")}</b> ${esc(b.title)}${other ? ` <span class="tag">อยู่ใน${other}</span>` : loose.has(k) ? ' <span class="tag warn">ยังไม่อยู่ในหน่วย</span>' : ""}</span></label>`; };
  let idx = 0; const flatList = [];
  const res = await dialog({
    title: `เลือก${W} — หน่วยที่ ${ui + 1}${u.title ? ` ${u.title}` : ""}`, wide: true, okText: "ใช้ที่เลือก",
    body: `${groups.length ? groups.map(([label, l]) => `<div class="pick-group"><div class="pick-head"><b>${esc(label)}</b> <span class="muted small">${l.length} ข้อ</span>
        <button type="button" class="btn small" data-gall>เลือกทั้งกลุ่ม</button></div>
        <div style="display:grid;gap:6px">${l.map((b) => { flatList.push(b); return row(b, idx++); }).join("")}</div></div>`).join("")
        : `<p class="muted">ยังไม่มี${W}ของวิชานี้ในคลัง</p>`}
      <details class="pick-group" ${groups.length ? "" : "open"}><summary>พิมพ์${W}เอง (ไม่มีในคลัง)</summary>
        <p class="muted small">บรรทัดละ 1 ข้อ เช่น <code>ท 1.1 ป.4/1 อ่านออกเสียงบทร้อยแก้ว…</code></p>
        <textarea name="typed" placeholder="รหัส ข้อความ"></textarea></details>`,
    onOpen: (d) => { for (const b of d.querySelectorAll("[data-gall]")) b.onclick = () => { for (const x of b.closest(".pick-group").querySelectorAll("input[type=checkbox]:not(:disabled)")) x.checked = true; }; },
  });
  if (!res.ok) return;
  const chosen = flatList.filter((b, i) => res.data[`p${i}`]);
  const keepKeys = new Set(chosen.map(itemKey));
  const old = new Map([...u.items, ...B.loose].map((it) => [itemKey(it), it]));
  // ตัวชี้วัดที่ติ๊กออกจากหน่วยนี้ → ลบออกจากโครงสร้าง · ที่เลือกจากกลุ่มยังไม่อยู่ในหน่วย → ย้ายเข้าหน่วยนี้ (คงคะแนนเต็มเดิม)
  u.items = chosen.map((b) => old.get(itemKey(b)) || { id: null, code: b.code || "", title: b.title, max: "" });
  B.loose = B.loose.filter((it) => !keepKeys.has(itemKey(it)));
  for (const r of parseIndicatorLines(res.data.typed || "")) if (!u.items.some((x) => itemKey(x) === itemKey(r))) u.items.push({ id: null, code: r.code || "", title: r.title, max: "" });
  markDirty(); drawBuilder();
}

// ป.4–6 มีตัวชี้วัดปลายทาง → สอบปลายภาควัดเฉพาะปลายทาง · ป.1–3 (ผลการเรียนรู้/ผลลัพธ์) ไม่แบ่งประเภท
const hasFinalKind = () => (bankCache || []).some((b) => b.kind === "ปลายทาง");
const finalKindLabel = () => (hasFinalKind() ? "ปลายทาง" : "");

async function pickFinalIndicators(fi) {
  const B = builder, f = B.finals[fi];
  const pool = new Map();
  const add = (x) => { const k = itemKey(x); if (!pool.has(k)) pool.set(k, { code: x.code || "", title: x.title, kind: bankKindOf(x) }); };
  for (const b of bankCache) if (!hasFinalKind() || b.kind === "ปลายทาง") add(b);
  // ปลายทางที่ใช้ในหน่วยของภาคนี้ (กรณีพิมพ์เอง ไม่มีในคลัง) และที่เคยเลือกไว้
  for (const it of [...B.units.flatMap((u) => u.items), ...B.loose]) if (!hasFinalKind() || bankKindOf(it) === "ปลายทาง" || !bankKindOf(it)) add(it);
  for (const x of f.inds || []) add(x);
  const list = [...pool.values()];
  const inTerm = new Set([...B.units.flatMap((u) => u.items), ...B.loose].map(itemKey));
  const chosen = new Set((f.inds || []).map(itemKey));
  const res = await dialog({
    title: `${W}${finalKindLabel()}ที่วัดด้วย${f.title || "สอบปลายภาค"}`, wide: true, okText: "ใช้ที่เลือก",
    body: list.length ? `<div class="actions" style="margin-bottom:8px"><button type="button" class="btn small" data-term>เฉพาะที่อยู่ในหน่วยของภาคนี้</button>
        <button type="button" class="btn small" data-all>เลือกทั้งหมด</button><button type="button" class="btn small" data-none>ล้าง</button></div>
      <div style="display:grid;gap:6px">${list.map((b, i) => `<label class="check pick-row"><input type="checkbox" name="f${i}" data-in="${inTerm.has(itemKey(b)) ? 1 : 0}" ${chosen.has(itemKey(b)) ? "checked" : ""}>
        <span><b>${esc(b.code)}</b> ${esc(b.title)}${inTerm.has(itemKey(b)) ? ' <span class="tag ok">อยู่ในหน่วยของภาคนี้</span>' : ""}</span></label>`).join("")}</div>`
      : `<p class="muted">ยังไม่มี${W}${finalKindLabel()}ของวิชานี้ในคลัง — เลือก${W}ในหน่วยการเรียนรู้ก่อน แล้วกลับมาเลือกที่นี่</p>`,
    onOpen: (d) => {
      const boxes = () => [...d.querySelectorAll("input[type=checkbox]")];
      d.querySelector("[data-all]")?.addEventListener("click", () => boxes().forEach((x) => { x.checked = true; }));
      d.querySelector("[data-none]")?.addEventListener("click", () => boxes().forEach((x) => { x.checked = false; }));
      d.querySelector("[data-term]")?.addEventListener("click", () => boxes().forEach((x) => { x.checked = x.dataset.in === "1"; }));
    },
  });
  if (!res.ok) return;
  f.inds = list.filter((b, i) => res.data[`f${i}`]).map((b) => ({ code: b.code, title: b.title }));
  markDirty(); drawBuilder();
}

async function saveBuilder(confirm = false) {
  const B = builder;
  const noInd = B.finals.findIndex((f) => !(f.inds || []).length);
  if (noInd >= 0) { toast(`เลือก${W}${finalKindLabel()}ที่วัดด้วย "${B.finals[noInd].title || "สอบปลายภาค"}" ก่อนบันทึก`, "bad"); view.querySelector(`[data-fpick="${noInd}"]`)?.scrollIntoView({ block: "center" }); return; }
  const bad = B.units.findIndex((u) => !String(u.title).trim());
  if (bad >= 0) { toast(`กรุณาพิมพ์ชื่อหน่วยการเรียนรู้ที่ ${bad + 1}`, "bad"); view.querySelector(`[data-uf="${bad}:title"]`)?.focus(); return; }
  const noMax = [...B.units.flatMap((u) => u.items), ...B.loose, ...B.finals].find((it) => !(Number(it.max) > 0));
  if (noMax) { toast(`ใส่คะแนนเต็มของ "${(noMax.code || noMax.title).slice(0, 30)}" ก่อน`, "bad"); return; }
  const it = (x) => ({ id: x.id, code: x.code, title: x.title, max_score: x.max });
  const body = { term: B.term, confirm, units: B.units.map((u) => ({ id: u.id, title: u.title, hours: u.hours, task: u.task, items: u.items.map(it) })), loose: B.loose.map(it),
    finals: B.finals.map((f) => ({ ...it(f), indicators: f.inds || [] })) };
  await flush();
  try {
    data = await api(`/api/courses/${courseId}/structure`, { method: "PUT", body });
  } catch (err) {
    if (err.data?.needs_confirm && !confirm) {
      if (await confirmBox("มีคะแนนนักเรียนในช่องที่เอาออก", esc(err.message), "บันทึกและลบคะแนน", true)) return saveBuilder(true);
      return;
    }
    showError(err); return;
  }
  const savedTerm = B.term;
  closeBuilder(true); targetsCache = null; toast("บันทึกโครงสร้างรายวิชาแล้ว"); render();
  // มีห้องอื่นของวิชาเดียวกันที่สอน → ถามว่าจะใช้โครงสร้างนี้ด้วยไหม
  try { if ((await loadTargets()).some((c) => !c.locked)) applyToRooms([savedTerm], { afterSave: true }); } catch { /* */ }
}

// รีเฟรชระหว่างอยู่ในหน้าสร้างโครงสร้าง → เปิดร่างเดิมต่อทันที
{ let t = null; try { t = Number(sessionStorage.getItem(openKey)) || null; } catch { /* */ }
  if (t && editable() && readDraft(t)) openBuilder(t, { resume: true }); }
