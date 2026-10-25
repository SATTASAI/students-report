// บันทึกประจำวันของครูประจำชั้น 5 เล่ม: ดื่มนม แปรงฟัน อาหารกลางวัน เขตรับผิดชอบ (ติ๊กรายวัน) + ตรวจสุขภาพ (สัปดาห์ละครั้ง)
// หน้าละ 1 เดือน วันในตารางมาจากปฏิทินวันหยุด · ส่งออก Excel (.xlsx) และพิมพ์/บันทึกเป็น PDF ได้ทั้งเดือนนี้และทั้งปีการศึกษา
import { shell, api, esc, toast, showError, params, dialog, monthsOfTerm, TERM_LABEL } from "/js/app.js";
import { loadXlsx } from "/js/export.js";
import { LOG_FORMS, LOG_TITLE, ABS_LABEL, monthLabel, dayShort, weekdayOf, dayNum, dailyModel, healthModel, weekRange, sheetForMonth } from "/js/logbook-data.js";

const me = await shell("logs");
const view = document.getElementById("view");
document.getElementById("main").hidden = false;
const Y = me.year.id, T = me.term;
// เฉพาะเดือนในภาคเรียนที่เลือก
const TR = (me.terms || []).find((t) => t.term_number === T);
const termMonth = (m) => {
  if (!TR) return m;
  const a = TR.start_date.slice(0, 7), b = TR.end_date.slice(0, 7);
  if (m && m >= a && m <= b) return m;
  const now = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  return now >= a && now <= b ? now : a;
};
document.getElementById("yearLine").textContent = `ปีการศึกษา ${me.year.year_be} · ดื่มนม แปรงฟัน อาหารกลางวัน เขตรับผิดชอบ และตรวจสุขภาพ — วันในตารางตามปฏิทินวันหยุด`;

