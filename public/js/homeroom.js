import { shell, api, esc, toast, showError, gradeBadge, dialog, confirmBox, ICONS, params, withYear, fmt, editGate } from "/js/app.js";
import { ASSESSMENT_GROUPS, LEVELS, LEVEL_LABEL, summarizeGroup, summaryText } from "/js/grading.js";
import { analyzeBody, ageText, levelClass, loadGrowthRefs } from "/js/growth.js";
import { KINDER_DOMAINS, KINDER_COMMENT_FIELDS, KINDER_LEVELS, levelLabel, domainSummary, overallSummary, shortCode } from "/js/kinder.js";
import { createChecker } from "/js/spellcheck.js";

await shell("home");
const p = params();
const grade = p.get("grade"), room = p.get("room");
const yearQ = p.get("year") ? `&year=${encodeURIComponent(p.get("year"))}` : "";
const q = `grade=${encodeURIComponent(grade)}&room=${encodeURIComponent(room)}${yearQ}`;
const view = document.getElementById("view");
let data;
let tab = sessionStorage.getItem("sr-hr-tab") || "attend";
let cterm = Number(sessionStorage.getItem("sr-hr-cterm")) || 2;
const pending = new Map();      // การประเมิน "sid|key" → value
const pendingC = new Map();     // ความคิดเห็น "term|sid|field" → body
const pendingB = new Map();     // น้ำหนักส่วนสูง "sid|round" → {weight,height}
const pendingA = new Map();     // การมาเรียน "sid|date" → "" | ข | ล | ป | ส
const pendingK = new Map();     // พัฒนาการอนุบาล "term|round|sid|code" → "" | 1 | 2 | 3
const pendingKC = new Map();    // ความคิดเห็นอนุบาล "term|sid|field" → body
const anyPending = () => pending.size || pendingC.size || pendingB.size || pendingA.size || pendingK.size || pendingKC.size;
// ความคิดเห็นที่ตรวจพบคำที่อาจสะกดผิด → ไม่บันทึกจนกว่าจะแก้ หรือยืนยันบันทึก 2 รอบ
const held = new Map();         // "p|term|sid|field" (ป.) / "k|term|sid|field" (อนุบาล) → body
const heldOrig = new Map();     // ค่าเดิมก่อนแก้ (ใช้คืนค่าเมื่อออกจากหน้าโดยไม่บันทึก)
const checking = new Map();     // key → timer (กำลังรอตรวจหลังหยุดพิมพ์)
let saving = false, timer;

try { data = await api(`/api/homeroom?${q}`); }
catch (err) {
  document.getElementById("main").hidden = false;
  view.innerHTML = `<div class="panel empty"><strong>เปิดห้องนี้ไม่ได้</strong>${esc(err.message)}</div>`;
  throw err;
}
document.getElementById("main").hidden = false;
editGate(view, data.edit, `/api/homeroom/edit-request?${q}`); // ปิดการกรอกแล้ว: ดูอย่างเดียว + ขอแก้ไข
document.title = `ครูประจำชั้น ${grade}/${room}`;
document.getElementById("title").textContent = `ครูประจำชั้น ${grade}/${room}`;
const active = () => data.students.filter((s) => s.enrollment_status === "enrolled");
document.getElementById("meta").textContent = `ปีการศึกษา ${data.year.year_be} · นักเรียน ${active().length} คน${data.teachers?.length ? ` · ครูประจำชั้น ${data.teachers.join(", ")}` : ""}`;
document.getElementById("backLink").href = withYear("/", data.year.id);
const pp6 = document.getElementById("pp6Btn");
pp6.innerHTML = `${ICONS.print} ${/^อ\./.test(grade) ? "เอกสารของห้อง" : "ปพ.6 และเอกสารของห้อง"}`;
pp6.href = `/docs.html?room=${encodeURIComponent(`${grade}/${room}`)}`;

const hasMovers = data.students.some((s) => s.transfer_in_term > 1);
const KINDER = /^อ\./.test(grade); // อนุบาล: ประเมินพัฒนาการ 4 ด้าน (หลักสูตรปฐมวัย 2569) + การมาเรียน + น้ำหนักส่วนสูง
// บันทึกการมาเรียนอยู่แท็บแรก (ใช้ทุกวัน)
const TABS = KINDER ? [["attend", "บันทึกการมาเรียน"], ["dev", "ประเมินพัฒนาการ"], ["devsum", "สรุปผลพัฒนาการ"], ["kcomments", "ความคิดเห็นครู"], ["body", "น้ำหนัก ส่วนสูง"]] : [["attend", "บันทึกการมาเรียน"], ...ASSESSMENT_GROUPS.filter((g) => g.type !== "activity").map((g) => [g.key, g.short]), ["comments", "ความคิดเห็น (ปพ.6)"], ["body", "น้ำหนัก ส่วนสูง"],
  ...(hasMovers ? [["carry", "คะแนนยกมา (ย้ายเข้า)"]] : []), ["grades", "ผลการเรียนรวม"]];
