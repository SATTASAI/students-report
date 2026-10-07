import { shell, api, esc, toast, showError, gradeBadge, dialog, confirmBox, fmt, ICONS, params, withYear } from "/js/app.js";
import { computeStudentResult, NUMERIC_GRADES, indicatorWord, indicatorResult, structureIssues } from "/js/grading.js";
import { parseIndicatorLines } from "/js/indicators.js";

const me = await shell("home");
const courseId = params().get("id");
const view = document.getElementById("view");
let data;              // ข้อมูลจาก /api/courses/:id
let tab = sessionStorage.getItem(`sr-tab-${courseId}`) || "t1";
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
  if (pending.size || saving) { e.preventDefault(); e.returnValue = ""; }
});

// ---------------- ส่วนหัว ----------------
function renderHeader() {
  const c = data.course;
  document.title = `${c.code} ${c.name} ${c.grade_level}/${c.classroom} — สมุดคะแนน`;
  document.getElementById("title").textContent = `${c.code} ${c.name}`;
  document.getElementById("meta").textContent =
    `${c.grade_level}/${c.classroom} · ปีการศึกษา ${c.year_be} · ${c.hours_per_year} ชม./ปี · คะแนนเก็บ ${c.collect_ratio} : ปลายภาค ${100 - c.collect_ratio}` +
    (c.teachers.length ? ` · ครูผู้สอน ${c.teachers.map((t) => t.full_name).join(", ")}` : "");
  document.getElementById("backLink").href = withYear("/", c.academic_year_id);
  const pb = document.getElementById("printBtn");
  pb.innerHTML = `${ICONS.print} พิมพ์ ปพ.5`;
  pb.href = `/print/pp5.html?course=${c.id}`;
  const sb = document.getElementById("submitBtn");
  const note = document.getElementById("lockNote");
  if (c.locked) {
    sb.innerHTML = data.is_admin ? `${ICONS.lock} ปลดล็อกให้แก้ไข` : `${ICONS.lock} ยืนยันผลแล้ว`;
    sb.disabled = !data.is_admin;
    sb.onclick = unlock;
    note.hidden = false;
    note.textContent = data.is_admin ? "รายวิชานี้ยืนยันผลแล้ว ครูแก้ไขไม่ได้จนกว่าผู้ดูแลจะปลดล็อก" : "รายวิชานี้ยืนยันผลแล้ว หากต้องแก้ไขให้ติดต่อฝ่ายวัดผล";
  } else {
    sb.innerHTML = `${ICONS.lock} ยืนยันผลการเรียน`;
    sb.disabled = !c.can_edit;
    sb.onclick = submitCourse;
    note.hidden = c.can_edit;
    note.textContent = "ปิดระบบการกรอกคะแนนของปีการศึกษานี้แล้ว";
  }
}

