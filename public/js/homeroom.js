import { shell, api, esc, toast, showError, gradeBadge, dialog, confirmBox, ICONS, params, withYear } from "/js/app.js";
import { ASSESSMENT_GROUPS, ACTIVITY_PARTS, LEVELS, LEVEL_LABEL, summarizeGroup, summaryText } from "/js/grading.js";

await shell("home");
const p = params();
const grade = p.get("grade"), room = p.get("room");
const yearQ = p.get("year") ? `&year=${encodeURIComponent(p.get("year"))}` : "";
const q = `grade=${encodeURIComponent(grade)}&room=${encodeURIComponent(room)}${yearQ}`;
const view = document.getElementById("view");
let data;
let tab = sessionStorage.getItem("sr-hr-tab") || "trait";
let cterm = Number(sessionStorage.getItem("sr-hr-cterm")) || 2;
const pending = new Map();      // การประเมิน "sid|key" → value
const pendingC = new Map();     // ความคิดเห็น "term|sid|field" → body
const pendingB = new Map();     // น้ำหนักส่วนสูง "sid|round" → {weight,height}
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
const active = () => data.students.filter((s) => s.enrollment_status === "enrolled");
document.getElementById("meta").textContent = `ปีการศึกษา ${data.year.year_be} · นักเรียน ${active().length} คน`;
document.getElementById("backLink").href = withYear("/", data.year.id);
const pp6 = document.getElementById("pp6Btn");
pp6.innerHTML = `${ICONS.print} พิมพ์ ปพ.6 ทั้งห้อง`;
pp6.href = `/print/pp6.html?${q}`;