if (location.hash === "#carry" && hasMovers) tab = "carry";
const tabs = document.getElementById("tabs");
tabs.innerHTML = TABS.map(([k, label]) => `<button role="tab" data-tab="${k}">${label}</button>`).join("");
if (tab === "absence") tab = "attend";
if (tab === "logs") { sessionStorage.setItem("sr-hr-tab", "attend"); tab = "attend"; } // บันทึกประจำวันย้ายไปเมนูซ้าย /logs.html
if (tab === "act") tab = "trait"; // กิจกรรมพัฒนาผู้เรียนอยู่ที่เมนูซ้าย "กิจกรรมพัฒนาผู้เรียน" ที่เดียว
if (!TABS.some(([k]) => k === tab)) tab = TABS[0][0];
function renderTabs() {
  for (const b of tabs.querySelectorAll("button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    b.onclick = async () => { if (b.dataset.tab !== tab && !(await leaveHeld())) return; await flush(); tab = b.dataset.tab; sessionStorage.setItem("sr-hr-tab", tab); renderTabs(); render(); };
  }
}
window.addEventListener("beforeunload", (e) => { if (anyPending() || saving || held.size || checking.size) { e.preventDefault(); e.returnValue = ""; } });

function render() {
  const group = ASSESSMENT_GROUPS.find((g) => g.key === tab);
  if (tab === "act") { location.href = `/activities.html?room=${encodeURIComponent(`${grade}/${room}`)}`; return; }
  if (group) renderAssessment(group);
  else if (tab === "comments") renderComments();
  else if (tab === "body") renderBody();
  else if (tab === "carry") renderCarry().catch((err) => { view.innerHTML = `<div class="panel empty"><strong>โหลดไม่สำเร็จ</strong>${esc(err.message)}</div>`; });
  else if (tab === "grades") renderGrades();
  else if (tab === "dev" || tab === "devsum" || tab === "kcomments") renderKinder().catch((err) => { view.innerHTML = `<div class="panel empty"><strong>โหลดไม่สำเร็จ</strong>${esc(err.message)}</div>`; });
  else renderAttendance().catch((err) => { view.innerHTML = `<div class="panel empty"><strong>โหลดไม่สำเร็จ</strong>${esc(err.message)}</div>`; });
}

// ---------- คะแนนยกมาจาก ปพ.6 ของโรงเรียนเดิม (นักเรียนย้ายเข้าระหว่างปี) ----------
async function renderCarry() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  const c = await api(`/api/homeroom/carryover?${q}`);
  const v = (sid, code, t) => c.values[sid]?.[code]?.[t] || {};
  const val = (n) => (n == null ? "" : n);
  view.innerHTML = `<p class="muted small" style="margin:0 0 12px">นักเรียนที่ย้ายเข้าระหว่างปีจะมี ปพ.6 ของภาคก่อนหน้าติดตัวมา ให้กรอกคะแนนของภาคนั้นทีละวิชา (เต็มภาคละ 50 คะแนน)
      ระบบจะใช้แทนช่องคะแนนของภาคนั้นทั้งภาค แล้วรวมกับภาคที่เรียนที่นี่เพื่อตัดเกรด · ถ้า ปพ.6 แยกระหว่างภาค/ปลายภาค ให้กรอกทั้งสองช่อง (ระบบรวมให้) ถ้ามีแต่คะแนนรวม กรอกช่องรวมอย่างเดียว</p>
    ${c.students.map((st) => `<div class="panel" data-st="${st.id}">
      <div class="panel-head"><h2>${esc(st.number ?? "")} ${esc(st.name)}</h2>
        <span class="muted small">ย้ายเข้าภาคเรียนที่ ${st.transfer_in_term}${st.school ? ` จาก${esc(st.school)}` : ""}</span></div>
      ${st.terms.length ? `<div class="table-wrap"><table class="list carry"><thead><tr><th>รายวิชา</th>${st.terms.map((t) => `<th class="num">ภาค ${t} ระหว่างภาค</th><th class="num">ปลายภาค</th><th class="num">รวม (50)</th>`).join("")}<th></th></tr></thead>
        <tbody>${c.subjects.map((sj) => `<tr data-code="${esc(sj.code)}"><td>${esc(sj.code)} ${esc(sj.name)}</td>
          ${st.terms.map((t) => { const x = v(st.id, sj.code, t), dis = sj.locked ? "disabled" : "";
            return `<td><input class="num-in" inputmode="decimal" data-t="${t}" data-f="collect" value="${val(x.collect)}" ${dis} aria-label="${esc(sj.name)} ภาค ${t} ระหว่างภาค"></td>
              <td><input class="num-in" inputmode="decimal" data-t="${t}" data-f="final" value="${val(x.final)}" ${dis} aria-label="${esc(sj.name)} ภาค ${t} ปลายภาค"></td>
              <td><input class="num-in" inputmode="decimal" data-t="${t}" data-f="total" value="${val(x.total)}" ${dis} aria-label="${esc(sj.name)} ภาค ${t} รวม"></td>`; }).join("")}
          <td class="small">${sj.locked ? '<span class="tag">ส่งผลแล้ว</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
        <div class="actions" style="margin-top:10px"><button class="btn primary" data-save="${st.id}">บันทึกคะแนนยกมา</button></div>`
      : `<p class="muted">ย้ายเข้าตั้งแต่ภาคเรียนที่ 1 — ไม่มีคะแนนภาคก่อนหน้าในปีการศึกษานี้ ครูผู้สอนประเมินตามปกติ</p>`}
    </div>`).join("") || `<div class="panel empty"><strong>ไม่มีนักเรียนย้ายเข้าระหว่างปี</strong></div>`}`;
  // ระหว่างภาค + ปลายภาค → เติมรวมให้
  view.addEventListener("input", (e) => {
    const inp = e.target;
    if (!inp.dataset.f || inp.dataset.f === "total") return;
    const tr = inp.closest("tr"), t = inp.dataset.t;
    const a = tr.querySelector(`[data-t="${t}"][data-f="collect"]`).value.trim(), b = tr.querySelector(`[data-t="${t}"][data-f="final"]`).value.trim();
    if (a !== "" && b !== "" && Number.isFinite(+a) && Number.isFinite(+b)) tr.querySelector(`[data-t="${t}"][data-f="total"]`).value = fmt(+a + +b);
  });
  for (const b of view.querySelectorAll("[data-save]")) b.onclick = async () => {
    const sid = Number(b.dataset.save), st = c.students.find((x) => x.id === sid), box = view.querySelector(`[data-st="${sid}"]`);
    const changes = [];
    for (const tr of box.querySelectorAll("tr[data-code]")) for (const t of st.terms) {
      const get = (f) => tr.querySelector(`[data-t="${t}"][data-f="${f}"]`);
      if (get("total").disabled) continue;
      const row = { student_id: sid, subject_code: tr.dataset.code, term_number: t, collect: get("collect").value.trim(), final: get("final").value.trim(), total: get("total").value.trim() };
      const old = v(sid, tr.dataset.code, t);
      if (String(val(old.collect)) === row.collect && String(val(old.final)) === row.final && String(val(old.total)) === row.total) continue;
      changes.push(row);
    }
    if (!changes.length) { toast("ไม่มีอะไรเปลี่ยน"); return; }
    b.disabled = true;
    try { const r = await api(`/api/homeroom/carryover?${q}`, { method: "PUT", body: { changes } }); c.values = r.values; toast("บันทึกคะแนนยกมาแล้ว"); }
    catch (err) { showError(err); }
    finally { b.disabled = false; }
  };
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

const labelOf = (group, key) => { const i = group.items.findIndex(([k]) => k === key); return i < 0 ? key : (group.key === "rtw" ? `ข้อ ${i + 1} ` : "") + group.items[i][1]; };
function renderAssessment(group) {
  const shortHead = group.key === "rtw"; // ข้อความตัวชี้วัดยาว ใช้หัวคอลัมน์ "ข้อ 1–5" แล้วอธิบายใต้ตาราง
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="muted small">3 ดีเยี่ยม · 2 ดี · 1 ผ่าน · 0 ไม่ผ่าน — "ทั้งห้อง" เติมเฉพาะช่องที่ยังว่าง · "ทุกข้อ" ตั้งทุกข้อของนักเรียนคนนั้น · บันทึกอัตโนมัติ</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead><tr><th class="stick no col-head">เลขที่</th><th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
        ${group.items.map(([k, label], i) => `<th class="col-head" style="min-width:96px">${shortHead
          ? `<button type="button" class="tip-btn" data-tip="ข้อ ${i + 1}: ${esc(label)}" aria-label="ข้อ ${i + 1} วัดเรื่องอะไร">ข้อ ${i + 1} <i class="i" aria-hidden="true">i</i></button>`
          : `<span class="t" data-tip="${esc(label)}">${esc(label)}</span>`}
          <select class="level-select fill" data-fill="${k}" aria-label="กรอกทั้งห้อง ${esc(label)}">${levelOptions("", "ทั้งห้อง…")}</select></th>`).join("")}
        <th class="col-head">ทุกข้อ</th><th class="col-head">สรุป</th></tr></thead>
      <tbody>${data.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${group.items.map(([k]) => { const v = valueOf(s.id, k); return `<td><select class="level-select v${esc(v)}" data-key="${k}" aria-label="${esc(s.name)} ${esc(labelOf(group, k))}">${levelOptions(v)}</select></td>`; }).join("")}
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
    ${spellBar()}
    <div class="panel bank-panel" id="bankPanel"></div>
    <div class="actions" style="margin-bottom:10px"><span class="muted small">ใช้กับทั้งห้อง:</span>${CFIELDS.map(([f, l]) => `<button class="btn small" data-all="${f}">${l}</button>`).join("")}</div>
    <div class="cm-head">${["นักเรียน", ...CFIELDS.map(([, l]) => l)].map((l) => `<span>${l}</span>`).join("")}</div>
    <div id="cmList">${data.students.map((s) => `<div class="cm-row ${s.enrollment_status !== "enrolled" ? "inactive" : ""}" data-sid="${s.id}">
      <span class="cm-name"><b>${s.number ?? ""}</b> ${esc(s.name)}</span>
      ${CFIELDS.map(([f, l]) => `<label class="cm-field"><span class="cm-label">${l}</span><textarea rows="2" maxlength="300" data-f="${f}" aria-label="${esc(s.name)} ${l}">${esc(commentOf(s.id, f))}</textarea><span class="sp-issues" hidden></span></label>`).join("")}
    </div>`).join("")}</div>`;
  for (const b of view.querySelectorAll("[data-term]")) b.onclick = async () => { if (!(await leaveHeld())) return; await flush(); cterm = Number(b.dataset.term); sessionStorage.setItem("sr-hr-cterm", cterm); renderComments(); };
  const list = document.getElementById("cmList");
  list.addEventListener("focusin", (e) => { if (e.target.dataset.f) { focusField = e.target.dataset.f; focusBox = e.target; drawBank(); } });
  list.addEventListener("input", (e) => { if (e.target.dataset.f) setComment(Number(e.target.closest(".cm-row").dataset.sid), e.target.dataset.f, e.target.value); });
  for (const b of view.querySelectorAll("[data-all]")) b.onclick = () => applyAll(b.dataset.all);
  wireSpell(list, "p");
  drawBank();
  showState();
}