let meta;
// บทบาทครู → เฉพาะห้องที่ตนเป็นครูประจำชั้น · บทบาทวัดผล → ดูทุกห้อง แต่บันทึกได้เฉพาะห้องของตน
const SCOPE = me.role === "teacher" ? "&scope=teacher" : "";
try { meta = await api(`/api/homeroom/logs?year=${Y}${SCOPE}`); }
catch (err) { view.innerHTML = `<div class="panel empty"><strong>เปิดไม่ได้</strong>${esc(err.message)}</div>`; throw err; }
if (!meta.rooms.length) {
  view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีห้องที่บันทึกได้</strong>หน้านี้สำหรับครูประจำชั้น — ฝ่ายวัดผลกำหนดครูประจำชั้นที่เมนู "ครูประจำชั้น"</div>`;
  throw new Error("no rooms");
}
const key = (r) => `${r.grade_level}/${r.classroom}`;
let room = params().get("room") || sessionStorage.getItem("sr-log-room");
if (!meta.rooms.some((r) => key(r) === room)) room = key(meta.rooms.find((r) => r.can_edit) || meta.rooms[0]);
let logType = params().get("type") || sessionStorage.getItem("sr-hr-log") || "milk";
if (!LOG_FORMS.some(([k]) => k === logType)) logType = "milk";
let month = sessionStorage.getItem("sr-hr-month") || "";
const pending = new Map(); // "ห้อง|sid|type|date" → "" | 1 | ok | no
let saving = false, timer, d;
const roomQ = (r = room) => { const [g, c] = r.split("/"); return `year=${Y}&grade=${encodeURIComponent(g)}&room=${encodeURIComponent(c)}${SCOPE}`; };

async function load() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  month = termMonth(month);
  d = await api(`/api/homeroom/logs?${roomQ()}&type=${logType}${month ? `&month=${month}` : ""}`);
  month = d.month;
  d.months = monthsOfTerm(d.months, me, T);
  draw();
}

// ---------- บันทึกอัตโนมัติ ----------
async function flush() {
  if (saving || !pending.size) return;
  saving = true;
  const byRoom = new Map();
  for (const [k, v] of pending) { const [r, sid, type, date] = k.split("|"); (byRoom.get(r) || byRoom.set(r, []).get(r)).push([k, { student_id: Number(sid), type, date, value: v }]); }
  pending.clear(); showState();
  let netErr = null;
  for (const [r, list] of byRoom) {
    try { await api(`/api/homeroom/logs?${roomQ(r)}`, { method: "PUT", body: { changes: list.map(([, c]) => c) } }); }
    catch (err) {
      if (err.status >= 400 && err.status < 500) { showError(`บันทึกไม่ได้ — ${err.message}`); setTimeout(() => load().catch(showError), 1200); }
      else { netErr = err; for (const [k, c] of list) if (!pending.has(k)) pending.set(k, c.value); }
    }
  }
  saving = false;
  if (netErr) { showState(netErr); showError(netErr); return; }
  showState();
  if (pending.size) flush();
}
const queue = () => { showState(); clearTimeout(timer); timer = setTimeout(flush, 700); };
async function settle() {
  await flush();
  for (let i = 0; i < 100 && (saving || pending.size); i++) { await new Promise((ok) => setTimeout(ok, 100)); if (!saving && pending.size) await flush(); }
  return !pending.size;
}
window.addEventListener("beforeunload", (e) => { if (pending.size || saving) { e.preventDefault(); e.returnValue = ""; } });
function showState(err) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.className = "save-state";
  if (err) { el.classList.add("error"); el.innerHTML = `บันทึกไม่สำเร็จ <button class="btn small" id="retry">ลองอีกครั้ง</button>`; document.getElementById("retry").onclick = flush; }
  else if (saving || pending.size) { el.classList.add("pending"); el.textContent = "กำลังบันทึก…"; }
  else el.textContent = "บันทึกแล้ว";
}

const val = (sid, type, k) => d.records[sid]?.[type]?.[k] || "";
function set(sid, type, k, v) {
  if (!d.can_edit) return;
  if (val(sid, type, k) === v) return;
  const r = ((d.records[sid] ||= {})[type] ||= {});
  if (v) r[k] = v; else delete r[k];
  pending.set(`${room}|${sid}|${type}|${k}`, v);
}

function draw() {
  const idx = d.months.indexOf(d.month);
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">${meta.rooms.length > 1 ? meta.rooms.map((r) => `<button class="btn small ${key(r) === room ? "primary" : ""}" data-room="${esc(key(r))}"${r.can_edit ? "" : ' data-tip="ดูอย่างเดียว"'}>${esc(key(r))}${r.can_edit ? "" : " 👁"}</button>`).join("") : `<b>ชั้น ${esc(room)}</b>`}</span>
      <span class="actions">
        <button class="btn small" id="xlsxBtn">ส่งออก Excel</button>
        <button class="btn small" id="pdfBtn">พิมพ์ / PDF</button>
      </span>
    </div>
    <div class="log-forms" role="tablist" aria-label="แบบบันทึก">${LOG_FORMS.map(([k, l]) => `<button role="tab" data-form="${k}" aria-selected="${k === logType}">${l}</button>`).join("")}</div>
    <div class="sheet-tools">
      <span class="actions">
        <button class="btn small" id="mPrev" ${idx <= 0 ? "disabled" : ""} aria-label="เดือนก่อน">‹</button>
        <select id="mSel" aria-label="เดือน">${(d.months.length ? d.months : [d.month]).map((m) => `<option value="${m}" ${m === d.month ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select>
        <button class="btn small" id="mNext" ${idx < 0 || idx >= d.months.length - 1 ? "disabled" : ""} aria-label="เดือนถัดไป">›</button>
        <strong class="log-title">${LOG_TITLE[logType]}</strong>
      </span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    ${d.holidays?.length ? `<p class="muted small" style="margin:0 0 8px">วันหยุดเดือนนี้ (ไม่แสดงในตาราง): ${d.holidays.map((h) => `${dayNum(h.holiday_date)} ${esc(h.name)}`).join(" · ")}</p>` : ""}
    ${d.can_edit ? "" : `<p class="note" style="margin:0 0 8px">ดูอย่างเดียว — บันทึกได้เฉพาะครูประจำชั้นของห้อง ${esc(room)}</p>`}
    <div id="logSheet"></div>`;
  const go = async (m) => { await settle(); month = m; sessionStorage.setItem("sr-hr-month", m); load().catch(showError); };
  document.getElementById("mSel").onchange = (e) => go(e.target.value);
  document.getElementById("mPrev").onclick = () => go(d.months[idx - 1]);
  document.getElementById("mNext").onclick = () => go(d.months[idx + 1]);
  for (const b of view.querySelectorAll("[data-form]")) b.onclick = async () => { await settle(); logType = b.dataset.form; sessionStorage.setItem("sr-hr-log", logType); load().catch(showError); };
  for (const b of view.querySelectorAll("[data-room]")) b.onclick = async () => {
    if (!(await settle())) { showError("ยังบันทึกห้องเดิมไม่สำเร็จ — กดลองใหม่ก่อนเปลี่ยนห้อง"); return; }
    room = b.dataset.room; sessionStorage.setItem("sr-log-room", room); load().catch(showError);
  };
  document.getElementById("xlsxBtn").onclick = () => exportXlsx().catch(showError);
  document.getElementById("pdfBtn").onclick = () => printPdf().catch(showError);
  if (logType === "health") drawHealth(); else drawDaily();
  if (!d.can_edit) {
    for (const b of view.querySelectorAll("#logSheet .tick, #logSheet .col-all")) b.disabled = true;
    document.getElementById("saveState").hidden = true;
  }
  showState();
}

// ---------- ตารางติ๊กรายวัน ----------
function drawDaily() {
  const box = document.getElementById("logSheet");
  if (!d.days.length) { box.innerHTML = `<div class="panel empty"><strong>เดือนนี้ไม่มีวันเรียน</strong>อยู่นอกช่วงภาคเรียน หรือเป็นวันหยุดทั้งเดือน</div>`; return; }
  const T = logType;
  const m = () => dailyModel(d);
  const model = m();
  const cell = (r, i) => {
    const day = d.days[i], c = r.cells[i];
    if (c === null) return `<td class="lcell na"></td>`;
    if (c && c !== "✓") return `<td class="lcell absent" data-tip="${ABS_LABEL[c]} (จากบันทึกการมาเรียน)">${c}</td>`;
    return `<td class="lcell"><button type="button" class="tick${c ? " on" : ""}" data-sid="${r.id}" data-d="${day}" aria-pressed="${!!c}" aria-label="${esc(r.name)} ${dayShort(day)}">${c}</button></td>`;
  };
  box.innerHTML = `<div class="sheet-wrap"><table class="sheet att-sheet log-sheet" id="sheet">
    <thead><tr><th class="stick no col-head">เลขที่</th><th class="stick name col-head" style="text-align:left">ชื่อ–สกุล</th>
      ${d.days.map((day) => `<th class="col-head att-day ${day === d.today ? "today" : ""}"><span class="wd">${weekdayOf(day)}</span><b>${dayNum(day)}</b>
        <button type="button" class="col-all" data-all="${day}" data-tip="ติ๊กทุกคนที่มาเรียนวันนี้ (กดอีกครั้ง = ล้าง)" aria-label="ติ๊กทั้งห้อง ${dayShort(day)}">ทั้งห้อง</button></th>`).join("")}
      <th class="col-head att-sum" data-tip="จำนวนวันที่ติ๊ก / วันที่มาเรียน">รวม</th></tr></thead>
    <tbody>${model.rows.map((r) => `<tr data-sid="${r.id}" class="${r.active ? "" : "inactive"}"><td class="stick no">${r.number}</td><td class="stick name" title="${esc(r.name)}">${esc(r.name)}</td>
      ${d.days.map((_, i) => cell(r, i)).join("")}<td class="calc att-sum" data-row>${r.active ? `${r.done}/${r.present}` : ""}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td class="stick no"></td><td class="stick name" style="text-align:left">รวมรายวัน</td>${model.foot.map((f, i) => `<td class="calc log-foot" data-col="${d.days[i]}">${f.done}/${f.present}</td>`).join("")}<td></td></tr></tfoot>
  </table></div>
  <p class="muted small" style="margin-top:10px">แตะช่องเพื่อติ๊ก ✓ (แตะซ้ำ = ล้าง) · ปุ่ม "ทั้งห้อง" ใต้วันที่ = ติ๊กทุกคนที่มาเรียนวันนั้น · ช่องสีเทาคือนักเรียนที่ขาด/ลาในบันทึกการมาเรียน · บันทึกอัตโนมัติ</p>`;
  const table = document.getElementById("sheet");
  const refresh = () => {
    const mm = m();
    for (const r of mm.rows) {
      const tr = table.querySelector(`tr[data-sid="${r.id}"]`);
      r.cells.forEach((c, i) => { const b = tr.querySelector(`[data-d="${d.days[i]}"]`); if (b) { b.classList.toggle("on", c === "✓"); b.textContent = c; b.setAttribute("aria-pressed", String(c === "✓")); } });
      tr.querySelector("[data-row]").textContent = r.active ? `${r.done}/${r.present}` : "";
    }
    mm.foot.forEach((f, i) => { table.querySelector(`[data-col="${d.days[i]}"]`).textContent = `${f.done}/${f.present}`; });
  };
  table.addEventListener("click", (e) => {
    const t = e.target.closest(".tick");
    if (t) { const sid = Number(t.dataset.sid), day = t.dataset.d; set(sid, T, day, val(sid, T, day) === "1" ? "" : "1"); refresh(); queue(); return; }
    const all = e.target.closest("[data-all]");
    if (all) {
      const day = all.dataset.all, i = d.days.indexOf(day);
      const list = m().rows.filter((r) => r.active && (r.cells[i] === "✓" || r.cells[i] === ""));
      const v = list.every((r) => r.cells[i] === "✓") ? "" : "1";
      for (const r of list) set(r.id, T, day, v);
      refresh(); queue();
    }
  });
  table.addEventListener("keydown", (e) => {
    const t = e.target.closest(".tick"); if (!t) return;
    const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (!dirs[e.key]) return;
    e.preventDefault();
    const [dr, dc] = dirs[e.key], rows = [...table.querySelectorAll("tbody tr")];
    let ri = rows.indexOf(t.closest("tr")), ci = d.days.indexOf(t.dataset.d);
    for (let i = 0; i < 60; i++) {
      ri += dr; ci += dc;
      if (!rows[ri] || ci < 0 || ci >= d.days.length) break;
      const target = rows[ri].querySelector(`[data-d="${d.days[ci]}"]`);
      if (target) { target.focus(); break; }
    }
  });
  table.querySelector("th.today")?.scrollIntoView({ block: "nearest", inline: "center" });
}

// ---------- ตรวจสุขภาพ: แตะวน ว่าง → ✓ สะอาด → ✗ ไม่สะอาด → ว่าง ----------
function drawHealth() {
  const box = document.getElementById("logSheet");
  const model = healthModel(d), ITEMS = model.items;
  const wk = (w) => `${d.month}-w${w}`;
  const NEXT = { "": "ok", ok: "no", no: "" };
  box.innerHTML = `<div class="sheet-wrap"><table class="sheet log-sheet health" id="sheet">
    <thead><tr><th class="stick no col-head" rowspan="2">เลขที่</th><th class="stick name col-head" rowspan="2" style="text-align:left">ชื่อ–สกุล</th>
      ${d.weeks.map((w) => `<th class="col-head wk-head${w.week > 1 ? " wk-start" : ""}" colspan="${ITEMS.length}">สัปดาห์ที่ ${w.week}<small>${weekRange(w) || "—"}</small>
        <button type="button" class="col-all" data-wall="${w.week}" data-tip="ใส่ ✓ สะอาด ทุกช่องที่ยังว่างของสัปดาห์นี้ (ไม่ทับ ✗)">✓ ทั้งห้อง</button></th>`).join("")}
      <th class="col-head att-sum" rowspan="2" data-tip="จำนวนรายการที่ไม่สะอาดในเดือนนี้">✗</th></tr>
      <tr>${d.weeks.map((w) => ITEMS.map(([k, l], ki) => `<th class="col-head h-item${w.week > 1 && ki === 0 ? " wk-start" : ""}">${l}</th>`).join("")).join("")}</tr></thead>
    <tbody>${model.rows.map((r) => `<tr data-sid="${r.id}" class="${r.active ? "" : "inactive"}"><td class="stick no">${r.number}</td><td class="stick name" title="${esc(r.name)}">${esc(r.name)}</td>
      ${d.weeks.map((w, wi) => ITEMS.map(([k], ki) => {
        const c = r.cells[wi][ki];
        if (c === null) return `<td class="lcell na"></td>`;
        const cls = c === "✓" ? "ok" : c === "✗" ? "no" : "";
        return `<td class="lcell${w.week > 1 && ki === 0 ? " wk-start" : ""}"><button type="button" class="tick h ${cls}" data-sid="${r.id}" data-k="${k}" data-w="${w.week}" aria-label="${esc(r.name)} สัปดาห์ ${w.week} ${d.health_items[k]}">${c}</button></td>`;
      }).join("")).join("")}<td class="calc att-sum bad" data-row>${r.bad || ""}</td></tr>`).join("")}</tbody>
  </table></div>
  <p class="muted small" style="margin-top:10px">ตรวจสัปดาห์ละครั้ง เดือนละ 4 สัปดาห์ · แตะช่องวน: ✓ สะอาด → ✗ ไม่สะอาด → ว่าง · ปุ่ม "✓ ทั้งห้อง" ใส่สะอาดให้ทุกช่องที่ยังว่างของสัปดาห์นั้น แล้วค่อยแก้เฉพาะคนที่ไม่สะอาด · บันทึกอัตโนมัติ</p>`;
  const table = document.getElementById("sheet");
  const draw1 = (sid, k, w) => {
    const b = table.querySelector(`tr[data-sid="${sid}"] [data-k="${k}"][data-w="${w}"]`), v = val(sid, k, wk(w));
    if (b) { b.className = `tick h ${v}`; b.textContent = v === "ok" ? "✓" : v === "no" ? "✗" : ""; }
    const bad = Object.keys(d.health_items).reduce((n, kk) => n + d.weeks.filter((ww) => val(sid, kk, wk(ww.week)) === "no").length, 0);
    table.querySelector(`tr[data-sid="${sid}"] [data-row]`).textContent = bad || "";
  };
  table.addEventListener("click", (e) => {
    const t = e.target.closest(".tick");
    if (t) { const sid = Number(t.dataset.sid), k = t.dataset.k, w = Number(t.dataset.w); set(sid, k, wk(w), NEXT[val(sid, k, wk(w))]); draw1(sid, k, w); queue(); return; }
    const all = e.target.closest("[data-wall]");
    if (all) {
      const w = Number(all.dataset.wall), list = d.students.filter((s) => s.enrollment_status === "enrolled");
      const blanks = list.flatMap((s) => ITEMS.filter(([k]) => !val(s.id, k, wk(w))).map(([k]) => [s, k]));
      if (blanks.length) for (const [s, k] of blanks) { set(s.id, k, wk(w), "ok"); draw1(s.id, k, w); }
      else for (const s of list) for (const [k] of ITEMS) if (val(s.id, k, wk(w)) === "ok") { set(s.id, k, wk(w), ""); draw1(s.id, k, w); }
      queue();
    }
  });
}

// ---------- ส่งออก Excel / พิมพ์ PDF ----------
async function pickScope(title) {
  const r = await dialog({
    title,
    body: `<div style="display:grid;gap:10px">
      <label class="check"><input type="radio" name="scope" value="month" checked> เดือนนี้ (${monthLabel(d.month)})</label>
      <label class="check"><input type="radio" name="scope" value="year"> ทั้ง${TERM_LABEL[T]} (${d.months.length} เดือน)</label>
      <label class="check"><input type="checkbox" name="all"> ทั้ง 5 แบบบันทึก (ไม่ใช่เฉพาะ${LOG_TITLE[logType].replace("แบบบันทึก", "")})</label></div>`,
    okText: "ตกลง",
  });
  if (!r.ok) return null;
  return { months: r.data.scope === "year" ? d.months : [d.month], types: r.data.all ? LOG_FORMS.map(([k]) => k) : [logType] };
}

async function exportXlsx() {
  const s = await pickScope("ส่งออก Excel (.xlsx)");
  if (!s) return;
  if (!(await settle())) return showError("ยังบันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
  toast("กำลังสร้างไฟล์ Excel…");
  const [XLSX, datas] = await Promise.all([loadXlsx(), fetchAll(s)]);
  const wb = XLSX.utils.book_new();
  const SHORT = Object.fromEntries(LOG_FORMS);
  for (const x of datas) {
    const { aoa, merges, cols } = sheetForMonth(x);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges; ws["!cols"] = cols;
    const [yy, mm] = x.month.split("-").map(Number);
    const name = `${s.types.length > 1 ? SHORT[x.type] + " " : ""}${monthLabel(x.month).split(" ")[0].slice(0, 12)} ${String(yy + 543).slice(-2)}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, name || `${mm}`);
  }
  const what = s.types.length > 1 ? "บันทึกประจำวัน" : LOG_TITLE[s.types[0]];
  XLSX.writeFile(wb, `${what} ${room.replace("/", "-")} ${s.months.length > 1 ? `ภาค ${T} ปี ${d.year.year_be}` : monthLabel(d.month)}.xlsx`);
}
async function fetchAll(s) {
  const jobs = [];
  for (const t of s.types) for (const m of s.months) jobs.push(api(`/api/homeroom/logs?${roomQ()}&type=${t}&month=${m}`));
  return Promise.all(jobs);
}
async function printPdf() {
  const s = await pickScope("พิมพ์ / บันทึกเป็น PDF");
  if (!s) return;
  if (!(await settle())) return showError("ยังบันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
  const [g, c] = room.split("/");
  const q = new URLSearchParams({ year: Y, grade: g, room: c, types: s.types.join(","), months: s.months.join(",") });
  window.open(`/print/logs.html?${q}`, "_blank", "noopener");
}

load().catch((err) => { view.innerHTML = `<div class="panel empty"><strong>โหลดไม่สำเร็จ</strong>${esc(err.message)}</div>`; });