const TABS = [...ASSESSMENT_GROUPS.map((g) => [g.key, g.short]), ["comments", "ความคิดเห็น (ปพ.6)"], ["body", "น้ำหนัก ส่วนสูง"], ["grades", "ผลการเรียนรวม"], ["absence", "ขาดเรียน (บค.)"]];
const tabs = document.getElementById("tabs");
tabs.innerHTML = TABS.map(([k, label]) => `<button role="tab" data-tab="${k}">${label}</button>`).join("");
if (!TABS.some(([k]) => k === tab)) tab = "trait";
function renderTabs() {
  for (const b of tabs.querySelectorAll("button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    b.onclick = async () => { await flush(); tab = b.dataset.tab; sessionStorage.setItem("sr-hr-tab", tab); renderTabs(); render(); };
  }
}
window.addEventListener("beforeunload", (e) => { if (pending.size || pendingC.size || pendingB.size || saving) { e.preventDefault(); e.returnValue = ""; } });

function render() {
  const group = ASSESSMENT_GROUPS.find((g) => g.key === tab);
  if (group?.type === "activity") renderActivities(group);
  else if (group) renderAssessment(group);
  else if (tab === "comments") renderComments();
  else if (tab === "body") renderBody();
  else if (tab === "grades") renderGrades();
  else renderAbsence();
}

const RULE_TEXT = {
  trait: "สรุปตามเกณฑ์: ดีเยี่ยม = ได้ 3 ตั้งแต่ 5 ข้อและไม่มีข้อใดต่ำกว่า 2 · ดี = ไม่มีข้อใดต่ำกว่า 2 (หรือได้ 3 จำนวน 4 ข้อ) · มีข้อใดได้ 0 = ไม่ผ่าน",
  rtw: "สรุปตามเกณฑ์: รวม 5 ข้อ 13–15 = ดีเยี่ยม · 9–12 = ดี · 5–8 = ผ่าน · 0–4 = ไม่ผ่าน",
  comp: "สรุป: ผ่าน (ระดับ 1 ขึ้นไป) ครบ 5 ด้าน = ดีเยี่ยม · 4 ด้าน = ดี · 3 ด้าน = พอใช้ · ต่ำกว่านั้น = ปรับปรุง",
};
const valueOf = (sid, key) => data.assessments[sid]?.[key] ?? "";
const levelOptions = (v, blank = "–") => [["", blank], ...LEVELS.map((l) => [l.value, `${l.value} ${l.label}`])]
  .map(([val, label]) => `<option value="${val}" ${String(v) === val ? "selected" : ""}>${label}</option>`).join("");
const summaryCell = (group, sid) => { const v = summarizeGroup(group, data.assessments[sid]); return v == null ? "–" : `${group.type === "activity" ? "" : `${v} `}${summaryText(group, v)}`; };

function renderAssessment(group) {
  const shortHead = group.key === "rtw"; // ข้อความตัวชี้วัดยาว ใช้หัวคอลัมน์ "ข้อ 1–5" แล้วอธิบายใต้ตาราง
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="muted small">3 ดีเยี่ยม · 2 ดี · 1 ผ่าน · 0 ไม่ผ่าน — "ทั้งห้อง" เติมเฉพาะช่องที่ยังว่าง · "ทุกข้อ" ตั้งทุกข้อของนักเรียนคนนั้น · บันทึกอัตโนมัติ</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead><tr><th class="stick no col-head">เลขที่</th><th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
        ${group.items.map(([k, label], i) => `<th class="col-head" style="min-width:96px" title="${esc(label)}"><span class="t">${esc(shortHead ? `ข้อ ${i + 1}` : label)}</span>
          <select class="level-select fill" data-fill="${k}" aria-label="กรอกทั้งห้อง ${esc(label)}">${levelOptions("", "ทั้งห้อง…")}</select></th>`).join("")}
        <th class="col-head">ทุกข้อ</th><th class="col-head">สรุป</th></tr></thead>
      <tbody>${data.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${group.items.map(([k]) => { const v = valueOf(s.id, k); return `<td><select class="level-select v${esc(v)}" data-key="${k}" aria-label="${esc(s.name)} ${esc(k)}">${levelOptions(v)}</select></td>`; }).join("")}
        <td><select class="level-select fill" data-row aria-label="ทุกข้อของ ${esc(s.name)}">${levelOptions("", "ทุกข้อ…")}</select></td>
        <td class="calc" data-sum>${summaryCell(group, s.id)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small" style="margin-top:10px">${RULE_TEXT[group.rule] || ""}</p>
    ${shortHead ? `<ol class="small muted" style="margin:6px 0 0;padding-left:22px">${group.items.map(([, l]) => `<li>${esc(l)}</li>`).join("")}</ol>` : ""}`;
  const table = document.getElementById("sheet");
  table.addEventListener("change", (e) => {
    const sel = e.target;
    if (sel.dataset.fill) {
      const v = sel.value; sel.value = "";
      if (!v) return;
      let n = 0;
      for (const s of active()) {
        const cell = table.querySelector(`tr[data-sid="${s.id}"] select[data-key="${sel.dataset.fill}"]`);
        if (cell && !cell.value) { cell.value = v; setValue(group, s.id, sel.dataset.fill, v, cell); n++; }
      }
      toast(n ? `กรอกให้ ${n} คนที่ยังว่าง` : "ทุกคนมีค่าแล้ว (ไม่เขียนทับ)");
      return;
    }
    if ("row" in sel.dataset) {
      const v = sel.value; sel.value = "";
      if (!v) return;
      const tr = sel.closest("tr"), sid = Number(tr.dataset.sid);
      for (const cell of tr.querySelectorAll("select[data-key]")) { cell.value = v; setValue(group, sid, cell.dataset.key, v, cell); }
      return;
    }
    if (sel.dataset.key) setValue(group, Number(sel.closest("tr").dataset.sid), sel.dataset.key, sel.value, sel);
  });
  showState();
}

function setValue(group, sid, key, value, sel) {
  (data.assessments[sid] ||= {});
  if (value === "") delete data.assessments[sid][key]; else data.assessments[sid][key] = value;
  if (sel) sel.className = `level-select v${value}`;
  const sum = sel?.closest("tr")?.querySelector("[data-sum]");
  if (sum) sum.textContent = summaryCell(group, sid);
  pending.set(`${sid}|${key}`, value);
  schedule();
}

// ---------- ปพ.5.1 กิจกรรมพัฒนาผู้เรียน: ค่าเริ่มต้นผ่าน ติ๊กออกเฉพาะคนไม่ผ่าน ----------
function renderActivities(group) {
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="muted small">ทุกคนผ่านเป็นค่าเริ่มต้น ไม่ต้องยืนยันทุกภาค — เอาเครื่องหมายออกเฉพาะคนที่เวลาเรียนไม่ครบหรือไม่ผ่านจุดประสงค์ · บันทึกอัตโนมัติ</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead>
        <tr><th class="stick no col-head" rowspan="2">เลขที่</th><th class="stick name col-head" rowspan="2" style="text-align:left">ชื่อ–สกุล</th>
          ${group.items.map(([, label]) => `<th class="col-head" colspan="2"><span class="t">${esc(label)}</span></th>`).join("")}<th class="col-head" rowspan="2">สรุป</th></tr>
        <tr>${group.items.map(() => ACTIVITY_PARTS.map(([, l]) => `<th class="col-head small">${l}</th>`).join("")).join("")}</tr>
      </thead>
      <tbody>${data.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${group.items.map(([k, label]) => ACTIVITY_PARTS.map(([pt, pl]) => { const key = `${k}_${pt}`; const ok = valueOf(s.id, key) !== "มผ";
          return `<td class="chk-cell ${ok ? "" : "fail"}"><input type="checkbox" data-key="${key}" ${ok ? "checked" : ""} aria-label="${esc(s.name)} ${esc(label)} ${pl}"></td>`; }).join("")).join("")}
        <td class="calc" data-sum>${summaryCell(group, s.id)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small" style="margin-top:10px">ช่องมีเครื่องหมาย = ผ่าน · ผลกิจกรรมผ่านเมื่อผ่านทั้งเวลาเรียนและจุดประสงค์ · ชุมนุมข้ามห้องจะให้ฝ่ายวิชาการจัดรายชื่อในรอบถัดไป</p>`;
  document.getElementById("sheet").addEventListener("change", (e) => {
    const box = e.target;
    if (!box.dataset.key) return;
    box.parentElement.classList.toggle("fail", !box.checked);
    setValue(group, Number(box.closest("tr").dataset.sid), box.dataset.key, box.checked ? "" : "มผ", null);
    box.closest("tr").querySelector("[data-sum]").textContent = summaryCell(group, Number(box.closest("tr").dataset.sid));
  });
  showState();
}

// ---------- ความคิดเห็นครูประจำชั้น (ปพ.6) ----------
const CFIELDS = [["learn", "ด้านการเรียน"], ["habit", "ด้านอุปนิสัย"], ["health", "ด้านสุขภาพ"], ["other", "อื่น ๆ"]];
let focusField = "learn", focusBox = null;
const commentOf = (sid, f) => data.comments?.[sid]?.[cterm]?.[f] ?? "";
function renderComments() {
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">${[1, 2].map((t) => `<button class="btn small ${t === cterm ? "primary" : ""}" data-term="${t}">ภาคเรียนที่ ${t}</button>`).join("")}</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="panel bank-panel" id="bankPanel"></div>
    <div class="actions" style="margin-bottom:10px"><span class="muted small">ใช้กับทั้งห้อง:</span>${CFIELDS.map(([f, l]) => `<button class="btn small" data-all="${f}">${l}</button>`).join("")}</div>
    <div class="cm-head">${["นักเรียน", ...CFIELDS.map(([, l]) => l)].map((l) => `<span>${l}</span>`).join("")}</div>
    <div id="cmList">${data.students.map((s) => `<div class="cm-row ${s.enrollment_status !== "enrolled" ? "inactive" : ""}" data-sid="${s.id}">
      <span class="cm-name"><b>${s.number ?? ""}</b> ${esc(s.name)}</span>
      ${CFIELDS.map(([f, l]) => `<label class="cm-field"><span class="cm-label">${l}</span><textarea rows="2" maxlength="300" data-f="${f}" aria-label="${esc(s.name)} ${l}">${esc(commentOf(s.id, f))}</textarea></label>`).join("")}
    </div>`).join("")}</div>`;
  for (const b of view.querySelectorAll("[data-term]")) b.onclick = async () => { await flush(); cterm = Number(b.dataset.term); sessionStorage.setItem("sr-hr-cterm", cterm); renderComments(); };
  const list = document.getElementById("cmList");
  list.addEventListener("focusin", (e) => { if (e.target.dataset.f) { focusField = e.target.dataset.f; focusBox = e.target; drawBank(); } });
  list.addEventListener("input", (e) => { if (e.target.dataset.f) setComment(Number(e.target.closest(".cm-row").dataset.sid), e.target.dataset.f, e.target.value); });
  for (const b of view.querySelectorAll("[data-all]")) b.onclick = () => applyAll(b.dataset.all);
  drawBank();
  showState();
}

function setComment(sid, f, body) {
  ((data.comments ||= {})[sid] ||= {})[cterm] ||= {};
  data.comments[sid][cterm][f] = body;
  pendingC.set(`${cterm}|${sid}|${f}`, body);
  schedule();
}

function drawBank() {
  const box = document.getElementById("bankPanel");
  if (!box) return;
  const label = CFIELDS.find(([f]) => f === focusField)[1];
  const items = (data.comment_bank || []).filter((x) => x.field === focusField);
  box.innerHTML = `<div class="panel-head" style="margin-bottom:6px"><h3 style="margin:0">คลังข้อความ — ${label}</h3>
      <span class="actions"><button class="btn small" id="bankSave">${ICONS.plus} เก็บข้อความในช่องที่เลือกเข้าคลัง</button></span></div>
    <div class="chips">${items.map((x) => `<span class="chip"><button class="chip-use" data-use="${x.id}" title="แทรกในช่องที่เลือก">${esc(x.body)}</button><button class="chip-x" data-del="${x.id}" aria-label="ลบออกจากคลัง">×</button></span>`).join("")
      || `<span class="muted small">ยังไม่มีข้อความของ${label} — พิมพ์ในช่องของนักเรียนแล้วกด "เก็บเข้าคลัง" ครั้งหน้ากดแทรกได้ทันที</span>`}</div>`;
  box.querySelector("#bankSave").onclick = async () => {
    const body = focusBox?.value.trim();
    if (!body) { toast("คลิกช่องความคิดเห็นที่มีข้อความก่อน", "bad"); return; }
    try { data.comment_bank = (await api("/api/homeroom/comment-bank", { method: "POST", body: { field: focusField, body } })).comment_bank; drawBank(); toast("เก็บเข้าคลังแล้ว"); } catch (err) { showError(err); }
  };
  for (const b of box.querySelectorAll("[data-use]")) b.onclick = () => {
    const x = data.comment_bank.find((i) => i.id === Number(b.dataset.use));
    if (!focusBox || focusBox.dataset.f !== x.field) { toast(`คลิกช่อง${label}ของนักเรียนที่ต้องการก่อน`, "bad"); return; }
    focusBox.value = focusBox.value.trim() ? `${focusBox.value.trim()} ${x.body}`.slice(0, 300) : x.body;
    setComment(Number(focusBox.closest(".cm-row").dataset.sid), x.field, focusBox.value);
    focusBox.focus();
  };
  for (const b of box.querySelectorAll("[data-del]")) b.onclick = async () => {
    try { data.comment_bank = (await api(`/api/homeroom/comment-bank/${b.dataset.del}`, { method: "DELETE" })).comment_bank; drawBank(); } catch (err) { showError(err); }
  };
}

async function applyAll(f) {
  const label = CFIELDS.find(([x]) => x === f)[1];
  const bank = (data.comment_bank || []).filter((x) => x.field === f);
  const r = await dialog({
    title: `${label} — ใช้กับทั้งห้อง (ภาค ${cterm})`, okText: "ใช้กับทั้งห้อง",
    body: `<label class="field">ข้อความ<textarea name="body" maxlength="300" required>${esc(focusBox?.dataset.f === f ? focusBox.value : "")}</textarea></label>
      ${bank.length ? `<p class="muted small" style="margin:8px 0 4px">หรือเลือกจากคลัง</p><div class="chips">${bank.map((x) => `<button type="button" class="chip-use" data-pick="${esc(x.body)}">${esc(x.body)}</button>`).join("")}</div>` : ""}
      <label class="check" style="margin-top:10px"><input type="checkbox" name="overwrite"> เขียนทับคนที่มีข้อความแล้ว (ไม่ติ๊ก = เติมเฉพาะคนที่ยังว่าง)</label>`,
    onOpen: (d) => { for (const b of d.querySelectorAll("[data-pick]")) b.onclick = () => { d.querySelector("textarea").value = b.dataset.pick; }; },
  });
  if (!r.ok) return;
  const body = r.data.body.trim();
  if (!body) return;
  let n = 0;
  for (const s of active()) {
    if (!r.data.overwrite && commentOf(s.id, f)) continue;
    setComment(s.id, f, body); n++;
    const ta = view.querySelector(`.cm-row[data-sid="${s.id}"] textarea[data-f="${f}"]`);
    if (ta) ta.value = body;
  }
  toast(`ใช้กับ ${n} คนแล้ว`);
}

// ---------- น้ำหนัก ส่วนสูง 4 ครั้งต่อปี ----------
const ROUNDS = [1, 2, 3, 4];
const bodyOf = (sid, r) => data.body?.[sid]?.[r] || {};
function bmiText(sid) {
  for (const r of [...ROUNDS].reverse()) {
    const b = bodyOf(sid, r);
    if (b.weight && b.height) return (b.weight / (b.height / 100) ** 2).toFixed(1);
  }
  return "–";
}
function renderBody() {
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="muted small">น้ำหนัก (กก.) และส่วนสูง (ซม.) ทศนิยม 1 ตำแหน่ง · กด Enter เพื่อลงไปคนถัดไป · บันทึกอัตโนมัติ</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead>
        <tr><th class="stick no col-head" rowspan="2">เลขที่</th><th class="stick name col-head" rowspan="2" style="text-align:left">ชื่อ–สกุล</th>
          ${ROUNDS.map((r) => `<th class="col-head" colspan="2">ครั้งที่ ${r}</th>`).join("")}<th class="col-head" rowspan="2">BMI<br><span class="max">ล่าสุด</span></th></tr>
        <tr>${ROUNDS.map(() => '<th class="col-head small">กก.</th><th class="col-head small">ซม.</th>').join("")}</tr>
      </thead>
      <tbody>${data.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${ROUNDS.map((r) => ["weight", "height"].map((f) => `<td class="cell"><input inputmode="decimal" data-r="${r}" data-f="${f}" value="${bodyOf(s.id, r)[f] ?? ""}" aria-label="${esc(s.name)} ครั้งที่ ${r} ${f === "weight" ? "น้ำหนัก" : "ส่วนสูง"}"></td>`).join("")).join("")}
        <td class="calc" data-bmi>${bmiText(s.id)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small" style="margin-top:10px">BMI ใช้ดูแนวโน้มเท่านั้น การแปลผลภาวะโภชนาการของเด็กต้องใช้กราฟเกณฑ์อ้างอิงการเจริญเติบโตตามเพศและอายุ (จะเพิ่มเมื่อได้ตารางเกณฑ์ที่โรงเรียนใช้)</p>`;
  const table = document.getElementById("sheet");
  const inputs = () => [...table.querySelectorAll("tbody input")];
  table.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches("input")) return;
    e.preventDefault();
    const all = inputs(), i = all.indexOf(e.target), cols = ROUNDS.length * 2;
    all[i + cols]?.focus();
  });
  table.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.matches("input")) return;
    const v = t.value.trim().replace(",", ".");
    const ok = v === "" || /^\d{1,3}(\.\d)?$/.test(v);
    t.parentElement.classList.toggle("invalid", !ok);
    if (!ok) return;
    const tr = t.closest("tr"), sid = Number(tr.dataset.sid), r = Number(t.dataset.r);
    const cur = { ...bodyOf(sid, r), [t.dataset.f]: v === "" ? null : Number(v) };
    ((data.body ||= {})[sid] ||= {})[r] = cur;
    tr.querySelector("[data-bmi]").textContent = bmiText(sid);
    pendingB.set(`${sid}|${r}`, cur);
    schedule();
  });
  showState();
}