function setComment(sid, f, body, opts) {
  ((data.comments ||= {})[sid] ||= {})[cterm] ||= {};
  commentChanged("p", cterm, sid, f, body, opts);
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
    if (!(await confirmMisspelled(body, "เก็บเข้าคลังข้อความ"))) return;
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
  if (!(await confirmMisspelled(body, "ใช้กับทั้งห้อง"))) return;
  let n = 0;
  for (const s of active()) {
    if (!r.data.overwrite && commentOf(s.id, f)) continue;
    setComment(s.id, f, body, { force: true }); n++;
    const ta = view.querySelector(`.cm-row[data-sid="${s.id}"] textarea[data-f="${f}"]`);
    if (ta) { ta.value = body; drawIssues(ta); }
  }
  toast(`ใช้กับ ${n} คนแล้ว`);
}

// ---------- น้ำหนัก ส่วนสูง 4 ครั้งต่อปี ----------
const ROUNDS = [1, 2, 3, 4];
const bodyOf = (sid, r) => data.body?.[sid]?.[r] || {};
const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
// ภาวะโภชนาการตามเกณฑ์กรมอนามัย ของการวัดครั้งล่าสุด: รูปร่าง (น้ำหนักตามส่วนสูง) + ส่วนสูงตามอายุ
let growthReady = false;
const tagOf = (x, what) => (x ? `<span class="tag ${levelClass(x.label)}" title="${what}${x.z != null ? ` · z = ${fmt(x.z, 2)}` : ""}">${x.label}</span>` : "");
function bmiText(sid) {
  const st = data.students.find((x) => x.id === sid);
  for (const r of [...ROUNDS].reverse()) {
    const b = bodyOf(sid, r);
    if (!(b.weight && b.height)) continue;
    const a = analyzeBody(st, b, data.body_dates?.[sid]?.[r] || todayIso());
    const tags = `${tagOf(a.wfh, "รูปร่าง (น้ำหนักตามเกณฑ์ส่วนสูง)")} ${tagOf(a.hfa, "ส่วนสูงตามเกณฑ์อายุ")}${a.good ? ' <span class="tag ok">สูงดีสมส่วน</span>' : ""}`.trim();
    return `<span title="อายุ ${ageText(a.months)} · BMI ${fmt(a.bmi, 1)}">${tags || "–"}</span>${a.why ? ` <span class="muted small" title="${esc(a.why)}">ⓘ</span>` : ""}`;
  }
  return "–";
}
function renderBody() {
  if (!growthReady) { loadGrowthRefs().then(() => { growthReady = true; if (tab === "body") renderBody(); }).catch(() => {}); }
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="muted small">น้ำหนัก (กก.) และส่วนสูง (ซม.) ทศนิยม 1 ตำแหน่ง · กด Enter เพื่อลงไปคนถัดไป · บันทึกอัตโนมัติ</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead>
        <tr><th class="stick no col-head" rowspan="2">เลขที่</th><th class="stick name col-head" rowspan="2" style="text-align:left">ชื่อ–สกุล</th>
          ${ROUNDS.map((r) => `<th class="col-head" colspan="2">ครั้งที่ ${r}</th>`).join("")}<th class="col-head" rowspan="2">ภาวะโภชนาการ<br><span class="max">ครั้งล่าสุด</span></th></tr>
        <tr>${ROUNDS.map(() => '<th class="col-head small">กก.</th><th class="col-head small">ซม.</th>').join("")}</tr>
      </thead>
      <tbody>${data.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${ROUNDS.map((r) => ["weight", "height"].map((f) => `<td class="cell"><input inputmode="decimal" data-r="${r}" data-f="${f}" value="${bodyOf(s.id, r)[f] ?? ""}" aria-label="${esc(s.name)} ครั้งที่ ${r} ${f === "weight" ? "น้ำหนัก" : "ส่วนสูง"}"></td>`).join("")).join("")}
        <td class="calc" data-bmi style="white-space:nowrap">${bmiText(s.id)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small" style="margin-top:10px">ภาวะโภชนาการตามเกณฑ์กรมอนามัย: รูปร่าง (น้ำหนักตามเกณฑ์ส่วนสูง) และส่วนสูงตามเกณฑ์อายุ · สูงดีสมส่วน = ส่วนสูงตามเกณฑ์ขึ้นไปและรูปร่างสมส่วน — อายุคิดจากวันเกิดถึงวันที่บันทึก ต้องมีวันเกิดและเพศในทะเบียน
      · แบบบันทึกน้ำหนัก ส่วนสูง และภาวะโภชนาการ พิมพ์ได้ที่ <a href="/docs.html?room=${encodeURIComponent(`${grade}/${room}`)}">คลังเอกสาร</a></p>`;
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
    // ช่วงเดียวกับเซิร์ฟเวอร์: น้ำหนัก 0–200 กก. ส่วนสูง 30–230 ซม. (ส่วนสูงต้องเป็นเซนติเมตร ไม่ใช่เมตร)
    const n = Number(v), [lo, hi] = t.dataset.f === "height" ? [30, 230] : [0, 200];
    const ok = v === "" || (/^\d{1,3}(\.\d)?$/.test(v) && n > lo && n < hi);
    t.parentElement.classList.toggle("invalid", !ok);
    t.title = ok ? "" : (t.dataset.f === "height" ? "ส่วนสูงเป็นเซนติเมตร 30–230" : "น้ำหนักเป็นกิโลกรัม มากกว่า 0 และไม่เกิน 200");
    if (!ok) return;
    const tr = t.closest("tr"), sid = Number(tr.dataset.sid), r = Number(t.dataset.r);
    const cur = { ...bodyOf(sid, r), [t.dataset.f]: v === "" ? null : Number(v) };
    ((data.body ||= {})[sid] ||= {})[r] = cur;
    ((data.body_dates ||= {})[sid] ||= {})[r] = todayIso();
    tr.querySelector("[data-bmi]").innerHTML = bmiText(sid);
    pendingB.set(`${sid}|${r}`, cur);
    schedule();
  });
  showState();
}

// ---------- อนุบาล: ประเมินพัฒนาการ 4 ด้าน (ความสามารถผู้เรียนเมื่อจบชั้นปี หลักสูตรปฐมวัย 2569) ----------
// ภาคเรียนละ 2 ครั้ง · 3 ดี · 2 พอใช้ · 1 ควรส่งเสริม · ผลของภาค = ครั้งล่าสุด · ผลสิ้นปี = ภาค 2 (ไม่มีใช้ภาค 1)
let kd = null;
const kst = (() => { try { return JSON.parse(sessionStorage.getItem("sr-hr-k") || "{}"); } catch { return {}; } })();
let kterm = [1, 2].includes(kst.term) ? kst.term : 1, kround = [1, 2].includes(kst.round) ? kst.round : 1, kdom = Math.min(3, Math.max(0, Number(kst.dom) || 0));
let ksumTerm = kst.sum ?? "year";
const saveK = () => { try { sessionStorage.setItem("sr-hr-k", JSON.stringify({ term: kterm, round: kround, dom: kdom, sum: ksumTerm })); } catch { /* */ } };
const kOptions = (v, blank = "–") => [["", blank], ...KINDER_LEVELS.map(([n, l]) => [String(n), `${n} ${l}`])]
  .map(([val, label]) => `<option value="${val}" ${String(v ?? "") === val ? "selected" : ""}>${label}</option>`).join("");
const kScore = (sid, code, t = kterm, r = kround) => kd.scores[sid]?.[code]?.[`${t}-${r}`] ?? "";
const kLevelText = (lv, avg) => (lv ? `${levelLabel(lv)}${avg != null ? ` (${fmt(avg, 2)})` : ""}` : "–");
const btnRow = (list, cur, attr) => list.map(([v, l]) => `<button class="btn small ${String(v) === String(cur) ? "primary" : ""}" data-${attr}="${v}">${l}</button>`).join("");

async function renderKinder() {
  if (!kd) { view.innerHTML = `<p class="muted">กำลังโหลด…</p>`; kd = await api(`/api/homeroom/kinder?${q}`); }
  if (!kd.items.length) { view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีรายการประเมินของชั้น ${esc(grade)}</strong>ระบบจะเพิ่มความสามารถผู้เรียนตามหลักสูตรปฐมวัย 2569 ให้อัตโนมัติ ลองโหลดหน้านี้ใหม่อีกครั้ง</div>`; return; }
  if (tab === "dev") renderDev();
  else if (tab === "devsum") renderDevSum();
  else renderKComments();
}

function renderDev() {
  const domain = KINDER_DOMAINS[kdom];
  const items = kd.items.filter((i) => i.domain === domain);
  const avgCell = (sid) => {
    const v = items.map((i) => kScore(sid, i.code)).filter((x) => x !== "");
    if (!v.length) return "–";
    const avg = v.reduce((a, b) => a + Number(b), 0) / v.length;
    return `${fmt(avg, 2)} <span class="small muted">${v.length}/${items.length}</span>`;
  };
  let lastSub = "";
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">${btnRow([[1, "ภาคเรียนที่ 1"], [2, "ภาคเรียนที่ 2"]], kterm, "kt")}<span class="muted small" style="margin:0 4px">·</span>${btnRow([[1, "ครั้งที่ 1"], [2, "ครั้งที่ 2"]], kround, "kr")}</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="actions" style="margin:0 0 10px">${btnRow(KINDER_DOMAINS.map((d, i) => [i, `${i + 1}. ${d.replace(/^ด้าน/, "")}`]), kdom, "kd")}</div>
    <p class="muted small" style="margin:0 0 8px">3 ดี · 2 พอใช้ · 1 ควรส่งเสริม — วางเมาส์/แตะหัวคอลัมน์เพื่ออ่านพฤติกรรมที่ประเมิน · "ทั้งห้อง" เติมเฉพาะช่องที่ยังว่าง · บันทึกอัตโนมัติ
      ${kround === 2 ? `· <button class="btn small" id="kCopy">คัดลอกผลครั้งที่ 1 มาเติมช่องว่าง</button>` : ""}</p>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead><tr><th class="stick no col-head">เลขที่</th><th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
        ${items.map((it) => { const head = it.sub !== lastSub ? (lastSub = it.sub) : ""; return `<th class="col-head" style="min-width:104px">
          ${head && head.includes("—") ? `<span class="max">${esc(head.split("—")[1].trim())}</span>` : ""}
          <button type="button" class="tip-btn" data-tip="${esc(`${it.code}: ${it.comp ? `${it.comp} — ` : ""}${it.title}`)}" aria-label="${esc(it.code)} ประเมินอะไร">${esc(shortCode(it.code))} <i class="i" aria-hidden="true">i</i></button>
          <select class="level-select fill" data-fill="${esc(it.code)}" aria-label="กรอกทั้งห้อง ${esc(it.code)}">${kOptions("", "ทั้งห้อง…")}</select></th>`; }).join("")}
        <th class="col-head">ทุกข้อ</th><th class="col-head">เฉลี่ยด้านนี้</th></tr></thead>
      <tbody>${data.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${items.map((it) => { const v = kScore(s.id, it.code); return `<td><select class="level-select kv${v}" data-code="${esc(it.code)}" aria-label="${esc(s.name)} ${esc(it.code)}">${kOptions(v)}</select></td>`; }).join("")}
        <td><select class="level-select fill" data-row aria-label="ทุกข้อของ ${esc(s.name)}">${kOptions("", "ทุกข้อ…")}</select></td>
        <td class="calc" data-avg>${avgCell(s.id)}</td></tr>`).join("")}</tbody>
    </table></div>
    <details class="small muted" style="margin-top:10px"><summary>พฤติกรรมที่ประเมิน — ${esc(domain)} (${items.length} ข้อ)</summary>
      <ol style="margin:6px 0 0;padding-left:22px">${items.map((it) => `<li><b>${esc(it.code)}</b> ${it.comp ? `<i>${esc(it.comp)}</i> — ` : ""}${esc(it.title)}</li>`).join("")}</ol></details>`;
  for (const b of view.querySelectorAll("[data-kt]")) b.onclick = () => { kterm = Number(b.dataset.kt); saveK(); renderDev(); };
  for (const b of view.querySelectorAll("[data-kr]")) b.onclick = () => { kround = Number(b.dataset.kr); saveK(); renderDev(); };
  for (const b of view.querySelectorAll("[data-kd]")) b.onclick = () => { kdom = Number(b.dataset.kd); saveK(); renderDev(); };
  const table = document.getElementById("sheet");
  const setK = (sid, code, v, sel) => {
    const m = (((kd.scores[sid] ||= {})[code]) ||= {});
    if (v === "") delete m[`${kterm}-${kround}`]; else m[`${kterm}-${kround}`] = Number(v);
    if (sel) { sel.value = v; sel.className = `level-select kv${v}`; }
    const avg = table.querySelector(`tr[data-sid="${sid}"] [data-avg]`);
    if (avg) avg.innerHTML = avgCell(sid);
    pendingK.set(`${kterm}|${kround}|${sid}|${code}`, v === "" ? "" : Number(v));
    schedule();
  };
  const copy = document.getElementById("kCopy");
  if (copy) copy.onclick = () => {
    let n = 0;
    for (const s of active()) for (const it of items) {
      const prev = kScore(s.id, it.code, kterm, 1);
      if (prev === "" || kScore(s.id, it.code) !== "") continue;
      setK(s.id, it.code, String(prev), table.querySelector(`tr[data-sid="${s.id}"] select[data-code="${CSS.escape(it.code)}"]`)); n++;
    }
    toast(n ? `เติมจากครั้งที่ 1 แล้ว ${n} ช่อง` : "ไม่มีช่องว่างที่เติมได้");
  };
  table.addEventListener("change", (e) => {
    const sel = e.target;
    if (sel.dataset.fill) {
      const v = sel.value; sel.value = "";
      if (!v) return;
      let n = 0;
      for (const s of active()) {
        const cell = table.querySelector(`tr[data-sid="${s.id}"] select[data-code="${CSS.escape(sel.dataset.fill)}"]`);
        if (cell && !cell.value) { setK(s.id, sel.dataset.fill, v, cell); n++; }
      }
      toast(n ? `กรอกให้ ${n} คนที่ยังว่าง` : "ทุกคนมีค่าแล้ว (ไม่เขียนทับ)");
      return;
    }
    if ("row" in sel.dataset) {
      const v = sel.value; sel.value = "";
      if (!v) return;
      const tr = sel.closest("tr"), sid = Number(tr.dataset.sid);
      for (const cell of tr.querySelectorAll("select[data-code]")) setK(sid, cell.dataset.code, v, cell);
      return;
    }
    if (sel.dataset.code) setK(Number(sel.closest("tr").dataset.sid), sel.dataset.code, sel.value, sel);
  });
  showState();
}

function renderDevSum() {
  const t = ksumTerm === "year" ? "year" : Number(ksumTerm);
  const rows = data.students.map((s) => ({ s, doms: domainSummary(kd.items, kd.scores[s.id], t), all: overallSummary(kd.items, kd.scores[s.id], t) }));
  const count = (di, lv) => rows.filter((r) => r.s.enrollment_status === "enrolled" && (di < 0 ? r.all.level : r.doms[di].level) === lv).length;
  const lvCell = (x) => `<td class="calc ${x.level === 1 ? "warn-text" : ""}">${kLevelText(x.level, x.avg)}${x.n && x.n < x.total ? ` <span class="small muted">${x.n}/${x.total}</span>` : ""}</td>`;
  const pq = `grade=${encodeURIComponent(grade)}&room=${encodeURIComponent(room)}${yearQ}`;
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">${btnRow([[1, "ภาคเรียนที่ 1"], [2, "ภาคเรียนที่ 2"], ["year", "สรุปสิ้นปี"]], ksumTerm, "ks")}</span>
      <span class="actions"><a class="btn small" target="_blank" rel="noopener" href="/print/kinder.html?${pq}">${ICONS.print} สมุดรายงานพัฒนาการรายคน</a>
        <a class="btn small" target="_blank" rel="noopener" href="/print/kinder.html?${pq}&mode=room">${ICONS.print} สรุปผลทั้งห้อง</a></span>
    </div>
    <div class="sheet-wrap"><table class="sheet">
      <thead><tr><th class="stick no col-head">เลขที่</th><th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
        ${KINDER_DOMAINS.map((d) => `<th class="col-head"><span class="t">${esc(d)}</span></th>`).join("")}<th class="col-head">รวม 4 ด้าน</th></tr></thead>
      <tbody>${rows.map(({ s, doms, all }) => `<tr class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}"><td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${doms.map(lvCell).join("")}${lvCell(all)}</tr>`).join("")}</tbody>
      <tfoot>${KINDER_LEVELS.map(([lv, l]) => `<tr><td class="stick no"></td><td class="stick name">${l} (คน)</td>${[0, 1, 2, 3, -1].map((di) => `<td class="calc">${count(di, lv) || ""}</td>`).join("")}</tr>`).join("")}</tfoot>
    </table></div>
    <p class="muted small" style="margin-top:10px">ผลแต่ละข้อของภาคเรียน = ผลการประเมินครั้งล่าสุดของภาคนั้น · สรุปสิ้นปีใช้ผลภาคเรียนที่ 2 (ข้อที่ยังไม่ประเมินในภาค 2 ใช้ภาค 1)
      · ระดับรายด้าน = ค่าเฉลี่ย 2.50–3.00 ดี · 1.50–2.49 พอใช้ · ต่ำกว่า 1.50 ควรส่งเสริม · ตัวเลข n/N = ประเมินแล้ว n จาก N ข้อ</p>`;
  for (const b of view.querySelectorAll("[data-ks]")) b.onclick = () => { ksumTerm = b.dataset.ks === "year" ? "year" : Number(b.dataset.ks); saveK(); renderDevSum(); };
}

const kCommentOf = (sid, f) => kd.comments?.[sid]?.[kterm]?.[f] ?? "";
function renderKComments() {
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">${btnRow([[1, "ภาคเรียนที่ 1"], [2, "ภาคเรียนที่ 2"]], kterm, "kt")}</span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <p class="muted small" style="margin:0 0 8px">ความคิดเห็นของครูรายด้าน (ไม่เกิน 300 ตัวอักษรต่อช่อง) ขึ้นในสมุดรายงานพัฒนาการรายคน · บันทึกอัตโนมัติ</p>
    ${spellBar()}
    <div class="cm-head k5">${["นักเรียน", ...KINDER_COMMENT_FIELDS.map(([, l]) => l)].map((l) => `<span>${esc(l)}</span>`).join("")}</div>
    <div id="cmList">${data.students.map((s) => `<div class="cm-row k5 ${s.enrollment_status !== "enrolled" ? "inactive" : ""}" data-sid="${s.id}">
      <span class="cm-name"><b>${s.number ?? ""}</b> ${esc(s.name)}</span>
      ${KINDER_COMMENT_FIELDS.map(([f, l]) => `<label class="cm-field"><span class="cm-label">${esc(l)}</span><textarea rows="2" maxlength="300" data-f="${f}" aria-label="${esc(s.name)} ${esc(l)}">${esc(kCommentOf(s.id, f))}</textarea><span class="sp-issues" hidden></span></label>`).join("")}
    </div>`).join("")}</div>`;
  for (const b of view.querySelectorAll("[data-kt]")) b.onclick = async () => { if (!(await leaveHeld())) return; await flush(); kterm = Number(b.dataset.kt); saveK(); renderKComments(); };
  const list = document.getElementById("cmList");
  list.addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const sid = Number(e.target.closest(".cm-row").dataset.sid);
    ((kd.comments ||= {})[sid] ||= {})[kterm] ||= {};
    commentChanged("k", kterm, sid, f, e.target.value);
  });
  wireSpell(list, "k");
  showState();
}

