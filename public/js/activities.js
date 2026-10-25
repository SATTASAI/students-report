// กิจกรรมพัฒนาผู้เรียน (ปพ.5.1): ครูประจำชั้นและฝ่ายวิชาการบันทึก 4 กิจกรรมในหน้าเดียว — ผลขึ้น ปพ.6 อัตโนมัติ
// บันทึกรายภาค: ภาค 1 บันทึกผลภาค 1 · ภาค 2 บันทึกผลภาค 2 แล้วสรุปทั้งปี (ผ่านเมื่อผ่านทั้ง 2 ภาค)
import { shell, api, esc, showError, params, editGate } from "/js/app.js";
import { activityKey } from "/js/grading.js";

const me = await shell("activities");
const view = document.getElementById("view");
document.getElementById("main").hidden = false;
const T = me.term === 1 ? 1 : 2;
const Y = me.year.id;
const SCOPE = me.role === "teacher" ? "&scope=teacher" : ""; // บทบาทครู: เห็นเฉพาะห้องที่เป็นครูประจำชั้น
document.getElementById("yearLine").textContent = `ปีการศึกษา ${me.year.year_be} · ภาคเรียนที่ ${T} · ทุกคนผ่านเป็นค่าเริ่มต้น เอาเครื่องหมายออกเฉพาะคนที่ไม่ผ่าน · `
  + (T === 1 ? "ผลภาค 1 ขึ้นใน ปพ.6 ภาคเรียนที่ 1 · สรุปผลทั้งปีที่ภาคเรียนที่ 2" : "ผลทั้งปีต้องผ่านทั้งภาคเรียนที่ 1 และ 2 · ขึ้นใน ปพ.6 อัตโนมัติ");

let meta;
try { meta = await api(`/api/activities?year=${Y}${SCOPE}`); }
catch (err) { view.innerHTML = `<div class="panel empty"><strong>เปิดไม่ได้</strong>${esc(err.message)}</div>`; throw err; }
if (!meta.rooms.length) {
  view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีห้องที่บันทึกได้</strong>หน้านี้สำหรับครูประจำชั้นและฝ่ายวิชาการ</div>`;
  throw new Error("no rooms");
}
const key = (r) => `${r.grade_level}/${r.classroom}`;
let room = params().get("room") || sessionStorage.getItem("sr-act-room");
if (!meta.rooms.some((r) => key(r) === room)) room = key(meta.rooms[0]);
const pending = new Map(); // "ห้อง|sid|item_key" → "" | "มผ" (เก็บห้องไว้ในคีย์ — เปลี่ยนห้องระหว่างบันทึกแล้วไม่ส่งผิดห้อง)
let saving = false, timer, d, gate;

async function load() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  const [g, r] = room.split("/");
  d = await api(`/api/activities?year=${Y}${SCOPE}&grade=${encodeURIComponent(g)}&room=${encodeURIComponent(r)}`);
  const reqPath = `/api/homeroom/edit-request?year=${Y}&grade=${encodeURIComponent(g)}&room=${encodeURIComponent(r)}`;
  if (gate) gate.update(d.edit, reqPath); else gate = editGate(view, d.edit, reqPath);
  draw();
}

// t = ภาค (1/2) หรือ null = ทั้งปี (ต้องผ่านทั้ง 2 ภาค)
const actResult = (s, a, t) => (t ? [t] : [1, 2]).some((n) => d.parts.some((p) => s.values[activityKey(a.key, p.key, n)] === "มผ")) ? "มผ" : "ผ";
const result = (s, t) => d.activities.some((a) => actResult(s, a, t) === "มผ") ? "มผ" : "ผ";
const RF = T === 2 ? null : 1; // ผลที่นับ "ไม่ผ่าน" ในแถบด้านบน: ภาค 1 = ผลภาค 1 · ภาค 2 = ผลทั้งปี
const short = (v) => v === "ผ" ? "ผ" : '<b style="color:var(--bad)">มผ</b>';
const long = (v) => v === "ผ" ? "ผ่าน" : '<b style="color:var(--bad)">ไม่ผ่าน</b>';
const countText = (act) => `${act.length} คน · ไม่ผ่าน${T === 2 ? "ทั้งปี" : "ภาค 1"} ${act.filter((x) => result(x, RF) === "มผ").length} คน`;

function draw() {
  const active = d.students.filter((s) => s.enrollment_status === "enrolled");
  const per = d.parts.length + (T === 2 ? 2 : 1); // ภาค 2: ผลภาค 1 + เงื่อนไขภาค 2 + ทั้งปี
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">${meta.rooms.length > 1 ? meta.rooms.map((r) => `<button class="btn small ${key(r) === room ? "primary" : ""}" data-room="${esc(key(r))}">${esc(key(r))}</button>`).join("") : `<b>${esc(room)}</b>`}
        <span class="muted small" id="actCount">${countText(active)}</span></span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead>
        <tr><th class="stick no col-head" rowspan="2">เลขที่</th><th class="stick name col-head" rowspan="2" style="text-align:left">ชื่อ–สกุล</th>
          ${d.activities.map((a) => `<th class="col-head" colspan="${per}"><span class="t">${esc(a.label)}</span></th>`).join("")}
          ${T === 2 ? '<th class="col-head" rowspan="2">สรุป<br>ภาค 1</th><th class="col-head" rowspan="2">สรุป<br>ภาค 2</th><th class="col-head" rowspan="2">สรุป<br>ทั้งปี</th>' : '<th class="col-head" rowspan="2">สรุป<br>ภาค 1</th>'}</tr>
        <tr>${d.activities.map(() => (T === 2 ? '<th class="col-head small">ภาค 1</th>' : "") + d.parts.map((p) => `<th class="col-head small">${esc(p.label)}${T === 2 ? "<br>ภาค 2" : ""}</th>`).join("")
          + `<th class="col-head small">${T === 2 ? "ทั้งปี" : "ผล"}</th>`).join("")}</tr>
      </thead>
      <tbody>${d.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${d.activities.map((a) => (T === 2 ? `<td class="calc small" title="ผลภาคเรียนที่ 1">${short(actResult(s, a, 1))}</td>` : "")
          + d.parts.map((p) => { const k = activityKey(a.key, p.key, T); const ok = s.values[k] !== "มผ";
          return `<td class="chk-cell ${ok ? "" : "fail"}"><input type="checkbox" data-key="${k}" ${ok ? "checked" : ""} aria-label="${esc(s.name)} ${esc(a.label)} ${esc(p.label)} ภาค ${T}"></td>`; }).join("")
          + `<td class="calc small" data-act="${a.key}">${short(actResult(s, a, RF))}</td>`).join("")}
        ${T === 2 ? `<td class="calc">${long(result(s, 1))}</td><td class="calc" data-sum2>${long(result(s, 2))}</td>` : ""}<td class="calc" data-sum>${long(result(s, RF))}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small" style="margin-top:10px">ช่องมีเครื่องหมาย = ผ่าน · แต่ละกิจกรรมผ่านเมื่อผ่านทั้งเวลาเรียนและจุดประสงค์ ·
      ${T === 2 ? "ผลทั้งปีผ่านเมื่อผ่านทั้งภาคเรียนที่ 1 และภาคเรียนที่ 2 (แก้ผลภาค 1 ได้ที่ภาคเรียนที่ 1)" : "ผลทั้งปีสรุปที่ภาคเรียนที่ 2 (ต้องผ่านทั้ง 2 ภาค)"} · บันทึกอัตโนมัติ</p>`;
  for (const b of view.querySelectorAll("[data-room]")) b.onclick = async () => {
    await flush();
    for (let i = 0; i < 100 && (saving || pending.size); i++) { await new Promise((ok) => setTimeout(ok, 100)); if (!saving && pending.size) await flush(); }
    if (pending.size) { showError("ยังบันทึกห้องเดิมไม่สำเร็จ — กดลองใหม่ก่อนเปลี่ยนห้อง"); return; }
    room = b.dataset.room; sessionStorage.setItem("sr-act-room", room); load().catch(showError);
  };
  document.getElementById("sheet").addEventListener("change", (e) => {
    const box = e.target;
    if (!box.dataset.key) return;
    const tr = box.closest("tr"), sid = Number(tr.dataset.sid), s = d.students.find((x) => x.id === sid);
    const value = box.checked ? "" : "มผ";
    if (value) s.values[box.dataset.key] = value; else delete s.values[box.dataset.key];
    box.parentElement.classList.toggle("fail", !box.checked);
    const a = d.activities.find((x) => box.dataset.key.startsWith(`${x.key}_`));
    tr.querySelector(`[data-act="${a.key}"]`).innerHTML = short(actResult(s, a, RF));
    tr.querySelector("[data-sum]").innerHTML = long(result(s, RF));
    if (T === 2) tr.querySelector("[data-sum2]").innerHTML = long(result(s, 2));
    document.getElementById("actCount").textContent = countText(d.students.filter((x) => x.enrollment_status === "enrolled"));
    pending.set(`${room}|${sid}|${box.dataset.key}`, value);
    state(); clearTimeout(timer); timer = setTimeout(flush, 600);
  });
}

