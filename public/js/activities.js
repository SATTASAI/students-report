// กิจกรรมพัฒนาผู้เรียน (ปพ.5.1): ครูประจำชั้นและฝ่ายวิชาการบันทึก 4 กิจกรรมในหน้าเดียว — ผลขึ้น ปพ.6 อัตโนมัติ
import { shell, api, esc, showError, params } from "/js/app.js";

const me = await shell("activities");
const view = document.getElementById("view");
document.getElementById("main").hidden = false;
const Y = me.year.id;
document.getElementById("yearLine").textContent = `ปีการศึกษา ${me.year.year_be} · ทุกคนผ่านเป็นค่าเริ่มต้น เอาเครื่องหมายออกเฉพาะคนที่ไม่ผ่าน · ผลขึ้นใน ปพ.5.1 และ ปพ.6 อัตโนมัติ`;

let meta;
try { meta = await api(`/api/activities?year=${Y}`); }
catch (err) { view.innerHTML = `<div class="panel empty"><strong>เปิดไม่ได้</strong>${esc(err.message)}</div>`; throw err; }
if (!meta.rooms.length) {
  view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีห้องที่บันทึกได้</strong>หน้านี้สำหรับครูประจำชั้นและฝ่ายวิชาการ</div>`;
  throw new Error("no rooms");
}
const key = (r) => `${r.grade_level}/${r.classroom}`;
let room = params().get("room") || sessionStorage.getItem("sr-act-room");
if (!meta.rooms.some((r) => key(r) === room)) room = key(meta.rooms[0]);
const pending = new Map(); // "sid|item_key" → "" | "มผ"
let saving = false, timer, d;

async function load() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  const [g, r] = room.split("/");
  d = await api(`/api/activities?year=${Y}&grade=${encodeURIComponent(g)}&room=${encodeURIComponent(r)}`);
  draw();
}

const result = (s) => d.activities.some((a) => d.parts.some((p) => s.values[`${a.key}_${p.key}`] === "มผ")) ? "มผ" : "ผ";
const actResult = (s, a) => d.parts.some((p) => s.values[`${a.key}_${p.key}`] === "มผ") ? "มผ" : "ผ";

function draw() {
  const active = d.students.filter((s) => s.enrollment_status === "enrolled");
  const fails = active.filter((s) => result(s) === "มผ").length;
  view.innerHTML = `
    <div class="sheet-tools">
      <span class="actions">${meta.rooms.length > 1 ? meta.rooms.map((r) => `<button class="btn small ${key(r) === room ? "primary" : ""}" data-room="${esc(key(r))}">${esc(key(r))}</button>`).join("") : `<b>${esc(room)}</b>`}
        <span class="muted small" id="actCount">${active.length} คน · ไม่ผ่าน ${fails} คน</span></span>
      <span class="save-state" id="saveState">บันทึกแล้ว</span>
    </div>
    <div class="sheet-wrap"><table class="sheet" id="sheet">
      <thead>
        <tr><th class="stick no col-head" rowspan="2">เลขที่</th><th class="stick name col-head" rowspan="2" style="text-align:left">ชื่อ–สกุล</th>
          ${d.activities.map((a) => `<th class="col-head" colspan="${d.parts.length + 1}"><span class="t">${esc(a.label)}</span></th>`).join("")}<th class="col-head" rowspan="2">สรุป</th></tr>
        <tr>${d.activities.map(() => d.parts.map((p) => `<th class="col-head small">${esc(p.label)}</th>`).join("") + '<th class="col-head small">ผล</th>').join("")}</tr>
      </thead>
      <tbody>${d.students.map((s) => `<tr data-sid="${s.id}" class="${s.enrollment_status !== "enrolled" ? "inactive" : ""}">
        <td class="stick no">${s.number ?? ""}</td><td class="stick name">${esc(s.name)}</td>
        ${d.activities.map((a) => d.parts.map((p) => { const k = `${a.key}_${p.key}`; const ok = s.values[k] !== "มผ";
          return `<td class="chk-cell ${ok ? "" : "fail"}"><input type="checkbox" data-key="${k}" ${ok ? "checked" : ""} aria-label="${esc(s.name)} ${esc(a.label)} ${esc(p.label)}"></td>`; }).join("")
          + `<td class="calc small" data-act="${a.key}">${actResult(s, a) === "ผ" ? "ผ" : '<b style="color:var(--bad)">มผ</b>'}</td>`).join("")}
        <td class="calc" data-sum>${result(s) === "ผ" ? "ผ่าน" : '<b style="color:var(--bad)">ไม่ผ่าน</b>'}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small" style="margin-top:10px">ช่องมีเครื่องหมาย = ผ่าน · แต่ละกิจกรรมผ่านเมื่อผ่านทั้งเวลาเรียนและจุดประสงค์ · ไม่ต้องยืนยันนักเรียนใหม่ทุกภาค · บันทึกอัตโนมัติ</p>`;
  for (const b of view.querySelectorAll("[data-room]")) b.onclick = async () => {
    await flush(); room = b.dataset.room; sessionStorage.setItem("sr-act-room", room); load().catch(showError);
  };
  document.getElementById("sheet").addEventListener("change", (e) => {
    const box = e.target;
    if (!box.dataset.key) return;
    const tr = box.closest("tr"), sid = Number(tr.dataset.sid), s = d.students.find((x) => x.id === sid);
    const value = box.checked ? "" : "มผ";
    if (value) s.values[box.dataset.key] = value; else delete s.values[box.dataset.key];
    box.parentElement.classList.toggle("fail", !box.checked);
    const a = d.activities.find((x) => box.dataset.key.startsWith(`${x.key}_`));
    tr.querySelector(`[data-act="${a.key}"]`).innerHTML = actResult(s, a) === "ผ" ? "ผ" : '<b style="color:var(--bad)">มผ</b>';
    tr.querySelector("[data-sum]").innerHTML = result(s) === "ผ" ? "ผ่าน" : '<b style="color:var(--bad)">ไม่ผ่าน</b>';
    const act = d.students.filter((x) => x.enrollment_status === "enrolled");
    document.getElementById("actCount").textContent = `${act.length} คน · ไม่ผ่าน ${act.filter((x) => result(x) === "มผ").length} คน`;
    pending.set(`${sid}|${box.dataset.key}`, value);
    state(); clearTimeout(timer); timer = setTimeout(flush, 600);
  });
}

async function flush() {
  if (saving || !pending.size) return;
  saving = true;
  const batch = [...pending.entries()];
  pending.clear(); state();
  const [g, r] = room.split("/");
  try {
    await api(`/api/activities?year=${Y}`, { method: "PUT", body: { grade: g, room: r, changes: batch.map(([k, value]) => { const [sid, item_key] = k.split("|"); return { student_id: Number(sid), item_key, value }; }) } });
    saving = false; state();
  } catch (err) {
    for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v);
    saving = false; state(err); showError(err); return;
  }
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