// ---------- ตรวจคำที่อาจสะกดผิด (ความคิดเห็นครูประจำชั้น ป. และอนุบาล) ----------
// พบคำผิด → ช่องนั้นไม่บันทึกอัตโนมัติ · แก้ตามคำแนะนำ / เพิ่มคำเข้าพจนานุกรมของฉัน / ยืนยันบันทึก 2 รอบ
let checker = null, checkerJob = null, ignoreNames = null;
function loadChecker() {
  return checkerJob ||= (async () => {
    const res = await fetch("/assets/thai-words.txt");
    if (!res.ok) throw new Error("โหลดพจนานุกรมไม่สำเร็จ");
    checker = createChecker((await res.text()).split("\n"), data.spell_words || []);
    return checker;
  })().catch((err) => { checkerJob = null; throw err; });
}
// ชื่อ–สกุลนักเรียนและครูในห้อง ไม่ต้องตรวจ
function namesToIgnore() {
  if (ignoreNames) return ignoreNames;
  const out = new Set();
  for (const n of [...data.students.map((s) => s.name), ...(data.teachers || [])]) {
    const clean = String(n || "").replace(/^(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นางสาว|นาย|นาง|ว่าที่ร้อยตรี|ว่าที่ ร\.ต\.)\s*/, "");
    for (const part of clean.split(/\s+/)) if (part.length >= 2) out.add(part);
  }
  return (ignoreNames = [...out].sort((a, b) => b.length - a.length));
}
const checkText = (body) => checker.check(body, namesToIgnore());
const spellKey = (kind, term, sid, f) => `${kind}|${term}|${sid}|${f}`;
const commentStore = (kind) => (kind === "p" ? data.comments : kd.comments);
const pendingOf = (kind) => (kind === "p" ? pendingC : pendingKC);