// ---------- บันทึกอัตโนมัติ (ทุกแท็บ) ----------
function schedule() { showState(); clearTimeout(timer); timer = setTimeout(flush, 700); }

async function flush() {
  if (saving || (!pending.size && !pendingC.size && !pendingB.size)) return;
  saving = true;
  const a = [...pending.entries()], c = [...pendingC.entries()], b = [...pendingB.entries()];
  pending.clear(); pendingC.clear(); pendingB.clear();
  showState();
  try {
    if (a.length) await api(`/api/homeroom/assessments?${q}`, { method: "PUT", body: { changes: a.map(([k, value]) => { const [sid, item_key] = k.split("|"); return { student_id: Number(sid), item_key, value }; }) } });
    for (const t of [1, 2]) {
      const list = c.filter(([k]) => k.startsWith(`${t}|`));
      if (list.length) await api(`/api/homeroom/comments?${q}`, { method: "PUT", body: { term: t, changes: list.map(([k, body]) => { const [, sid, field] = k.split("|"); return { student_id: Number(sid), field, body }; }) } });
    }
    if (b.length) await api(`/api/homeroom/body?${q}`, { method: "PUT", body: { changes: b.map(([k, v]) => { const [sid, round] = k.split("|").map(Number); return { student_id: sid, round, weight: v.weight, height: v.height }; }) } });
    saving = false; showState();
  } catch (err) {
    for (const [k, v] of a) if (!pending.has(k)) pending.set(k, v);
    for (const [k, v] of c) if (!pendingC.has(k)) pendingC.set(k, v);
    for (const [k, v] of b) if (!pendingB.has(k)) pendingB.set(k, v);
    saving = false; showState(err); showError(err);
    return;
  }
  if (pending.size || pendingC.size || pendingB.size) flush();
}

function showState(err) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.className = "save-state";
  if (err) { el.classList.add("error"); el.innerHTML = `บันทึกไม่สำเร็จ <button class="btn small" id="retry">ลองอีกครั้ง</button>`; document.getElementById("retry").onclick = flush; }
  else if (saving || pending.size || pendingC.size || pendingB.size) { el.classList.add("pending"); el.textContent = "กำลังบันทึก…"; }
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