function renderTabs() {
  for (const b of document.querySelectorAll("#tabs button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    b.onclick = () => { tab = b.dataset.tab; sessionStorage.setItem(`sr-tab-${courseId}`, tab); renderTabs(); render(); };
  }
}

function render() {
  if (tab === "t1" || tab === "t2") renderSheet(tab === "t1" ? 1 : 2);
  else if (tab === "sum") renderSummary();
  else renderSetup();
}

const editable = () => data.course.can_edit && !data.course.locked;
const settingsForCalc = () => ({
  collect_ratio: data.course.collect_ratio, hours_per_year: data.course.hours_per_year,
  attendance_pass_pct: data.settings.attendance_pass_pct, indicator_pass_pct: data.settings.indicator_pass_pct,
});
const studentScores = (sid) => data.scores[sid] || (data.scores[sid] = {});
function recompute(sid) {
  data.computed[sid] = computeStudentResult(data.items, studentScores(sid), data.results[sid] || {}, settingsForCalc());
  return data.computed[sid];
}
const statusTag = (s) => s.enrollment_status === "transferred" ? ' <span class="tag warn">ย้ายออก</span>'
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
      <span class="muted small">${can ? "พิมพ์คะแนนแล้วกด Enter เพื่อลงไปคนถัดไป · คัดลอกช่วงคะแนนจาก Excel มาวางได้ · บันทึกอัตโนมัติ" : "ดูได้อย่างเดียว"}</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap">
      <table class="sheet" id="sheet">
        <thead><tr>
          <th class="stick no col-head">เลขที่</th>
          <th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
          ${items.map((it) => `<th class="col-head ${it.kind === "final" ? "final" : ""}" title="${esc(it.title)}">
            <button data-edit-item="${it.id}" ${can ? "" : "disabled"}><span class="code">${esc(it.kind === "final" ? "ปลายภาค" : it.code || "เก็บ")}</span><span class="t">${esc(it.title)}</span><span class="max">เต็ม ${fmt(it.max_score)}</span></button></th>`).join("")}
          <th class="col-head">รวมภาค ${term}<span class="max">เต็ม ${fmt(termMax)}</span></th>
          <th class="col-head">รวมทั้งปี<span class="max">เต็ม 100</span></th>
          <th class="col-head">ผล</th>
        </tr></thead>
        <tbody>${data.students.map((s) => rowHtml(s, items, term)).join("")}</tbody>
        <tfoot><tr><td class="stick no"></td><td class="stick name" style="text-align:left">ค่าเฉลี่ย</td>${items.map((it) => `<td data-avg="${it.id}"></td>`).join("")}<td></td><td></td><td></td></tr></tfoot>
      </table>
    </div>
    <div class="legend"><span><b style="color:var(--warn)">ตัวเลขสีส้ม</b> = ต่ำกว่าเกณฑ์ผ่าน${W} ${data.settings.indicator_pass_pct}%</span><span>ช่องว่าง = ยังไม่ได้กรอก (ผลจะเป็น ร จนกว่าจะครบ)</span></div>`;
  updateAverages(items);
  bindSheet(items, term);
  for (const b of view.querySelectorAll("[data-edit-item]")) b.onclick = () => editItem(Number(b.dataset.editItem));
  showSaveState();
}

function rowHtml(s, items, term) {
  const sc = studentScores(s.id);
  const calc = data.computed[s.id];
  const inactive = s.enrollment_status !== "enrolled";
  const termSum = items.reduce((a, i) => a + (sc[i.id] == null ? 0 : Number(sc[i.id])), 0);
  return `<tr data-sid="${s.id}" class="${inactive ? "inactive" : ""}">
    <td class="stick no">${s.number ?? ""}</td>
    <td class="stick name" title="${esc(s.name)}">${esc(s.name)}${statusTag(s)}</td>
    ${items.map((it) => {
      const v = sc[it.id];
      const low = it.kind === "indicator" && indicatorResult(it, v, data.settings) === "มผ";
      return `<td class="cell ${it.kind === "final" ? "final" : ""} ${low ? "low" : ""}"><input inputmode="decimal" autocomplete="off" aria-label="${esc(s.name)} ${esc(it.title)}"
        data-item="${it.id}" data-max="${it.max_score}" value="${v == null ? "" : fmt(v)}" ${editable() ? "" : "readonly"}></td>`;
    }).join("")}
    <td class="calc" data-termsum>${fmt(termSum)}</td>
    <td class="calc" data-total>${calc.total == null ? "–" : fmt(calc.total)}</td>
    <td class="calc grade-col" data-grade>${sheetGrade(calc)}</td>
  </tr>`;
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

  table.addEventListener("focusin", (e) => { if (e.target.matches("input")) e.target.select(); });
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
    const rows = textData.replace(/\r/g, "").replace(/\n+$/, "").split("\n").map((r) => r.split("\t"));
    const all = inputs();
    const start = all.indexOf(t);
    const r0 = Math.floor(start / cols), c0 = start % cols;
    let count = 0, skipped = 0;
    rows.forEach((row, dr) => row.forEach((val, dc) => {
      const target = all[(r0 + dr) * cols + (c0 + dc)];
      if (!target || c0 + dc >= cols) { skipped++; return; }
      target.value = val.trim();
      acceptCell(target, items, term);
      count++;
    }));
    toast(`วางคะแนน ${count} ช่อง${skipped ? ` (ข้อมูลเกินตาราง ${skipped} ช่องไม่ได้วาง)` : ""}`);
  });
}

function parseScore(raw) {
  const v = String(raw).trim().replace(",", ".");
  if (v === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(v)) return { ok: false };
  return { ok: true, value: Math.round(Number(v) * 100) / 100 };
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
    input.title = !p.ok ? "กรอกได้เฉพาะตัวเลข" : `เกินคะแนนเต็ม ${fmt(max)}`;
    return;
  }
  markCell(input, true);
  input.title = "";
  const sc = studentScores(sid);
  if (p.value == null) delete sc[itemId]; else sc[itemId] = p.value;
  const item = data.items.find((i) => i.id === itemId);
  input.parentElement.classList.toggle("low", item.kind === "indicator" && indicatorResult(item, p.value, data.settings) === "มผ");
  pending.set(`${itemId}:${sid}`, p.value);
  const calc = recompute(sid);
  tr.querySelector("[data-termsum]").textContent = fmt(items.reduce((a, i) => a + (sc[i.id] == null ? 0 : Number(sc[i.id])), 0));
  tr.querySelector("[data-total]").textContent = calc.total == null ? "–" : fmt(calc.total);
  tr.querySelector("[data-grade]").innerHTML = sheetGrade(calc);
  updateAverages(items);
  scheduleSave();
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
    // คืนรายการที่ยังไม่บันทึก (ถ้ามีการแก้ใหม่ระหว่างนั้น ให้ใช้ค่าใหม่)
    for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v);
    saving = false;
    showSaveState(err);
    if (err.data?.errors) {
      const first = err.data.errors[0];
      showError(`${err.message}: ${first.error}`);
    } else showError(err);
    if (err.status === 409) { pending.clear(); setTimeout(() => location.reload(), 2500); return; }
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
  else el.textContent = "บันทึกแล้ว";
}

// ---------------- สรุปผล / เวลาเรียน / ร มส / แก้ตัว ----------------
function renderSummary() {
  const c = data.course;
  const can = editable();
  const need = c.hours_per_year * data.settings.attendance_pass_pct / 100;
  const counts = {};
  for (const s of data.students) if (s.enrollment_status === "enrolled") { const g = data.computed[s.id].grade ?? "–"; counts[g] = (counts[g] || 0) + 1; }
  view.innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div class="actions">${[...NUMERIC_GRADES, "ร", "มส"].map((g) => `<span>${gradeBadge(g)} <span class="num">${counts[g] || 0}</span></span>`).join("")}</div>
      <p class="muted small" style="margin:10px 0 0">เวลาเรียนเต็ม ${c.hours_per_year} ชม. ต้องมาเรียนอย่างน้อย ${fmt(need, 1)} ชม. (${data.settings.attendance_pass_pct}%) — ช่องเวลาเรียนที่เว้นว่างถือว่ามาเรียนครบ
        · คะแนนรวมไม่ปัดเศษ เช่น 79.99 ได้เกรด 3.5</p>
    </div>
    <div class="table-wrap">
      <table class="list">
        <thead><tr><th class="num">เลขที่</th><th>ชื่อ–สกุล</th><th class="num">เก็บ (${c.collect_ratio})</th><th class="num">ปลายภาค (${100 - c.collect_ratio})</th>
          <th class="num">รวม</th><th>เวลาเรียน (ชม.)</th><th>ผลพิเศษ</th><th>ผลเดิม</th><th>แก้ไข/ซ่อม</th><th>ผลการเรียน</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${data.students.map((s) => {
          const k = data.computed[s.id], r = data.results[s.id] || {};
          const failed = k.failed_indicators.length;
          return `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "muted" : ""}">
            <td class="num">${s.number ?? ""}</td><td>${esc(s.name)}${statusTag(s)}</td>
            <td class="num">${fmt(k.collect_scaled)}</td><td class="num">${fmt(k.final_scaled)}</td><td class="num"><b>${k.total == null ? "–" : fmt(k.total)}</b></td>
            <td><input style="width:86px" inputmode="decimal" data-hours value="${r.hours_attended ?? ""}" placeholder="${c.hours_per_year}" ${can ? "" : "disabled"} aria-label="เวลาเรียน ${esc(s.name)}"></td>
            <td><select data-special style="width:80px" ${can ? "" : "disabled"} aria-label="ผลพิเศษ ${esc(s.name)}"><option value="">–</option><option ${r.special === "ร" ? "selected" : ""}>ร</option><option ${r.special === "มส" ? "selected" : ""}>มส</option></select></td>
            <td>${gradeBadge(k.original_grade)}</td>
            <td>${r.remedial_grade ? `<span class="tag">${r.remedial_type === "repeat" ? "เรียนซ้ำ" : "แก้ตัว"} → ${esc(r.remedial_grade)}</span> ` : ""}
              ${can && (["0", "ร", "มส"].includes(k.original_grade) || r.remedial_grade) ? `<button class="btn small" data-remedial>${r.remedial_grade ? "แก้ไข" : "บันทึกผลแก้ตัว"}</button>` : ""}</td>
            <td>${gradeBadge(k.grade)}</td>
            <td class="small muted">${[k.reason, failed ? `ไม่ผ่าน ${failed} ${W}` : ""].filter(Boolean).map(esc).join(" · ")}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
  if (!can) return;
  for (const tr of view.querySelectorAll("tbody tr")) {
    const sid = Number(tr.dataset.sid);
    tr.querySelector("[data-hours]").onchange = (e) => saveResult({ student_id: sid, hours_attended: e.target.value.trim() });
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

// ---------------- โครงสร้างคะแนน ----------------
function renderSetup() {
  const c = data.course;
  const can = editable();
  const sum = (term, kind) => data.items.filter((i) => (!term || i.term_number === term) && i.kind === kind).reduce((a, i) => a + i.max_score, 0);
  const cT = c.collect_ratio / 2, fT = 50 - cT;
  const issues = structureIssues(data.items, c.collect_ratio, W).filter((x) => x.startsWith("ภาค"));
  const termLine = (t) => {
    const has = data.items.some((i) => i.term_number === t);
    if (!has) return "";
    const ci = Math.round(sum(t, "indicator") * 100) / 100, fi = Math.round(sum(t, "final") * 100) / 100;
    const ok = !issues.some((x) => x.startsWith(`ภาค ${t}`));
    return `<span class="tag ${ok ? "ok" : "warn"}">${W} ${fmt(ci)}/${fmt(cT)} · ปลายภาค ${fmt(fi)}/${fmt(fT)}</span>`;
  };
  const list = (term) => {
    const items = data.items.filter((i) => i.term_number === term);
    return items.length ? items.map((it) => `<div class="item ${it.kind}">
        <span class="code">${esc(it.kind === "final" ? "สอบปลายภาค" : it.code || "คะแนนเก็บ")}</span>
        <span>${esc(it.title)}</span><span class="num">เต็ม ${fmt(it.max_score)}</span>
        <span class="actions">${can ? `<button class="btn small" data-edit="${it.id}">แก้ไข</button><button class="btn small danger" data-del="${it.id}">ลบ</button>` : ""}</span>
      </div>`).join("") : `<p class="muted small">ยังไม่มีช่องคะแนน</p>`;
  };
  view.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>สัดส่วนคะแนนต่อภาคเรียน</h2></div>
      <div class="ratio-bar"><span class="c" style="width:${c.collect_ratio}%">ระหว่างภาค ${fmt(cT)}</span><span class="f" style="width:${100 - c.collect_ratio}%">ปลายภาค ${fmt(fT)}</span></div>
      <p class="muted small">แต่ละภาคเต็ม 50 คะแนน (ทั้งปี 100) · คะแนนเต็มของ${W}รวมกันต้องเท่ากับ ${fmt(cT)} และสอบปลายภาครวม ${fmt(fT)} พอดี
        ระบบใช้คะแนนจริงตามที่กรอก ไม่ย่อขยายและไม่ปัดเศษ · ฝ่ายวิชาการเป็นผู้กำหนดสัดส่วนของแต่ละวิชา</p>
      ${issues.length ? `<p class="note warn" style="margin-top:8px">${issues.map(esc).join("<br>")}<br>แก้ให้ตรงก่อนยืนยันผล</p>` : ""}
    </div>
    ${[1, 2].map((t) => `<div class="panel">
      <div class="panel-head"><h2>ภาคเรียนที่ ${t} ${termLine(t)}</h2>${can ? `<div class="actions">
        <button class="btn small" data-add="${t}" data-kind="indicator">${ICONS.plus} ${W}</button>
        <button class="btn small" data-add="${t}" data-kind="final">${ICONS.plus} สอบปลายภาค</button>
        <button class="btn small" data-paste="${t}">วางจากหลักสูตร</button>
        <button class="btn small" data-bank="${t}">เลือกจากคลัง${W}</button></div>` : ""}</div>
      <div class="item-list">${list(t)}</div></div>`).join("")}
    ${can ? `<div class="panel"><div class="panel-head"><h2>ใช้โครงสร้างจากห้องอื่น</h2></div>
      <p class="muted small">คัดลอก${W}และคะแนนเต็มจากวิชาเดียวกันของห้องอื่นหรือปีก่อน (คัดลอกเฉพาะโครงสร้าง ไม่คัดลอกคะแนนนักเรียน)</p>
      <div id="siblings" class="muted small">กำลังค้นหา…</div></div>` : ""}`;
  for (const b of view.querySelectorAll("[data-add]")) b.onclick = () => addItem(Number(b.dataset.add), b.dataset.kind);
  for (const b of view.querySelectorAll("[data-edit]")) b.onclick = () => editItem(Number(b.dataset.edit));
  for (const b of view.querySelectorAll("[data-del]")) b.onclick = () => deleteItem(Number(b.dataset.del));
  for (const b of view.querySelectorAll("[data-paste]")) b.onclick = () => pasteItems(Number(b.dataset.paste));
  for (const b of view.querySelectorAll("[data-bank]")) b.onclick = () => bankItems(Number(b.dataset.bank));
  if (can) loadSiblings();
}

function itemForm(it = {}) {
  return `<div class="form-grid">
    <label class="field">ภาคเรียน<select name="term_number"><option value="1" ${it.term_number === 1 ? "selected" : ""}>ภาคเรียนที่ 1</option><option value="2" ${it.term_number === 2 ? "selected" : ""}>ภาคเรียนที่ 2</option></select></label>
    <label class="field">ประเภท<select name="kind"><option value="indicator" ${it.kind !== "final" ? "selected" : ""}>คะแนนเก็บ (${W})</option><option value="final" ${it.kind === "final" ? "selected" : ""}>สอบปลายภาค</option></select></label>
    <label class="field">คะแนนเต็ม<input name="max_score" inputmode="decimal" required value="${it.max_score ?? ""}"></label>
  </div>
  <label class="field" style="margin-top:12px">รหัส${W} (ถ้ามี)<input name="code" maxlength="60" placeholder="เช่น ท 1.1 ป.1/1" value="${esc(it.code || "")}"></label>
  <label class="field" style="margin-top:12px">ชื่อ${W} / การสอบ<textarea name="title" required maxlength="500" style="min-height:80px">${esc(it.title || "")}</textarea></label>`;
}

async function addItem(term, kind) {
  const res = await dialog({ title: kind === "final" ? "เพิ่มการสอบปลายภาค" : `เพิ่ม${W}`, body: itemForm({ term_number: term, kind, title: kind === "final" ? `สอบปลายภาคเรียนที่ ${term}` : "" }), okText: "เพิ่ม" });
  if (!res.ok) return;
  try { data = await api(`/api/courses/${courseId}/items`, { method: "POST", body: res.data }); toast("เพิ่มแล้ว"); render(); }
  catch (err) { showError(err); }
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

async function deleteItem(id) {
  const it = data.items.find((i) => i.id === id);
  if (!(await confirmBox("ลบช่องคะแนน", `ลบ "${esc(it.title)}" ใช่หรือไม่`, "ลบ", true))) return;
  await flush();
  try {
    data = await api(`/api/courses/${courseId}/items/${id}`, { method: "DELETE" });
  } catch (err) {
    if (err.data?.needs_confirm) {
      if (!(await confirmBox("ช่องนี้มีคะแนนแล้ว", `${esc(err.message)} — คะแนนของช่องนี้จะถูกลบถาวร`, "ลบพร้อมคะแนน", true))) return;
      try { data = await api(`/api/courses/${courseId}/items/${id}?confirm=1`, { method: "DELETE" }); } catch (e2) { showError(e2); return; }
    } else { showError(err); return; }
  }
  toast("ลบแล้ว"); render();
}

async function pasteItems(term) {
  const res = await dialog({
    title: `วาง${W}จากหลักสูตร — ภาคเรียนที่ ${term}`,
    body: `<p class="muted small">คัดลอกรายการ${W}จากเอกสารหลักสูตร วางบรรทัดละ 1 ${W} ระบบจะแยกรหัส (เช่น ท 1.1 ป.1/1) ออกให้เอง</p>
      <textarea name="lines" required placeholder="ท 1.1 ป.1/1 ออกเสียงคำ คำคล้องจอง และข้อความสั้น ๆ&#10;ท 1.1 ป.1/2 บอกความหมายของคำ และข้อความที่อ่าน"></textarea>
      <label class="field" style="margin-top:12px">คะแนนเต็มของแต่ละ${W}<input name="max" inputmode="decimal" value="10" required></label>
      <div id="preview" class="small muted" style="margin-top:10px"></div>`,
    okText: "เพิ่มทั้งหมด",
    onOpen: (d) => {
      const ta = d.querySelector("textarea"), pv = d.querySelector("#preview");
      ta.addEventListener("input", () => {
        const rows = parseIndicatorLines(ta.value);
        pv.innerHTML = rows.length ? `จะเพิ่ม ${rows.length} รายการ: ` + rows.slice(0, 5).map((r) => `<b>${esc(r.code || "–")}</b> ${esc(r.title.slice(0, 40))}`).join(" · ") + (rows.length > 5 ? " …" : "") : "";
      });
    },
  });
  if (!res.ok) return;
  const rows = parseIndicatorLines(res.data.lines);
  if (!rows.length) return;
  try {
    data = await api(`/api/courses/${courseId}/items`, { method: "POST", body: { items: rows.map((r) => ({ term_number: term, kind: "indicator", code: r.code, title: r.title, max_score: res.data.max })) } });
    toast(`เพิ่ม ${rows.length} ${W}แล้ว`); render();
  } catch (err) { showError(err); }
}

async function bankItems(term) {
  let bank;
  try { bank = await api(`/api/courses/${courseId}/bank`); } catch (err) { showError(err); return; }
  if (!bank.indicators.length) {
    await dialog({ title: `คลัง${W}`, body: `<p>ยังไม่มี${W}ของกลุ่มสาระ${esc(data.course.learning_area)} ระดับ ${esc(data.course.grade_level)} ในคลัง</p><p class="muted">ฝ่ายวิชาการนำเข้าคลังได้ที่หน้าตั้งค่ารายวิชา หรือใช้ปุ่ม "วางจากหลักสูตร" แทน</p>`, okText: "", cancelText: "ปิด" });
    return;
  }
  const used = new Set(data.items.map((i) => `${i.code}|${i.title}`));
  const res = await dialog({
    title: `เลือกจากคลัง${W} — ภาคเรียนที่ ${term}`, wide: true, okText: "เพิ่มที่เลือก",
    body: `<label class="field" style="margin-bottom:10px">คะแนนเต็มของแต่ละ${W}<input name="max" inputmode="decimal" value="10" required></label>
      <div style="display:grid;gap:6px">${bank.indicators.map((b) => `<label class="check" style="align-items:flex-start"><input type="checkbox" name="b${b.id}" value="${b.id}" ${used.has(`${b.code}|${b.title}`) ? "disabled" : ""}>
        <span><b>${esc(b.code)}</b> ${esc(b.title)}${used.has(`${b.code}|${b.title}`) ? ' <span class="tag">มีแล้ว</span>' : ""}</span></label>`).join("")}</div>`,
  });
  if (!res.ok) return;
  const chosen = bank.indicators.filter((b) => res.data[`b${b.id}`]);
  if (!chosen.length) { toast(`ยังไม่ได้เลือก${W}`); return; }
  try {
    data = await api(`/api/courses/${courseId}/items`, { method: "POST", body: { items: chosen.map((b) => ({ term_number: term, kind: "indicator", code: b.code, title: b.title, max_score: res.data.max })) } });
    toast(`เพิ่ม ${chosen.length} ${W}แล้ว`); render();
  } catch (err) { showError(err); }
}

async function loadSiblings() {
  const box = document.getElementById("siblings");
  try {
    const { courses } = await api(`/api/courses/${courseId}/siblings`);
    if (!courses.length) { box.textContent = "ยังไม่มีห้องอื่นที่ตั้งโครงสร้างวิชานี้ไว้"; return; }
    box.innerHTML = courses.map((s) => `<div class="actions" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line-soft)">
      <span>${esc(s.grade_level)}/${esc(s.classroom)} ปี ${s.year_be} — ${s.item_count} ช่องคะแนน</span>
      <button class="btn small" data-copy="${s.id}">${ICONS.copy} คัดลอกโครงสร้าง</button></div>`).join("");
    for (const b of box.querySelectorAll("[data-copy]")) b.onclick = async () => {
      const ok = await confirmBox("คัดลอกโครงสร้างคะแนน", data.items.length ? "รายการที่คัดลอกจะเพิ่มต่อท้ายช่องคะแนนเดิม (ช่องเดิมยังอยู่)" : `คัดลอก${W}และคะแนนเต็มทั้ง 2 ภาคเรียน`, "คัดลอก");
      if (!ok) return;
      try { data = await api(`/api/courses/${courseId}/copy-items`, { method: "POST", body: { source_course_id: Number(b.dataset.copy) } }); toast("คัดลอกแล้ว"); render(); }
      catch (err) { showError(err); }
    };
  } catch (err) { box.textContent = err.message; }
}

// ---------------- ยืนยันผล / ปลดล็อก ----------------
async function submitCourse() {
  await flush();
  if (pending.size || saving) { toast("รอให้บันทึกคะแนนเสร็จก่อน", "bad"); return; }
  if (!(await confirmBox("ยืนยันผลการเรียน", "เมื่อยืนยันแล้ว ระบบจะล็อกรายวิชานี้ แก้ไขคะแนนไม่ได้จนกว่าฝ่ายวัดผลจะปลดล็อก", "ยืนยันผล"))) return;
  try {
    data = await api(`/api/courses/${courseId}/submit`, { method: "POST", body: {} });
  } catch (err) {
    if (!err.data?.needs_confirm) { showError(err); return; }
    const names = err.data.pending.slice(0, 8).map(esc).join(", ") + (err.data.pending.length > 8 ? " …" : "");
    if (!(await confirmBox("คะแนนยังไม่ครบ", `${esc(err.message)}: ${names}<br><br>ยืนยันผลทั้งที่นักเรียนกลุ่มนี้ได้ ร ใช่หรือไม่`, "ยืนยันผล", true))) return;
    try { data = await api(`/api/courses/${courseId}/submit`, { method: "POST", body: { force: true } }); } catch (e2) { showError(e2); return; }
  }
  toast("ยืนยันผลการเรียนแล้ว");
  renderHeader(); render();
}

async function unlock() {
  if (!(await confirmBox("ปลดล็อกรายวิชา", "ครูผู้สอนจะกลับมาแก้ไขคะแนนได้อีกครั้ง", "ปลดล็อก"))) return;
  try {
    await api(`/api/admin/courses/${courseId}/lock`, { method: "POST", body: { locked: false } });
    data = await api(`/api/courses/${courseId}`);
    toast("ปลดล็อกแล้ว"); renderHeader(); render();
  } catch (err) { showError(err); }
}

// เริ่มแสดงผลหลังประกาศฟังก์ชัน/ค่าคงที่ทั้งหมดแล้ว
renderHeader();
renderTabs();
render();