function spellBar() {
  return `<p class="muted small sp-bar" id="spellBar">${checker ? "ระบบตรวจการสะกดคำอัตโนมัติ — ช่องที่สะกดคำไม่ถูกจะยังไม่บันทึกจนกว่าจะแก้ หรือกดยืนยันบันทึก 2 ครั้ง"
    : "กำลังโหลดพจนานุกรมสำหรับตรวจคำผิด…"} · <button type="button" class="link-btn" id="myWords">พจนานุกรมของฉัน (${(data.spell_words || []).length})</button></p>`;
}

// ข้อความเปลี่ยน: เก็บไว้ก่อน แล้วตรวจเมื่อหยุดพิมพ์ — ผ่าน → ส่งบันทึก, ไม่ผ่าน → กักไว้
function commentChanged(kind, term, sid, f, body, { force = false } = {}) {
  const key = spellKey(kind, term, sid, f), store = commentStore(kind);
  if (!held.has(key) && !heldOrig.has(key)) heldOrig.set(key, store[sid][term][f] ?? "");
  store[sid][term][f] = body;
  clearTimeout(checking.get(key));
  checking.delete(key);
  if (force) return release(key, kind, term, sid, f, body);
  held.delete(key);
  pendingOf(kind).delete(`${term}|${sid}|${f}`);
  checking.set(key, setTimeout(() => { checking.set(key, "judging"); judge(kind, term, sid, f); }, 400));
  showState();
}
function release(key, kind, term, sid, f, body) {
  held.delete(key); heldOrig.delete(key);
  pendingOf(kind).set(`${term}|${sid}|${f}`, body);
  schedule();
}
async function judge(kind, term, sid, f) {
  const key = spellKey(kind, term, sid, f), body = commentStore(kind)[sid]?.[term]?.[f] ?? "";
  const done = () => { if (checking.get(key) === "judging") checking.delete(key); };
  const ta = () => { const el = view.querySelector(`.cm-row[data-sid="${sid}"] textarea[data-f="${f}"]`); return el && el.value === body && Number(term) === (kind === "p" ? cterm : kterm) ? el : null; };
  if (!body.trim()) { done(); const el = ta(); if (el) drawIssues(el); release(key, kind, term, sid, f, body); return; }
  try { await loadChecker(); } catch (err) { done(); showError(err); held.set(key, body); showState(); return; }
  if (checking.has(key) && checking.get(key) !== "judging") return; // พิมพ์ต่อระหว่างโหลด → รอรอบใหม่
  done();
  const el = ta();
  if (el) drawIssues(el);
  if (checkText(body).length) { held.set(key, body); showState(); }
  else release(key, kind, term, sid, f, body);
}