async function flush() {
  if (saving || !pending.size) return;
  saving = true;
  const batch = [...pending.entries()];
  pending.clear(); state();
  const byRoom = {};
  for (const [k, v] of batch) { const [rm, sid, item_key] = k.split("|"); (byRoom[rm] ||= []).push({ k, v, change: { student_id: Number(sid), item_key, value: v } }); }
  let failed = null;
  for (const [rm, list] of Object.entries(byRoom)) {
    const [g, r] = rm.split("/");
    try { await api(`/api/activities?year=${Y}${SCOPE}`, { method: "PUT", body: { grade: g, room: r, term: T, changes: list.map((x) => x.change) } }); }
    catch (err) {
      failed = err;
      if (err.status >= 500 || !err.status) for (const x of list) if (!pending.has(x.k)) pending.set(x.k, x.v); // เครือข่าย: เก็บไว้ลองใหม่
      else showError(`${rm}: ${err.message} — รายการนี้ไม่ถูกบันทึก`);
    }
  }
  saving = false;
  if (failed && pending.size) { state(failed); showError(failed); return; }
  state();
  if (pending.size) flush();
}
function state(err) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.className = "save-state";
  if (err) { el.classList.add("error"); el.textContent = "บันทึกไม่สำเร็จ"; }
  else if (saving || pending.size) { el.classList.add("pending"); el.textContent = "กำลังบันทึก…"; }
  else el.textContent = "บันทึกแล้ว";
}
window.addEventListener("beforeunload", (e) => { if (pending.size || saving) { e.preventDefault(); e.returnValue = ""; } });
load().catch((err) => { view.innerHTML = `<div class="panel empty"><strong>โหลดไม่สำเร็จ</strong>${esc(err.message)}</div>`; });