// แสดงคำที่อาจผิดใต้ช่อง พร้อมคำแนะนำ
function drawIssues(ta) {
  const box = ta.parentElement.querySelector(".sp-issues");
  if (!box || (!checker && ta.value.trim())) return;
  const issues = ta.value.trim() ? checkText(ta.value) : [];
  ta.classList.toggle("sp-bad", issues.length > 0);
  box.hidden = !issues.length;
  // ขีดเส้นใต้คำที่ผิด + ปุ่มคำที่ถูก (แตะเพื่อแก้)
  box.innerHTML = issues.length ? `<span class="sp-title">ท่านสะกดคำไม่ถูก</span> ${issues.slice(0, 6).map((x, i) => `<span class="sp-item" title="${esc(x.note)}"><b>${esc(x.word)}</b>${
    x.suggest.length ? ` → ${x.suggest.map((w) => `<button type="button" class="sp-fix" data-i="${i}" data-to="${esc(w)}" title="แตะเพื่อแก้เป็นคำนี้">${esc(w)}</button>`).join(" ")}` : ""}${
    (x.kind === "unknown" || x.kind === "context") && !/\s/.test(x.word) ? ` <button type="button" class="sp-add" data-word="${esc(x.word)}" title="คำนี้ถูกต้อง — ไม่ต้องเตือนอีก">+ คำนี้ถูก</button>` : ""}</span>`).join("")}${issues.length > 6 ? ` <span class="muted">และอีก ${issues.length - 6} คำ</span>` : ""}` : "";
  box._issues = issues;
}
function drawAllIssues() { for (const ta of view.querySelectorAll("#cmList textarea[data-f]")) if (ta.value.trim()) drawIssues(ta); }

function wireSpell(list, kind) {
  const ready = () => {
    const bar = document.getElementById("spellBar");
    if (bar) bar.outerHTML = spellBar();
    document.getElementById("myWords").onclick = myWordsDialog;
    drawAllIssues();
    // ข้อความที่พิมพ์ระหว่างโหลดพจนานุกรม → ตรวจตอนนี้
    for (const key of [...held.keys()]) { const [k, t, sid, f] = key.split("|"); if (k === kind) judge(k, Number(t), Number(sid), f); }
  };
  document.getElementById("myWords").onclick = myWordsDialog;
  if (checker) drawAllIssues(); else loadChecker().then(() => { if (list.isConnected) ready(); }).catch((err) => showError(err));
  const term = () => (kind === "p" ? cterm : kterm);
  list.addEventListener("click", async (e) => {
    const fix = e.target.closest(".sp-fix"), add = e.target.closest(".sp-add");
    if (!fix && !add) return;
    e.preventDefault();
    if (add) { await addWord(add.dataset.word); return; }
    const ta = e.target.closest(".cm-field").querySelector("textarea"), sid = Number(e.target.closest(".cm-row").dataset.sid), f = ta.dataset.f;
    const x = ta.parentElement.querySelector(".sp-issues")._issues[Number(fix.dataset.i)];
    ta.value = (ta.value.slice(0, x.start) + fix.dataset.to + ta.value.slice(x.end)).slice(0, 300);
    ((commentStore(kind) || {})[sid] ||= {})[term()] ||= {};
    if (kind === "p") setComment(sid, f, ta.value); else commentChanged(kind, term(), sid, f, ta.value);
    drawIssues(ta); // คำอื่นที่ยังผิดยังแสดงอยู่
    ta.focus();
  });
}

async function addWord(word) {
  try {
    data.spell_words = (await api("/api/homeroom/spell-words", { method: "POST", body: { word } })).spell_words;
    afterWordsChanged();
    toast(`เพิ่ม "${word}" ในพจนานุกรมของฉันแล้ว`);
  } catch (err) { showError(err); }
}
function afterWordsChanged() {
  checker?.setCustom(data.spell_words || []);
  const btn = document.getElementById("myWords");
  if (btn) btn.textContent = `พจนานุกรมของฉัน (${(data.spell_words || []).length})`;
  drawAllIssues();
  for (const key of [...held.keys()]) { const [k, t, sid, f] = key.split("|"); judge(k, Number(t), Number(sid), f); }
}
async function myWordsDialog() {
  await dialog({
    title: "พจนานุกรมของฉัน", okText: "", cancelText: "ปิด",
    body: `<p class="muted small" style="margin-top:0">คำที่ระบบไม่รู้จักแต่ถูกต้อง (เช่น ชื่อเฉพาะ ชื่อเล่น) — ใช้ได้ทุกห้องที่คุณดูแล เพิ่มได้จากปุ่ม "+ คำนี้ถูก" ใต้ช่องความคิดเห็น</p>
      <div class="chips" id="wordChips"></div>`,
    onOpen: (d) => {
      const draw = () => {
        const box = d.querySelector("#wordChips");
        box.innerHTML = (data.spell_words || []).map((w) => `<span class="chip"><span class="chip-use">${esc(w)}</span><button type="button" class="chip-x" data-del="${esc(w)}" aria-label="ลบ ${esc(w)}">×</button></span>`).join("") || `<span class="muted small">ยังไม่มีคำ</span>`;
        for (const b of box.querySelectorAll("[data-del]")) b.onclick = async () => {
          try { data.spell_words = (await api("/api/homeroom/spell-words", { method: "DELETE", body: { word: b.dataset.del } })).spell_words; afterWordsChanged(); draw(); } catch (err) { showError(err); }
        };
      };
      draw();
    },
  });
}

// รายการช่องที่ถูกกักไว้ (สำหรับแสดงในกล่องยืนยัน)
function heldList() {
  const items = [];
  for (const [key, body] of held) {
    const [kind, , sid, f] = key.split("|");
    const st = data.students.find((s) => s.id === Number(sid));
    const label = (kind === "p" ? CFIELDS : KINDER_COMMENT_FIELDS).find(([x]) => x === f)?.[1] || f;
    const words = checker ? checkText(body).map((x) => x.word) : [];
    items.push(`<li>เลขที่ ${esc(st?.number ?? "")} ${esc(st?.name || "")} · ${esc(label)}${words.length ? `: <b>${words.slice(0, 5).map(esc).join(", ")}</b>` : ""}</li>`);
  }
  return items;
}
// ยืนยัน 2 รอบ → true = บันทึกได้
async function confirmTwice(listHtml, count, what) {
  const r1 = await dialog({
    title: "ท่านสะกดคำไม่ถูก", okText: "บันทึกต่อ (ยืนยันครั้งที่ 1/2)", cancelText: "กลับไปแก้ไข",
    body: `<p style="margin-top:0">ระบบตรวจพบคำที่อาจสะกดผิดใน${what} ${count} ช่อง จึงยังไม่บันทึก</p>
      <ul class="sp-confirm">${listHtml}</ul>
      <p class="muted small">ภาษาไทยตรวจได้ไม่สมบูรณ์ ถ้าตรวจทานแล้วว่าถูกต้องสามารถบันทึกต่อได้ (ต้องยืนยัน 2 ครั้ง)</p>`,
  });
  if (!r1.ok) return false;
  return confirmBox("ยืนยันครั้งที่ 2", `ตรวจทานแล้วว่าข้อความถูกต้อง และต้องการบันทึก${what} ${count} ช่องตามที่พิมพ์ไว้ ใช่หรือไม่?`, "ยืนยันบันทึก (ครั้งที่ 2/2)", true);
}
async function forceSaveHeld() {
  if (!held.size) return;
  const items = heldList();
  if (!(await confirmTwice(items.slice(0, 15).join("") + (items.length > 15 ? `<li class="muted">และอีก ${items.length - 15} ช่อง</li>` : ""), items.length, "ความคิดเห็น"))) return;
  for (const [key, body] of [...held]) { const [kind, t, sid, f] = key.split("|"); release(key, kind, Number(t), Number(sid), f, body); }
  await flush();
  toast("บันทึกแล้ว");
}
// ข้อความเดียว (ใช้กับทั้งห้อง / เก็บเข้าคลัง): มีคำผิด → ต้องยืนยัน 2 รอบ
async function confirmMisspelled(body, what) {
  try { await loadChecker(); } catch { return true; } // โหลดพจนานุกรมไม่ได้: ไม่ขวางการทำงาน
  const issues = checkText(body);
  if (!issues.length) return true;
  return confirmTwice(`<li>${esc(body)}<br><b>${issues.map((x) => esc(x.word)).join(", ")}</b></li>`, 1, `ข้อความที่จะ${what}`);
}
// ออกจากแท็บ/เปลี่ยนภาคเรียน ขณะยังมีช่องที่ถูกกักไว้
async function leaveHeld() {
  for (const [key, t] of [...checking]) { clearTimeout(t); checking.delete(key); const [k, term, sid, f] = key.split("|"); await judge(k, Number(term), Number(sid), f); }
  if (!held.size) return true;
  const ok = await confirmBox("ยังไม่ได้บันทึกบางช่อง", `มี ${held.size} ช่องที่ยังไม่บันทึกเพราะพบคำที่อาจสะกดผิด — ถ้าออกตอนนี้ ข้อความที่แก้ในช่องเหล่านั้นจะไม่ถูกบันทึก`, "ออกโดยไม่บันทึก", true);
  if (!ok) return false;
  for (const key of held.keys()) {
    const [kind, term, sid, f] = key.split("|");
    const st = commentStore(kind)?.[sid]?.[term];
    if (st) st[f] = heldOrig.get(key) ?? "";
    heldOrig.delete(key);
  }
  held.clear();
  showState();
  return true;
}

// ---------- บันทึกอัตโนมัติ (ทุกแท็บ) ----------
function schedule() { showState(); clearTimeout(timer); timer = setTimeout(flush, 700); }

async function flush() {
  if (saving || !anyPending()) return;
  saving = true;
  const a = [...pending.entries()], c = [...pendingC.entries()], b = [...pendingB.entries()], at = [...pendingA.entries()], k = [...pendingK.entries()], kc = [...pendingKC.entries()];
  pending.clear(); pendingC.clear(); pendingB.clear(); pendingA.clear(); pendingK.clear(); pendingKC.clear();
  showState();
  // ส่งแยกทีละหมวด: หมวดหนึ่งผิด (400) ไม่ทำให้หมวดอื่นค้าง · เครือข่ายขัดข้อง → เก็บไว้ลองใหม่
  const jobs = [
    [a, pending, (l) => api(`/api/homeroom/assessments?${q}`, { method: "PUT", body: { changes: l.map(([k, value]) => { const [sid, item_key] = k.split("|"); return { student_id: Number(sid), item_key, value }; }) } }), "การประเมิน"],
    ...[1, 2].map((t) => [c.filter(([k]) => k.startsWith(`${t}|`)), pendingC,
      (l) => api(`/api/homeroom/comments?${q}`, { method: "PUT", body: { term: t, changes: l.map(([k, body]) => { const [, sid, field] = k.split("|"); return { student_id: Number(sid), field, body }; }) } }), `ความคิดเห็นภาค ${t}`]),
    [b, pendingB, (l) => api(`/api/homeroom/body?${q}`, { method: "PUT", body: { changes: l.map(([k, v]) => { const [sid, round] = k.split("|").map(Number); return { student_id: sid, round, weight: v.weight, height: v.height }; }) } }), "น้ำหนักส่วนสูง"],
    [at, pendingA, (l) => api(`/api/homeroom/attendance?${q}`, { method: "PUT", body: { changes: l.map(([k, code]) => { const [sid, date] = k.split("|"); return { student_id: Number(sid), date, code }; }) } }), "การมาเรียน"],
    [k, pendingK, (l) => api(`/api/homeroom/kinder/scores?${q}`, { method: "PUT", body: { changes: l.map(([key, score]) => { const [term, round, sid, code] = key.split("|"); return { term: Number(term), round: Number(round), student_id: Number(sid), code, score }; }) } }), "ผลประเมินพัฒนาการ"],
    ...[1, 2].map((t) => [kc.filter(([key]) => key.startsWith(`${t}|`)), pendingKC,
      (l) => api(`/api/homeroom/kinder/comments?${q}`, { method: "PUT", body: { term: t, changes: l.map(([key, body]) => { const [, sid, field] = key.split("|"); return { student_id: Number(sid), field, body }; }) } }), `ความคิดเห็นภาค ${t}`]),
  ];
  let netErr = null, rejected = 0;
  for (const [list, map, send, label] of jobs) {
    if (!list.length) continue;
    try { await send(list); }
    catch (err) {
      if (err.status >= 400 && err.status < 500) {
        // ข้อมูลบางรายการไม่ผ่านการตรวจ (เช่น วันนั้นถูกตั้งเป็นวันหยุด นักเรียนย้ายออกไปแล้ว):
        // ส่งทีละรายการเพื่อบันทึกรายการที่ถูกต้องให้ครบ และทิ้งเฉพาะรายการที่ผิด
        const bad = [];
        if (list.length === 1) bad.push(err.message);
        else for (const one of list) {
          try { await send([one]); }
          catch (e1) {
            if (e1.status >= 400 && e1.status < 500) bad.push(e1.message);
            else { netErr = e1; if (!map.has(one[0])) map.set(one[0], one[1]); }
          }
        }
        if (bad.length) { rejected += bad.length; showError(`${label}: บันทึกไม่ได้ ${bad.length} รายการ — ${bad[0]}`); reloadSoon(); }
      } else { netErr = err; for (const [k, v] of list) if (!map.has(k)) map.set(k, v); }
    }
  }
  saving = false;
  if (netErr) { showState(netErr); showError(netErr); return; }
  showState();
  if (anyPending()) flush();
}
let reloadTimer;
function reloadSoon() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    if (anyPending() || saving) return reloadSoon();
    try { data = await api(`/api/homeroom?${q}`); kd = null; render(); } catch { /* ลองครั้งหน้า */ }
  }, 1500);
}

function showState(err) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.className = "save-state";
  if (err) { el.classList.add("error"); el.innerHTML = `บันทึกไม่สำเร็จ <button class="btn small" id="retry">ลองอีกครั้ง</button>`; document.getElementById("retry").onclick = flush; }
  else if (saving || anyPending() || checking.size) { el.classList.add("pending"); el.textContent = "กำลังบันทึก…"; }
  else if (held.size) {
    el.classList.add("error");
    el.innerHTML = `ยังไม่บันทึก ${held.size} ช่อง — สะกดคำไม่ถูก <button class="btn small" id="forceSave">บันทึกทั้งที่มีคำผิด</button>`;
    document.getElementById("forceSave").onclick = forceSaveHeld;
  }
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

// ---------- บันทึกการมาเรียน (ตารางรายเดือน) ----------
// มาเรียนปกติเว้นว่าง · ใส่ ข ขาด / ล ลากิจ / ป ลาป่วย / ส มาสาย · บันทึกอัตโนมัติ
const ATT = { "ข": "ขาดเรียน", "ล": "ลากิจ", "ป": "ลาป่วย", "ส": "มาสาย" };
const ATT_ALIAS = { "ข": "ข", "ล": "ล", "ป": "ป", "ส": "ส" }; // มส ไม่รับ (มส = หมดสิทธิ์สอบ ไม่ใช่รหัสการมาเรียน)
let attMonth = sessionStorage.getItem("sr-hr-month") || "";
let att;
const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("th-TH", { month: "long", year: "numeric" });

async function renderAttendance() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  att = await api(`/api/homeroom/attendance?${q}${attMonth ? `&month=${attMonth}` : ""}`);
  attMonth = att.month;
  const idx = att.months.indexOf(att.month);
  const codeOf = (sid, d) => att.records[sid]?.[d] || "";
  const counts = (sid) => { const c = { "ข": 0, "ล": 0, "ป": 0, "ส": 0 }; for (const v of Object.values(att.records[sid] || {})) c[v]++; return c; };
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">
        <button class="btn small" id="mPrev" ${idx <= 0 ? "disabled" : ""} aria-label="เดือนก่อน">‹</button>
        <select id="mSel" aria-label="เดือน">${(att.months.length ? att.months : [att.month]).map((m) => `<option value="${m}" ${m === att.month ? "selected" : ""}>${monthName(m)}</option>`).join("")}</select>
        <button class="btn small" id="mNext" ${idx < 0 || idx >= att.months.length - 1 ? "disabled" : ""} aria-label="เดือนถัดไป">›</button>
        <span class="att-legend small">${Object.entries(ATT).map(([k, v]) => `<span><b class="att-code c-${k}">${k}</b> ${v}</span>`).join("")} <span class="muted">ว่าง = มาเรียน</span></span>
      </span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    ${att.holidays?.length ? `<p class="muted small" style="margin:0 0 8px">วันหยุดเดือนนี้ (ไม่แสดงในตาราง): ${att.holidays.map((h) => `${new Date(`${h.holiday_date}T00:00:00`).getDate()} ${esc(h.name)}`).join(" · ")}</p>` : ""}
    ${att.days.length ? `<div class="sheet-wrap"><table class="sheet att-sheet" id="sheet">
      <thead><tr><th class="stick no col-head">เลขที่</th><th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
        ${att.days.map((d) => { const dt = new Date(`${d}T00:00:00`); return `<th class="col-head att-day ${d === att.today ? "today" : ""}"><span class="wd">${WD[dt.getDay()]}</span><b>${dt.getDate()}</b></th>`; }).join("")}
        ${Object.keys(ATT).map((k) => `<th class="col-head att-sum" data-tip="${ATT[k]} (วัน) ในเดือนนี้">${k}</th>`).join("")}</tr></thead>
      <tbody>${data.students.map((s) => { const c = counts(s.id); return `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name" title="${esc(s.name)}">${esc(s.name)}</td>
        ${att.days.map((d) => { const v = codeOf(s.id, d); return `<td class="cell att ${v ? `c-${v}` : ""} ${d === att.today ? "today" : ""}"><input data-date="${d}" value="${esc(v)}" maxlength="2" autocomplete="off" aria-label="${esc(s.name)} ${d}"></td>`; }).join("")}
        ${Object.keys(ATT).map((k) => `<td class="calc att-sum" data-n="${k}">${c[k] || ""}</td>`).join("")}</tr>`; }).join("")}</tbody>
    </table></div>
    <p class="muted small" style="margin-top:10px">พิมพ์ ข ล ป หรือ ส (ส = มาสาย) แล้วกด Enter ลงไปคนถัดไป · ลูกศรเลื่อนช่อง · ลบตัวอักษร = มาเรียน · วันหยุดที่ฝ่ายวัดผลตั้งไว้จะไม่แสดงในตาราง
      · หนังสือแจ้งผู้ปกครองกรณีขาดเรียน (บค.) พิมพ์ได้ที่ <a href="/docs.html?room=${encodeURIComponent(`${grade}/${room}`)}">คลังเอกสาร</a></p>`
    : `<div class="panel empty"><strong>เดือนนี้ไม่มีวันเรียน</strong>อยู่นอกช่วงภาคเรียน</div>`}`;
  const go = async (m) => { await flush(); attMonth = m; sessionStorage.setItem("sr-hr-month", m); renderAttendance().catch(showError); };
  document.getElementById("mSel").onchange = (e) => go(e.target.value);
  document.getElementById("mPrev").onclick = () => go(att.months[idx - 1]);
  document.getElementById("mNext").onclick = () => go(att.months[idx + 1]);
  const table = document.getElementById("sheet");
  if (!table) return;
  const inputs = () => [...table.querySelectorAll("tbody input")];
  const cols = att.days.length;
  const move = (inp, dr, dc) => {
    const all = inputs(), i = all.indexOf(inp), r = Math.floor(i / cols) + dr, c = (i % cols) + dc;
    if (c < 0 || c >= cols) return;
    const t = all[r * cols + c]; if (t) { t.focus(); t.select(); }
  };
  const accept = (inp) => {
    const raw = inp.value.trim();
    const code = raw === "" ? "" : ATT_ALIAS[raw];
    const td = inp.parentElement;
    if (code === undefined) { td.classList.add("invalid"); inp.title = "ใส่ได้เฉพาะ ข ล ป ส (ส = มาสาย)"; return; }
    td.classList.remove("invalid"); inp.title = "";
    if (raw !== code) inp.value = code;
    const tr = inp.closest("tr"), sid = Number(tr.dataset.sid), d = inp.dataset.date;
    if ((att.records[sid]?.[d] || "") === code) return;
    if (code) (att.records[sid] ||= {})[d] = code; else delete att.records[sid]?.[d];
    td.className = `cell att ${code ? `c-${code}` : ""} ${d === att.today ? "today" : ""}`;
    const c = counts(sid);
    for (const el of tr.querySelectorAll("[data-n]")) el.textContent = c[el.dataset.n] || "";
    pendingA.set(`${sid}|${d}`, code);
    showState(); clearTimeout(timer); timer = setTimeout(flush, 700);
  };
  table.addEventListener("focusin", (e) => { if (e.target.matches("input")) e.target.select(); });
  table.addEventListener("input", (e) => {
    const inp = e.target, v = inp.value.trim();
    if (!inp.matches("input")) return;
    accept(inp);
  });
  table.addEventListener("change", (e) => { if (e.target.matches("input")) accept(e.target); });
  table.addEventListener("keydown", (e) => {
    const t = e.target;
    if (!t.matches("input")) return;
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); accept(t); move(t, 1, 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); accept(t); move(t, -1, 0); }
    else if (e.key === "ArrowRight" || e.key === "Tab" && !e.shiftKey) { if (e.key === "ArrowRight") { e.preventDefault(); accept(t); move(t, 0, 1); } }
    else if (e.key === "ArrowLeft") { e.preventDefault(); accept(t); move(t, 0, -1); }
  });
  table.querySelector("th.today")?.scrollIntoView({ block: "nearest", inline: "center" });
}

renderTabs();
render();
