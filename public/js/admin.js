import { shell, api, esc, toast, showError, dialog, confirmBox, hashTab } from "/js/app.js";
import { parseIndicatorLines } from "/js/indicators.js";
import { IMPORT_KINDS, parseGrid, gridToRows } from "/js/paste.js";
import { loadXlsx } from "/js/export.js";

const me = await shell("admin");
const view = document.getElementById("view");
const main = document.getElementById("main");
if (!me.user.is_admin) {
  main.hidden = false;
  view.innerHTML = `<div class="panel empty"><strong>หน้านี้สำหรับฝ่ายวิชาการ/วัดผล</strong>ติดต่อผู้บริหารเพื่อขอสิทธิ์</div>`;
  throw new Error("not admin");
}
const Y = me.year.id;
const CAN_IMPORT = !!me.user.can_import; // นำเข้าข้อมูล: เฉพาะผู้ดูแลระบบและทีมวัดและประเมินผล
if (!CAN_IMPORT) for (const t of ["import", "bank"]) document.querySelector(`#tabs [data-tab="${t}"]`)?.remove();
const yq = `year=${Y}`;
main.hidden = false;
document.getElementById("yearLine").textContent = `ปีการศึกษา ${me.year.year_be} — ใช้ข้อมูลห้องเรียนและนักเรียนจากระบบบริหารโรงเรียน`;
const GRADES = ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];
// ส่วนของหน้า เลือกจากเมนูซ้ายผ่าน #hash
const SECTIONS = {
  start: "เริ่มต้นปีการศึกษา", subjects: "รายวิชา", import: "นำเข้าจาก Excel", courses: "ครูผู้สอน / ส่งคืน", homerooms: "ครูประจำชั้น",
  moves: "นักเรียนย้ายเข้า/ย้ายออก", bank: "คลังตัวชี้วัด", settings: "เกณฑ์และผู้ลงนาม", people: "สิทธิ์ทีมวัดผล", approve: "อนุมัติผลการเรียน", audit: "ประวัติการใช้งาน",
};
const allowed = Object.keys(SECTIONS).filter((k) => !(["import", "bank", "moves"].includes(k) && !CAN_IMPORT) && !(["approve", "people", "audit"].includes(k) && !me.user.is_super));
let tab = hashTab(allowed, me.role === "exec" && allowed.includes("approve") ? "approve" : "start");
document.getElementById("tabs")?.classList.add("by-menu");
if (location.hash === "#activity") location.replace("/activities.html"); // ลิงก์เก่า
window.addEventListener("hashchange", () => { tab = hashTab(allowed, "start"); renderTabs(); render(); });
let teachersCache;
const teachers = async () => (teachersCache ||= (await api("/api/admin/teachers")).teachers);

function renderTabs() {
  document.getElementById("pageTitle").textContent = SECTIONS[tab];
  document.title = `${SECTIONS[tab]} — รายงานผลการเรียน`;
}

async function render() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  try {
    await ({ start: renderStart, subjects: renderSubjects, import: renderImport, courses: renderCourses, homerooms: renderHomerooms, moves: renderMoves, bank: renderBank, settings: renderSettings, people: renderPeople, approve: renderApprove, audit: renderAudit })[tab]();
  } catch (err) { view.innerHTML = `<div class="panel empty"><strong>โหลดข้อมูลไม่สำเร็จ</strong>${esc(err.message)}</div>`; }
}

// ---------- เริ่มต้นปี: ขั้นตอนตามลำดับ ----------
async function renderStart() {
  const [{ rooms }, { subjects }, { courses }, hr, { settings }] = await Promise.all([
    api(`/api/admin/rooms?${yq}`), api(`/api/admin/subjects?${yq}`), api(`/api/admin/courses?${yq}`), api(`/api/admin/homerooms?${yq}`),
    api(`/api/admin/settings?${yq}`),
  ]);
  const primaryRooms = rooms.filter((r) => GRADES.includes(r.grade_level));
  const pilot = settings.pilot_rooms;
  const inScope = (g, r) => !pilot || pilot.includes(`${g}/${r}`);
  const scopedCourses = courses.filter((c) => inScope(c.grade_level, c.classroom));
  const noTeacher = scopedCourses.filter((c) => !c.teachers.length).length;
  const scopedHr = hr.rooms.filter((r) => inScope(r.grade_level, r.classroom));
  const noHomeroom = scopedHr.filter((r) => !r.teachers.length).length;
  const pilotGrades = pilot ? [...new Set(pilot.map((p) => p.split("/")[0]))] : GRADES;
  const steps = [
    { done: primaryRooms.length > 0, title: "ห้องเรียนและรายชื่อนักเรียน", text: primaryRooms.length ? `พบ ${primaryRooms.length} ห้อง (ป.1–ป.6) นักเรียน ${primaryRooms.reduce((a, r) => a + r.students, 0)} คน จากระบบบริหารโรงเรียน` : "ยังไม่มีนักเรียนลงทะเบียนในปีนี้ ให้จัดชั้นเรียนในระบบบริหารโรงเรียนก่อน", action: "" },
    { done: true, title: "ห้องที่เปิดใช้ระบบ", text: pilot ? `นำร่องเฉพาะ <b>${pilot.map(esc).join(", ")}</b> — ห้องอื่นยังใช้ Q-Info` : "เปิดใช้ทุกห้อง", action: `<button class="btn" id="pilotBtn">เลือกห้อง</button>` },
    { done: subjects.some((s) => pilotGrades.includes(s.grade_level)), title: "รายวิชาของแต่ละชั้น", text: subjects.length ? `มี ${subjects.length} รายวิชา (${[...new Set(subjects.map((s) => s.grade_level))].join(", ")})` : (CAN_IMPORT ? "นำเข้าจาก Excel, คัดลอกจากปีก่อน หรือ" : "ทีมวัดผลนำเข้าจาก Excel ได้ หรือ") + "สร้างวิชาพื้นฐานตามหลักสูตรแกนกลางฯ 2551 (เหมาะกับ ป.4–6) แล้วแก้ภายหลังได้",
      action: `<span class="actions">${CAN_IMPORT ? `<button class="btn ${subjects.length ? "" : "primary"}" data-go="import">นำเข้าจาก Excel</button>${me.years.length > 1 ? '<button class="btn" id="copyBtn">คัดลอกจากปีก่อน</button>' : ""}` : ""}<button class="btn" id="tplBtn">วิชาพื้นฐาน</button></span>` },
    { done: scopedCourses.length > 0, title: "รายวิชาของแต่ละห้อง", text: scopedCourses.length ? `มี ${scopedCourses.length} รายวิชา-ห้อง${pilot ? " ในห้องที่เปิดใช้" : ""}` : `จับคู่รายวิชากับ${pilot ? "ห้องที่เปิดใช้" : "ทุกห้องเรียนของชั้นนั้น"}`, action: `<button class="btn ${subjects.length && !scopedCourses.length ? "primary" : ""}" id="genBtn" ${subjects.length ? "" : "disabled"}>สร้าง/เติมรายวิชา${pilot ? "ห้องที่เปิดใช้" : "ทุกห้อง"}</button>` },
    { done: scopedCourses.length > 0 && noTeacher === 0, title: "มอบหมายครูผู้สอน", text: scopedCourses.length ? (noTeacher ? `ยังไม่มีครูผู้สอน ${noTeacher} รายวิชา` : "ครบทุกรายวิชา") : (CAN_IMPORT ? "ทำหลังขั้นตอนที่ 4 หรือนำเข้าจาก Excel ได้เลย" : "ทำหลังขั้นตอนที่ 4"), action: `<span class="actions">${CAN_IMPORT ? '<button class="btn" data-go="import" data-kind="teachers">นำเข้าจาก Excel</button>' : ""}<button class="btn" data-go="courses">ไปมอบหมาย</button></span>` },
    { done: scopedHr.length > 0 && noHomeroom === 0, title: "ครูประจำชั้น", text: noHomeroom ? `ยังไม่กำหนด ${noHomeroom} ห้อง` : "ครบทุกห้อง", action: `<button class="btn" data-go="homerooms">ไปกำหนด</button>` },
    { done: true, title: "เกณฑ์การวัดผลและผู้ลงนาม", text: `เกณฑ์ผ่านตัวชี้วัด ภาค 1 ${settings.indicator_pass_pct}% · ภาค 2 ${settings.indicator_pass_pct_t2 ?? settings.indicator_pass_pct}%`, action: `<button class="btn" data-go="settings">ตรวจ/แก้</button>` },
  ];
  view.innerHTML = `<div class="panel"><ol style="margin:0;padding:0;list-style:none;display:grid;gap:4px">${steps.map((s, i) => `
    <li class="step-row">
      <span class="grade ${s.done ? "g4" : ""}" style="min-width:30px">${s.done ? "✓" : i + 1}</span>
      <span><b>${s.title}</b><br><span class="muted small">${s.text}</span></span>${s.action}</li>`).join("")}</ol></div>
    <p class="muted small" style="margin-top:12px">ทำซ้ำได้ปลอดภัย: ปุ่มสร้างจะเพิ่มเฉพาะส่วนที่ยังไม่มี ไม่ลบหรือเขียนทับของเดิม</p>`;
  document.getElementById("pilotBtn").onclick = async () => {
    const r = await dialog({
      title: "ห้องที่เปิดใช้ระบบ",
      body: `<p class="muted small" style="margin-top:0">เลือกห้องนำร่อง ปุ่มสร้างรายวิชาจะสร้างเฉพาะห้องเหล่านี้ ไม่เลือกเลย = เปิดใช้ทุกห้อง (รายวิชาที่สร้างไว้แล้วไม่ถูกลบ)</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px">${primaryRooms.map((r) => { const k = `${r.grade_level}/${r.classroom}`; return `<label class="check"><input type="checkbox" name="${esc(k)}" ${pilot?.includes(k) ? "checked" : ""}> ${esc(k)}</label>`; }).join("")}</div>`,
    });
    if (!r.ok) return;
    const chosen = primaryRooms.map((x) => `${x.grade_level}/${x.classroom}`).filter((k) => r.data[k]);
    try { await api("/api/admin/pilot", { method: "PUT", body: { year: Y, rooms: chosen } }); toast(chosen.length ? `เปิดใช้ ${chosen.join(", ")}` : "เปิดใช้ทุกห้อง"); render(); } catch (err) { showError(err); }
  };
  document.getElementById("tplBtn").onclick = async () => {
    const r = await dialog({
      title: "สร้างรายวิชาพื้นฐาน",
      body: `<p class="muted small" style="margin-top:0">สร้าง 9 รายวิชาพื้นฐานตามโครงสร้างเวลาเรียนหลักสูตรแกนกลางฯ 2551 (รหัสที่มีอยู่แล้วจะข้าม) ป.1–3 ใช้หลักสูตรใหม่ที่ชื่อวิชาต่างกัน แนะนำให้นำเข้าจาก Excel แทน</p>
        <div class="actions">${GRADES.map((g) => `<label class="check"><input type="checkbox" name="${g}" ${pilotGrades.includes(g) && Number(g.slice(-1)) >= 4 ? "checked" : ""}> ${g}</label>`).join("")}</div>`,
      okText: "สร้าง",
    });
    if (!r.ok) return;
    const grades = GRADES.filter((g) => r.data[g]);
    if (!grades.length) return;
    try { await api("/api/admin/subjects/template", { method: "POST", body: { year: Y, grades } }); toast(`สร้างรายวิชาของ ${grades.join(", ")} แล้ว — ตรวจเวลาเรียนให้ตรงหลักสูตรสถานศึกษา`); render(); } catch (err) { showError(err); }
  };
  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn) copyBtn.onclick = async () => {
    const others = me.years.filter((y) => y.id !== Y);
    const r = await dialog({ title: "คัดลอกรายวิชาจากปีก่อน", body: `<label class="field">จากปีการศึกษา<select name="from">${others.map((y) => `<option value="${y.id}">${y.year_be}</option>`).join("")}</select></label><p class="muted small">เพิ่มเฉพาะรหัสวิชาที่ปีนี้ยังไม่มี ไม่คัดลอกคะแนน</p>`, okText: "คัดลอก" });
    if (!r.ok) return;
    try { const x = await api("/api/admin/subjects/copy", { method: "POST", body: { year: Y, from_year: Number(r.data.from) } }); toast(`เพิ่ม ${x.added} รายวิชา`); render(); } catch (err) { showError(err); }
  };
  document.getElementById("genBtn").onclick = async () => {
    try { const r = await api("/api/admin/courses/generate", { method: "POST", body: { year: Y } }); toast(`เพิ่ม ${r.created} รายวิชา-ห้อง`); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-go]")) b.onclick = () => {
    if (b.dataset.kind) importKind = b.dataset.kind;
    location.hash = b.dataset.go;
  };
}

// ---------- นำเข้าจาก Excel ----------
let importKind = "subjects";
async function renderImport() {
  const spec = IMPORT_KINDS[importKind];
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><div class="actions">${Object.entries(IMPORT_KINDS).map(([k, v]) => `<button class="btn small ${k === importKind ? "primary" : ""}" data-kind="${k}">${v.title}</button>`).join("")}</div>
      <button class="btn" id="tplDl">ดาวน์โหลดแม่แบบ${importKind === "subjects" ? "" : " (มีข้อมูลปัจจุบัน)"}</button></div>
    <p class="small" style="margin:0 0 6px"><b>คอลัมน์:</b> ${spec.columns.map((c) => `<span class="tag">${c.label}${c.optional ? " (ไม่บังคับ)" : ""}</span>`).join(" ")}</p>
    <p class="muted small" style="margin-top:0">${spec.note}</p>
    <label class="field">คัดลอกตารางจาก Excel / Google Sheets มาวางที่นี่ (มีหรือไม่มีแถวหัวตารางก็ได้)
      <textarea id="pasteBox" rows="8" style="font-family:ui-monospace,monospace;font-size:13px" placeholder="${spec.columns.map((c) => c.label).join("\t")}"></textarea></label>
    <div class="actions" style="margin-top:10px"><label class="btn">เลือกไฟล์ Excel / CSV<input type="file" id="fileIn" accept=".xlsx,.xls,.csv" hidden></label>
      <button class="btn primary" id="checkBtn">ตรวจข้อมูล</button><span class="muted small" id="pasteInfo"></span></div>
    <div id="result" style="margin-top:14px"></div></div>`;
  for (const b of view.querySelectorAll("[data-kind]")) b.onclick = () => { importKind = b.dataset.kind; render(); };
  const box = document.getElementById("pasteBox"), info = document.getElementById("pasteInfo"), out = document.getElementById("result");
  const current = () => gridToRows(importKind, parseGrid(box.value));
  box.oninput = () => { const { rows, header } = current(); info.textContent = rows.length ? `${rows.length} แถว${header ? " (พบแถวหัวตาราง)" : ""}` : ""; out.innerHTML = ""; };
  document.getElementById("fileIn").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      if (/\.csv$/i.test(f.name)) box.value = await f.text();
      else {
        const XLSX = await loadXlsx();
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        box.value = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t", blankrows: false });
      }
      box.oninput();
    } catch (err) { showError(err); }
    e.target.value = "";
  };
  document.getElementById("tplDl").onclick = () => downloadTemplate(importKind).catch(showError);
  const send = async (dry) => api(`/api/admin/import/${importKind}`, { method: "POST", body: { year: Y, rows: current().rows, dry_run: dry } });
  document.getElementById("checkBtn").onclick = async () => {
    const { rows } = current();
    if (!rows.length) { toast("ยังไม่มีข้อมูล — วางตารางจาก Excel ก่อน", "bad"); return; }
    let r;
    try { r = await send(true); } catch (err) { showError(err); return; }
    const cols = spec.columns.filter((c) => !c.optional || rows.some((x) => x[c.key]));
    const errAt = Object.fromEntries((r.errors || []).map((e) => [e.row, e.error]));
    out.innerHTML = `${r.errors.length ? `<p class="note bad">พบข้อผิดพลาด ${r.errors.length} แถว — แก้ในไฟล์แล้ววางใหม่ (ยังไม่บันทึกอะไร)</p>`
        : `<p class="note">ข้อมูลถูกต้อง ${rows.length} แถว${r.summary?.add != null ? ` · เพิ่มใหม่ ${r.summary.add} · แก้ของเดิม ${r.summary.update}` : ""}</p>`}
      <div class="table-wrap" style="max-height:420px;margin-top:10px"><table class="list"><thead><tr><th>แถว</th>${cols.map((c) => `<th>${c.label}</th>`).join("")}<th>ผลตรวจ</th></tr></thead>
      <tbody>${rows.map((x, i) => `<tr${errAt[i + 1] ? ' style="background:var(--bad-bg)"' : ""}><td class="num">${i + 1}</td>${cols.map((c) => `<td>${esc(x[c.key])}</td>`).join("")}
        <td class="small">${errAt[i + 1] ? `<span style="color:var(--bad)">${esc(errAt[i + 1])}</span>` : '<span class="tag ok">ถูกต้อง</span>'}</td></tr>`).join("")}</tbody></table></div>
      ${r.errors.length ? "" : `<div class="actions" style="margin-top:12px"><button class="btn primary" id="saveImport">บันทึก ${rows.length} แถว</button></div>`}`;
    const save = document.getElementById("saveImport");
    if (save) save.onclick = async () => {
      save.disabled = true;
      try { await send(false); toast(`นำเข้า${spec.title}แล้ว`); teachersCache = null; box.value = ""; info.textContent = ""; out.innerHTML = `<p class="note">บันทึกแล้ว ${rows.length} แถว</p>`; }
      catch (err) { save.disabled = false; showError(err); }
    };
  };
}

async function downloadTemplate(kind) {
  const spec = IMPORT_KINDS[kind];
  const head = spec.columns.map((c) => c.label);
  let rows = [];
  if (kind === "subjects") {
    const { subjects } = await api(`/api/admin/subjects?${yq}`);
    rows = subjects.length ? subjects.map((s) => [s.grade_level, s.code, s.name, s.learning_area, s.subject_type === "additional" ? "เพิ่มเติม" : "พื้นฐาน", s.hours_per_year, s.collect_ratio])
      : [["ป.4", "ท14101", "ภาษาไทย", "ภาษาไทย", "พื้นฐาน", 160, 70]];
  } else if (kind === "teachers") {
    const [{ courses }, { settings }] = await Promise.all([api(`/api/admin/courses?${yq}`), api(`/api/admin/settings?${yq}`)]);
    rows = courses.filter((c) => !settings.pilot_rooms || settings.pilot_rooms.includes(`${c.grade_level}/${c.classroom}`))
      .map((c) => [`${c.grade_level}/${c.classroom}`, c.code, c.name, c.teachers.map((t) => t.full_name).join(", ")]);
  } else {
    const [{ rooms }, { settings }] = await Promise.all([api(`/api/admin/homerooms?${yq}`), api(`/api/admin/settings?${yq}`)]);
    rows = rooms.filter((r) => !settings.pilot_rooms || settings.pilot_rooms.includes(`${r.grade_level}/${r.classroom}`))
      .map((r) => [`${r.grade_level}/${r.classroom}`, r.teachers.map((t) => t.full_name).join(", ")]);
  }
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws["!cols"] = head.map((h, i) => ({ wch: Math.max(10, h.length + 4, ...rows.map((r) => String(r[i] ?? "").length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, spec.title);
  XLSX.writeFile(wb, `แม่แบบ-${spec.title}-${me.year.year_be}.xlsx`);
}

// ---------- รายวิชา ----------
// สัดส่วนคะแนนระหว่างภาค:ปลายภาค ตั้งแยกรายวิชา (เช่น วิชาปฏิบัติ 80:20) — แต่ละภาคเต็ม 50
const RATIOS = [50, 60, 70, 75, 80, 90, 100];
const perTerm = (r) => `ภาคละ ${String(r / 2).replace(/\.0$/, "")} + ${String(50 - r / 2).replace(/\.0$/, "")}`;
const ratioOptions = (cur) => [...new Set([...RATIOS, Number(cur)])].sort((a, b) => a - b)
  .map((r) => `<option value="${r}" ${r === Number(cur) ? "selected" : ""}>${r}:${100 - r}${r === 100 ? " (ไม่มีสอบปลายภาค)" : ""}</option>`).join("");
async function renderSubjects() {
  const [{ subjects, learning_areas }, { settings: st }] = await Promise.all([api(`/api/admin/subjects?${yq}`), api(`/api/admin/settings?${yq}`)]);
  const defaultRatio = st.collect_ratio;
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>รายวิชาปีการศึกษา ${me.year.year_be}</h2><button class="btn primary" id="addSub">เพิ่มรายวิชา</button></div>
    <p class="muted small" style="margin-top:0">สัดส่วนคะแนนตั้งแยกรายวิชาได้ เช่น วิชาภาคปฏิบัติ 80:20 = แต่ละภาค ระหว่างภาค 40 + ปลายภาค 10 · เปลี่ยนแล้วครูต้องปรับคะแนนเต็มในโครงสร้างให้ตรงสัดส่วนใหม่ก่อนส่งผล</p>
    ${GRADES.map((g) => { const list = subjects.filter((s) => s.grade_level === g); return list.length ? `
      <h3 style="margin-top:18px">${g}</h3>
      <div class="table-wrap"><table class="list"><thead><tr><th>รหัส</th><th>ชื่อวิชา</th><th>กลุ่มสาระ</th><th>ประเภท</th><th class="num">ชม./ปี</th><th>ระหว่างภาค : ปลายภาค</th><th class="num">ห้อง</th><th></th></tr></thead>
      <tbody>${list.map((s) => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td class="small">${esc(s.learning_area)}</td><td>${s.subject_type === "basic" ? "พื้นฐาน" : "เพิ่มเติม"}</td>
        <td class="num">${s.hours_per_year}</td>
        <td><select class="ratio-sel" data-ratio="${s.id}" aria-label="สัดส่วนคะแนน ${esc(s.code)}" ${s.locked_count ? 'disabled title="มีห้องที่ส่งผลแล้ว ส่งคืนก่อนจึงเปลี่ยนได้"' : ""}>${ratioOptions(s.collect_ratio)}</select>
          <span class="small muted">${perTerm(s.collect_ratio)}</span></td><td class="num">${s.course_count}</td>
        <td class="actions"><button class="btn small" data-edit="${s.id}">แก้ไข</button><button class="btn small danger" data-del="${s.id}">ลบ</button></td></tr>`).join("")}</tbody></table></div>` : ""; }).join("") || `<div class="empty"><strong>ยังไม่มีรายวิชา</strong>เริ่มจากเมนู "เริ่มต้นปีการศึกษา" หรือกดเพิ่มรายวิชา</div>`}
  </div>`;
  const form = (s = {}) => `<div class="form-grid">
    <label class="field">ระดับชั้น<select name="grade_level">${GRADES.map((g) => `<option ${s.grade_level === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>
    <label class="field">รหัสวิชา<input name="code" required maxlength="20" value="${esc(s.code || "")}" placeholder="ท11101"></label>
    <label class="field">ประเภท<select name="subject_type"><option value="basic" ${s.subject_type !== "additional" ? "selected" : ""}>พื้นฐาน</option><option value="additional" ${s.subject_type === "additional" ? "selected" : ""}>เพิ่มเติม</option></select></label>
  </div>
  <label class="field" style="margin-top:12px">ชื่อวิชา<input name="name" required maxlength="120" value="${esc(s.name || "")}"></label>
  <div class="form-grid" style="margin-top:12px">
    <label class="field">กลุ่มสาระ<select name="learning_area">${[...learning_areas, "อื่น ๆ"].map((a) => `<option ${s.learning_area === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
    <label class="field">เวลาเรียน (ชม./ปี)<input name="hours_per_year" inputmode="numeric" required value="${s.hours_per_year ?? 40}"></label>
    <label class="field">ระหว่างภาค : ปลายภาค<select name="collect_ratio">${ratioOptions(s.collect_ratio ?? defaultRatio)}</select></label>
    <label class="field">ลำดับในรายงาน<input name="sort_order" inputmode="numeric" value="${s.sort_order ?? 100}"></label>
  </div>
  ${s.id && s.course_count ? '<p class="note warn" style="margin-top:12px">แก้สัดส่วนหรือเวลาเรียนแล้ว ผลการเรียนของทุกห้องจะคำนวณใหม่ตามค่าใหม่ทันที</p>' : ""}`;
  document.getElementById("addSub").onclick = async () => {
    const r = await dialog({ title: "เพิ่มรายวิชา", body: form(), okText: "เพิ่ม" });
    if (!r.ok) return;
    try { await api("/api/admin/subjects", { method: "POST", body: { ...r.data, year: Y } }); toast("เพิ่มรายวิชาแล้ว — กดสร้าง/เติมรายวิชาทุกห้องเพื่อใช้กับห้องเรียน"); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-edit]")) b.onclick = async () => {
    const s = subjects.find((x) => x.id === Number(b.dataset.edit));
    const r = await dialog({ title: `แก้ไข ${s.code}`, body: form(s) });
    if (!r.ok) return;
    try { await api(`/api/admin/subjects/${s.id}`, { method: "PUT", body: r.data }); toast("บันทึกแล้ว"); render(); } catch (err) { showError(err); }
  };
  for (const sel of view.querySelectorAll("[data-ratio]")) sel.onchange = async () => {
    const s = subjects.find((x) => x.id === Number(sel.dataset.ratio));
    const r = Number(sel.value);
    const warn = s.structured_count ? `<br><br><b>${s.structured_count} ห้องตั้งโครงสร้างคะแนนไว้แล้ว</b> ครูต้องปรับคะแนนเต็มให้เป็น${perTerm(r)}ก่อนจึงส่งผลได้ (ระบบไม่ย่อขยายคะแนนให้)` : "";
    if (!(await confirmBox("เปลี่ยนสัดส่วนคะแนน", `${esc(s.code)} ${esc(s.name)} ${esc(s.grade_level)}: ${s.collect_ratio}:${100 - s.collect_ratio} → <b>${r}:${100 - r}</b> (${perTerm(r)})${warn}`, "เปลี่ยน"))) { sel.value = s.collect_ratio; return; }
    try {
      await api(`/api/admin/subjects/${s.id}`, { method: "PUT", body: { grade_level: s.grade_level, code: s.code, name: s.name, learning_area: s.learning_area, subject_type: s.subject_type, hours_per_year: s.hours_per_year, collect_ratio: r, sort_order: s.sort_order } });
      toast(`ตั้ง ${s.code} เป็น ${r}:${100 - r} แล้ว`); render();
    } catch (err) { sel.value = s.collect_ratio; showError(err); }
  };
  for (const b of view.querySelectorAll("[data-del]")) b.onclick = async () => {
    const s = subjects.find((x) => x.id === Number(b.dataset.del));
    if (!(await confirmBox("ลบรายวิชา", `ลบ ${esc(s.code)} ${esc(s.name)} ของ ${esc(s.grade_level)} และรายวิชาของทุกห้อง (ลบได้เฉพาะเมื่อยังไม่มีคะแนน)`, "ลบ", true))) return;
    try { await api(`/api/admin/subjects/${s.id}`, { method: "DELETE" }); toast("ลบแล้ว"); render(); } catch (err) { showError(err); }
  };
}

const statusTag = (c) => c.status === "approved" ? '<span class="tag ok">อนุมัติแล้ว</span>'
  : c.status === "submitted" ? '<span class="tag">ส่งแล้ว รออนุมัติ</span>'
  : c.return_note ? `<span class="tag warn" title="${esc(c.return_note)}">ส่งคืนให้แก้</span>`
  : c.item_count ? '<span class="tag">กำลังกรอก</span>' : '<span class="tag warn">ยังไม่ตั้งโครงสร้าง</span>';

// ---------- ครูผู้สอน ----------
let selRoom = sessionStorage.getItem("sr-admin-room") || "";
async function renderCourses() {
  const [{ courses }, list] = await Promise.all([api(`/api/admin/courses?${yq}`), teachers()]);
  const rooms = [...new Set(courses.map((c) => `${c.grade_level}/${c.classroom}`))];
  if (!rooms.length) { view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีรายวิชาของห้องเรียน</strong>ทำขั้นตอนในเมนู "เริ่มต้นปีการศึกษา" ก่อน</div>`; return; }
  if (!rooms.includes(selRoom)) selRoom = rooms[0];
  const inRoom = courses.filter((c) => `${c.grade_level}/${c.classroom}` === selRoom);
  const missing = (r) => courses.filter((c) => `${c.grade_level}/${c.classroom}` === r && !c.teachers.length).length;
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><div class="actions">${rooms.map((r) => `<button class="btn small ${r === selRoom ? "primary" : ""}" data-room="${r}">${r}${missing(r) ? ` <span class="tag warn">${missing(r)}</span>` : ""}</button>`).join("")}</div></div>
    <div class="actions" style="margin-bottom:12px"><button class="btn" id="assignAll">ให้ครู 1 คนสอนหลายวิชาในห้อง ${selRoom}</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>รหัส</th><th>วิชา</th><th>ครูผู้สอน</th><th>ความคืบหน้า</th><th>สถานะ</th><th></th></tr></thead>
    <tbody>${inRoom.map((c) => `<tr><td>${esc(c.code)}</td><td><a href="/course.html?id=${c.id}&year=${Y}">${esc(c.name)}</a></td>
      <td>${c.teachers.length ? c.teachers.map((t) => esc(t.full_name)).join(", ") : '<span class="tag warn">ยังไม่กำหนด</span>'}</td>
      <td style="min-width:120px"><span class="small muted">${c.progress}%</span><div class="meter ${c.progress >= 100 ? "done" : ""}"><i style="width:${c.progress}%"></i></div></td>
      <td>${statusTag(c)}</td>
      <td class="actions"><button class="btn small" data-teach="${c.id}">ครูผู้สอน</button>${c.locked ? `<button class="btn small" data-unlock="${c.id}">ส่งคืน</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
    ${me.user.is_super && inRoom.some((c) => c.status === "submitted") ? `<div class="actions" style="margin-top:12px"><button class="btn primary" id="approveRoom">อนุมัติทุกวิชาที่ส่งแล้วของห้อง ${selRoom} (${inRoom.filter((c) => c.status === "submitted").length})</button></div>` : ""}</div>`;
  const ar = document.getElementById("approveRoom");
  if (ar) ar.onclick = async () => {
    const ids = inRoom.filter((c) => c.status === "submitted").map((c) => c.id);
    if (!(await confirmBox("อนุมัติผลการเรียน", `อนุมัติ ${ids.length} รายวิชาที่ส่งแล้วของห้อง ${selRoom}`, "อนุมัติ"))) return;
    try { const r = await api("/api/admin/courses/approve", { method: "POST", body: { course_ids: ids } }); toast(`อนุมัติ ${r.approved} รายวิชา`); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-room]")) b.onclick = () => { selRoom = b.dataset.room; sessionStorage.setItem("sr-admin-room", selRoom); render(); };
  const teacherChecks = (chosen) => `<input type="search" placeholder="ค้นหาชื่อครู" data-filter style="margin-bottom:10px">
    <div style="display:grid;gap:4px;max-height:340px;overflow:auto">${list.map((t) => `<label class="check" data-name="${esc(t.full_name)}"><input type="checkbox" name="t${t.id}" ${chosen.includes(t.id) ? "checked" : ""}> ${esc(t.full_name)}</label>`).join("")}</div>`;
  const bindFilter = (d) => { const f = d.querySelector("[data-filter]"); f.oninput = () => { for (const l of d.querySelectorAll("[data-name]")) l.hidden = !l.dataset.name.includes(f.value.trim()); }; };
  for (const b of view.querySelectorAll("[data-teach]")) b.onclick = async () => {
    const c = inRoom.find((x) => x.id === Number(b.dataset.teach));
    const r = await dialog({ title: `ครูผู้สอน ${c.code} ${c.grade_level}/${c.classroom}`, body: teacherChecks(c.teachers.map((t) => t.id)), onOpen: bindFilter });
    if (!r.ok) return;
    const ids = list.filter((t) => r.data[`t${t.id}`]).map((t) => t.id);
    try { await api(`/api/admin/courses/${c.id}/teachers`, { method: "PUT", body: { user_ids: ids } }); toast("บันทึกแล้ว"); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-unlock]")) b.onclick = async () => {
    const r = await dialog({ title: "ส่งคืนให้ครูแก้", okText: "ส่งคืน", okClass: "danger",
      body: `<label class="field">เหตุผล / สิ่งที่ต้องแก้ (ครูจะเห็นข้อความนี้)<textarea name="note" required minlength="3" maxlength="500"></textarea></label>` });
    if (!r.ok) return;
    try { await api(`/api/admin/courses/${b.dataset.unlock}/return`, { method: "POST", body: { note: r.data.note } }); toast("ส่งคืนแล้ว"); render(); } catch (err) { showError(err); }
  };
  document.getElementById("assignAll").onclick = async () => {
    const r = await dialog({
      title: `มอบหมายหลายวิชาในห้อง ${selRoom}`,
      body: `<label class="field">ครูผู้สอน<select name="user_id" required><option value="">เลือกครู</option>${list.map((t) => `<option value="${t.id}">${esc(t.full_name)}</option>`).join("")}</select></label>
        <p class="muted small" style="margin:12px 0 6px">วิชาที่ให้สอน (เพิ่มเป็นครูผู้สอนร่วม ไม่ลบครูเดิม)</p>
        <div style="display:grid;gap:4px">${inRoom.map((c) => `<label class="check"><input type="checkbox" name="c${c.id}" ${c.teachers.length ? "" : "checked"}> ${esc(c.code)} ${esc(c.name)}</label>`).join("")}</div>`,
    });
    if (!r.ok || !r.data.user_id) return;
    const ids = inRoom.filter((c) => r.data[`c${c.id}`]).map((c) => c.id);
    try { await api("/api/admin/courses/assign-room", { method: "POST", body: { user_id: Number(r.data.user_id), course_ids: ids } }); toast(`มอบหมาย ${ids.length} วิชาแล้ว`); render(); } catch (err) { showError(err); }
  };
}

// ---------- ครูประจำชั้น ----------
async function renderHomerooms() {
  const [{ rooms }, list] = await Promise.all([api(`/api/admin/homerooms?${yq}`), teachers()]);
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>ครูประจำชั้น</h2>${CAN_IMPORT ? '<button class="btn" id="importHr">ดึงจากหน้าวิเคราะห์ผู้เรียน (ระบบบริหารฯ)</button>' : ""}</div>
    <div class="table-wrap"><table class="list"><thead><tr><th>ห้อง</th><th class="num">นักเรียน</th><th>ครูประจำชั้น</th><th></th></tr></thead>
    <tbody>${rooms.map((r, i) => `<tr><td><a href="/homeroom.html?grade=${encodeURIComponent(r.grade_level)}&room=${encodeURIComponent(r.classroom)}&year=${Y}">${esc(r.grade_level)}/${esc(r.classroom)}</a></td><td class="num">${r.students}</td>
      <td>${r.teachers.length ? r.teachers.map((t) => esc(t.full_name)).join(", ") : '<span class="tag warn">ยังไม่กำหนด</span>'}</td>
      <td><button class="btn small" data-i="${i}">กำหนด</button></td></tr>`).join("")}</tbody></table></div></div>`;
  if (CAN_IMPORT) document.getElementById("importHr").onclick = async () => {
    try { const r = await api("/api/admin/homerooms/import", { method: "POST", body: { year: Y } }); toast(r.added ? `เพิ่ม ${r.added} รายการ` : "ไม่มีข้อมูลใหม่ให้ดึง"); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-i]")) b.onclick = async () => {
    const r0 = rooms[Number(b.dataset.i)];
    const chosen = r0.teachers.map((t) => t.id);
    const r = await dialog({
      title: `ครูประจำชั้น ${r0.grade_level}/${r0.classroom}`,
      body: `<input type="search" placeholder="ค้นหาชื่อครู" data-filter style="margin-bottom:10px"><div style="display:grid;gap:4px;max-height:340px;overflow:auto">${list.map((t) => `<label class="check" data-name="${esc(t.full_name)}"><input type="checkbox" name="t${t.id}" ${chosen.includes(t.id) ? "checked" : ""}> ${esc(t.full_name)}</label>`).join("")}</div>`,
      onOpen: (d) => { const f = d.querySelector("[data-filter]"); f.oninput = () => { for (const l of d.querySelectorAll("[data-name]")) l.hidden = !l.dataset.name.includes(f.value.trim()); }; },
    });
    if (!r.ok) return;
    try { await api("/api/admin/homerooms", { method: "PUT", body: { year: Y, grade_level: r0.grade_level, classroom: r0.classroom, user_ids: list.filter((t) => r.data[`t${t.id}`]).map((t) => t.id) } }); toast("บันทึกแล้ว"); render(); } catch (err) { showError(err); }
  };
}

// ---------- นักเรียนย้ายเข้า / ย้ายออก / ออกกลางคัน (soft delete) ----------
const STATUS_TH = { enrolled: "กำลังเรียน", transferred: "ย้ายออก", withdrawn: "ออกกลางคัน", graduated: "จบการศึกษา" };
let moveQuery = "";
async function renderMoves() {
  const m = await api(`/api/moves?${yq}`);
  const termSel = (name = "term_number") => `<label>ภาคเรียน<select name="${name}">${[1, 2].map((t) => `<option value="${t}" ${t === m.term_number ? "selected" : ""}>ภาคเรียนที่ ${t}</option>`).join("")}</select></label>`;
  const roomSel = () => `<label>เข้าเรียนห้อง<select name="room" required><option value="">เลือกห้อง</option>${m.rooms.map((r) => `<option value="${esc(r.grade_level)}|${esc(r.classroom)}">${esc(r.grade_level)}/${esc(r.classroom)}</option>`).join("")}</select></label>`;
  view.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>ค้นหานักเรียน</h2><button class="btn primary" id="newKid">+ นักเรียนย้ายเข้าใหม่</button></div>
      <p class="muted small">นักเรียนที่ย้ายออกหรือออกกลางคันจะไม่แสดงในรายชื่อทุกหน้า แต่ระบบไม่ลบข้อมูล — ถ้ากลับมาเรียนอีก ให้ค้นหาแล้วกด "รับกลับเข้าเรียน" จะได้เลขประจำตัวเดิมและข้อมูลเดิมทั้งหมด
        · นักเรียนที่เข้าระหว่างปีได้เลขที่ต่อท้ายห้อง เลขที่ของคนเดิมไม่เลื่อน</p>
      <form id="findForm" class="row-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <input type="search" name="q" value="${esc(moveQuery)}" placeholder="เลขประจำตัว / เลขบัตรประชาชน 13 หลัก / ชื่อ" style="flex:1;min-width:220px" required>
        <button class="btn">ค้นหา</button>
      </form>
      <div id="found"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>รายการปีการศึกษา ${me.year.year_be}</h2></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>วันที่</th><th>นักเรียน</th><th>รายการ</th><th>ห้อง</th><th>ภาค</th><th>โรงเรียน / หมายเหตุ</th><th>บันทึกโดย</th><th></th></tr></thead>
      <tbody>${m.moves.map((x) => `<tr class="${x.undone_at ? "muted" : ""}">
        <td class="small">${esc(x.move_date || x.created_at.slice(0, 10))}</td><td>${esc(x.student_code)} ${esc(x.name)}</td>
        <td><span class="tag ${x.direction === "out" ? "warn" : "ok"}">${esc(x.label)}</span>${x.undone_at ? ' <span class="tag">ยกเลิกแล้ว</span>' : ""}</td>
        <td>${esc(x.grade_level || "")}/${esc(x.classroom || "")}</td><td class="num">${x.term_number}</td>
        <td class="small">${esc([x.school, x.note].filter(Boolean).join(" · "))}</td><td class="small">${esc(x.by_name || "")}</td>
        <td>${x.direction === "out" && !x.undone_at ? `<button class="btn small" data-undo="${x.id}">ยกเลิก</button>` : x.direction === "in" ? `<a class="small" href="/homeroom.html?grade=${encodeURIComponent(x.grade_level)}&room=${encodeURIComponent(x.classroom)}&year=${Y}#carry">คะแนนยกมา</a>` : ""}</td></tr>`).join("")
        || `<tr><td colspan="8" class="empty">ยังไม่มีรายการ</td></tr>`}</tbody></table></div>
    </div>`;

  const showFound = async () => {
    const box = document.getElementById("found");
    if (!moveQuery) { box.innerHTML = ""; return; }
    box.innerHTML = `<p class="muted small">กำลังค้นหา…</p>`;
    const { results } = await api(`/api/moves?${yq}&q=${encodeURIComponent(moveQuery)}`);
    box.innerHTML = results.length ? `<div class="table-wrap" style="margin-top:10px"><table class="list"><thead><tr><th>เลขประจำตัว</th><th>ชื่อ–สกุล</th><th>เลขประจำตัวประชาชน</th><th>ห้องล่าสุด</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${results.map((x, i) => `<tr><td>${esc(x.student_code)}</td><td>${esc(x.name)}</td><td class="small">${esc(x.national_id)}</td>
        <td>${x.grade_level ? `${esc(x.grade_level)}/${esc(x.classroom)}${x.in_year ? "" : ` <span class="muted small">(ปี ${esc(x.last_year_be || "")})</span>`}` : "–"}</td>
        <td><span class="tag ${x.enrolled ? "ok" : "warn"}">${esc(STATUS_TH[x.status] || x.status)}</span></td>
        <td class="actions">${x.enrolled
          ? `<button class="btn small" data-out="${i}" data-reason="transfer">ย้ายออก</button><button class="btn small" data-out="${i}" data-reason="dropout">ออกกลางคัน</button>`
          : `<button class="btn small primary" data-back="${i}">รับกลับเข้าเรียน</button>`}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted" style="margin-top:10px">ไม่พบนักเรียน — ถ้าเป็นนักเรียนที่ไม่เคยเรียนที่นี่ ให้กด "นักเรียนย้ายเข้าใหม่"</p>`;
    for (const b of box.querySelectorAll("[data-out]")) b.onclick = async () => {
      const x = results[Number(b.dataset.out)], transfer = b.dataset.reason === "transfer";
      const r = await dialog({
        title: `${transfer ? "ย้ายออก" : "ออกกลางคัน / ติดตามไม่ได้"}: ${x.name}`,
        okText: "บันทึก", okClass: "danger",
        body: `<p class="muted small">${esc(x.name)} จะไม่แสดงในรายชื่อ รายวิชา ปพ.5 และ ปพ.6 อีก แต่ข้อมูลและคะแนนยังเก็บไว้ ยกเลิกได้ภายหลัง</p>
          <div class="form-grid">${termSel()}<label>วันที่${transfer ? "ย้ายออก" : "ออก"}<input type="date" name="move_date"></label>
          ${transfer ? `<label>ย้ายไปโรงเรียน<input name="school" maxlength="200"></label>` : ""}
          <label>หมายเหตุ<input name="note" maxlength="300" placeholder="${transfer ? "" : "เช่น ขาดเรียนต่อเนื่อง ติดตามไม่ได้"}"></label></div>`,
      });
      if (!r.ok) return;
      try { await api(`/api/moves/out?${yq}`, { method: "POST", body: { student_id: x.id, reason: b.dataset.reason, ...r.data } }); toast("บันทึกแล้ว"); renderMoves(); } catch (err) { showError(err); }
    };
    for (const b of box.querySelectorAll("[data-back]")) b.onclick = async () => {
      const x = results[Number(b.dataset.back)];
      const r = await dialog({
        title: `รับกลับเข้าเรียน: ${x.name}`,
        body: `<p class="muted small">ใช้ระเบียนเดิม เลขประจำตัว ${esc(x.student_code)}</p>
          <div class="form-grid">${roomSel()}${termSel()}<label>วันที่เข้าเรียน<input type="date" name="move_date"></label>
          <label>ย้ายมาจากโรงเรียน<input name="school" maxlength="200"></label><label>หมายเหตุ<input name="note" maxlength="300"></label></div>`,
      });
      if (!r.ok) return;
      const [grade_level, classroom] = String(r.data.room || "").split("|");
      try { await api(`/api/moves/in?${yq}`, { method: "POST", body: { student_id: x.id, grade_level, classroom, ...r.data } }); toast("รับเข้าแล้ว — ครูประจำชั้นกรอกคะแนนยกมาจาก ปพ.6 ได้ที่หน้าห้อง"); renderMoves(); } catch (err) { showError(err); }
    };
  };
  document.getElementById("findForm").onsubmit = (e) => { e.preventDefault(); moveQuery = e.target.q.value.trim(); showFound().catch(showError); };
  showFound().catch(showError);

  document.getElementById("newKid").onclick = async () => {
    const r = await dialog({
      title: "นักเรียนย้ายเข้าใหม่",
      body: `<p class="muted small">ค้นหาก่อนเสมอ ถ้าเคยเรียนที่นี่มาก่อนให้ใช้ "รับกลับเข้าเรียน" เพื่อใช้เลขประจำตัวเดิม — ระบบจะไม่ยอมให้เลขประจำตัวหรือเลขบัตรประชาชนซ้ำ</p>
        <div class="form-grid">
          <label>เลขประจำตัวนักเรียน<input name="student_code" value="${esc(m.next_code)}" required maxlength="20"></label>
          <label>คำนำหน้า<select name="name_prefix"><option>เด็กชาย</option><option>เด็กหญิง</option></select></label>
          <label>ชื่อ<input name="first_name" required maxlength="80"></label>
          <label>นามสกุล<input name="last_name" required maxlength="80"></label>
          <label>เลขประจำตัวประชาชน<input name="national_id" inputmode="numeric" maxlength="17"></label>
          <label>วันเกิด<input type="date" name="birth_date"></label>
          ${roomSel()}${termSel()}
          <label>วันที่ย้ายเข้า<input type="date" name="move_date"></label>
          <label>ย้ายมาจากโรงเรียน<input name="school" maxlength="200"></label>
        </div>`,
    });
    if (!r.ok) return;
    const d = r.data, [grade_level, classroom] = String(d.room || "").split("|");
    try {
      await api(`/api/moves/in?${yq}`, { method: "POST", body: { grade_level, classroom, term_number: d.term_number, move_date: d.move_date, school: d.school,
        student: { student_code: d.student_code, name_prefix: d.name_prefix, first_name: d.first_name, last_name: d.last_name, national_id: d.national_id, birth_date: d.birth_date } } });
      toast("เพิ่มนักเรียนแล้ว — ครูประจำชั้นกรอกคะแนนยกมาจาก ปพ.6 ได้ที่หน้าห้อง");
      moveQuery = d.student_code; renderMoves();
    } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-undo]")) b.onclick = async () => {
    if (!(await confirmBox("ยกเลิกรายการนี้", "นักเรียนจะกลับมาอยู่ในรายชื่อห้องเดิมพร้อมข้อมูลเดิม"))) return;
    try { await api(`/api/moves/${b.dataset.undo}/undo?${yq}`, { method: "POST", body: {} }); toast("ยกเลิกแล้ว"); renderMoves(); } catch (err) { showError(err); }
  };
}

// ---------- คลังตัวชี้วัด ----------
async function renderBank() {
  const { learning_areas } = await api(`/api/admin/subjects?${yq}`);
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>นำเข้าตัวชี้วัดเข้าคลัง</h2></div>
    <p class="muted small">ครูทุกคนจะเลือกตัวชี้วัดจากคลังนี้ได้ในหน้าโครงสร้างคะแนน เลือกชั้นและกลุ่มสาระ แล้ววางตัวชี้วัดจากเอกสารหลักสูตรบรรทัดละ 1 ข้อ</p>
    <form id="bankForm">
      <div class="form-grid">
        <label class="field">ระดับชั้น<select name="grade">${GRADES.map((g) => `<option>${g}</option>`).join("")}</select></label>
        <label class="field">กลุ่มสาระ<select name="area">${learning_areas.map((a) => `<option>${a}</option>`).join("")}</select></label>
      </div>
      <label class="field" style="margin-top:12px">ตัวชี้วัด<textarea name="lines" required placeholder="ท 1.1 ป.1/1 ออกเสียงคำ คำคล้องจอง และข้อความสั้น ๆ"></textarea></label>
      <div class="actions" style="margin-top:12px"><button class="btn primary">นำเข้า</button><span class="muted small" id="bankPreview"></span></div>
    </form></div>`;
  const f = document.getElementById("bankForm");
  f.lines.oninput = () => { const n = parseIndicatorLines(f.lines.value).length; document.getElementById("bankPreview").textContent = n ? `พบ ${n} ตัวชี้วัด` : ""; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const rows = parseIndicatorLines(f.lines.value).map((r) => ({ ...r, grade_level: f.grade.value, learning_area: f.area.value }));
    if (!rows.length) return;
    try { const r = await api("/api/admin/indicator-bank/import", { method: "POST", body: { rows } }); toast(`เพิ่ม ${r.added} ตัวชี้วัด${r.skipped ? ` (ซ้ำ ${r.skipped})` : ""}`); f.lines.value = ""; } catch (err) { showError(err); }
  };
}

// ---------- เกณฑ์และผู้ลงนาม ----------
async function renderSettings() {
  const { settings: s } = await api(`/api/admin/settings?${yq}`);
  view.innerHTML = `<form class="panel" id="setForm">
    <div class="panel-head"><h2>เกณฑ์การวัดผล ปีการศึกษา ${me.year.year_be}</h2></div>
    <div class="form-grid">
      <label class="field">สัดส่วนระหว่างภาคเริ่มต้นของวิชาใหม่ (%)<input name="collect_ratio" inputmode="numeric" value="${s.collect_ratio}" required></label>
      <label class="field">เกณฑ์ผ่านตัวชี้วัด ภาค 1 (%)<input name="indicator_pass_pct" inputmode="numeric" value="${s.indicator_pass_pct}" required></label>
      <label class="field">เกณฑ์ผ่านตัวชี้วัด ภาค 2 (%)<input name="indicator_pass_pct_t2" inputmode="numeric" value="${s.indicator_pass_pct_t2 ?? ""}" placeholder="ว่าง = ใช้ค่าภาค 1"></label>
      <label class="field">เกณฑ์เวลาเรียน (%)<input name="attendance_pass_pct" inputmode="numeric" value="${s.attendance_pass_pct}" required></label>
    </div>
    <p class="muted small">ตัวชี้วัดที่ได้คะแนนถึงร้อยละนี้ของคะแนนเต็มได้ "ผ" · คะแนนรวมไม่ปัดเศษ ตัดเกรดจากคะแนนจริง (79.5 = 3.5)</p>
    <label class="field" style="margin-top:14px;max-width:420px">การเรียงเลขที่ในห้อง<select name="roster_order">
      <option value="gender" ${s.roster_order !== "code" ? "selected" : ""}>ชายก่อนหญิง แล้วเรียงตามเลขประจำตัว</option>
      <option value="code" ${s.roster_order === "code" ? "selected" : ""}>เรียงตามเลขประจำตัวอย่างเดียว</option></select></label>
    <p class="muted small">ต้องตรงกับรายชื่อที่ครูใช้ใน Excel เพราะการวางคะแนนจะลงตามลำดับเลขที่</p>
    <label class="check" style="margin-top:14px"><input type="checkbox" name="entry_open" ${s.entry_open ? "checked" : ""}> เปิดให้ครูกรอก/แก้ไขคะแนน</label>
    <h2 style="margin-top:24px">ข้อมูลบนเอกสาร</h2>
    <div class="form-grid">
      <label class="field">ชื่อโรงเรียน<input name="school_name" value="${esc(s.school_name)}" maxlength="120"></label>
      <label class="field">เขตพื้นที่<input name="school_area" value="${esc(s.school_area)}" maxlength="160" placeholder="สำนักงานเขตพื้นที่การศึกษาประถมศึกษาเพชรบุรี เขต 2"></label>
      <label class="field">สังกัด<input name="affiliation" value="${esc(s.affiliation)}" maxlength="160"></label>
      <label class="field">ที่อยู่บนปก ปพ.5<input name="school_address" value="${esc(s.school_address)}" maxlength="160" placeholder="อำเภอแก่งกระจาน จังหวัดเพชรบุรี"></label>
      <label class="field">ผู้อำนวยการ<input name="director_name" value="${esc(s.director_name)}" maxlength="120"></label>
      <label class="field">รองผู้อำนวยการ<input name="deputy_director_name" value="${esc(s.deputy_director_name)}" maxlength="120"></label>
      <label class="field">หัวหน้างานวิชาการ<input name="academic_head_name" value="${esc(s.academic_head_name)}" maxlength="120"></label>
      <label class="field">หัวหน้างานวัดผล<input name="measurement_head_name" value="${esc(s.measurement_head_name)}" maxlength="120"></label>
    </div>
    <div class="actions" style="margin-top:16px"><button class="btn primary">บันทึก</button></div></form>`;
  document.getElementById("setForm").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.entry_open = !!d.entry_open;
    try { await api(`/api/admin/settings?${yq}`, { method: "PUT", body: d }); toast("บันทึกแล้ว"); } catch (err) { showError(err); }
  };
}

// ---------- สิทธิ์ผู้ดูแล ----------
async function renderPeople() {
  teachersCache = null;
  const list = await teachers();
  view.innerHTML = `<div class="panel"><div class="panel-head"><h2>ทีมวัดและประเมินผล</h2></div>
    <p class="muted small">ผู้ที่ได้สิทธิ์จะเห็นบทบาท "เจ้าหน้าที่วัดผล" ในเมนูซ้าย: ตั้งค่ารายวิชา นำเข้าข้อมูล ติดตามและส่งคืนงาน · ผู้ดูแลระบบมีทุกสิทธิ์อยู่แล้ว · ผู้บริหารอนุมัติผลได้โดยไม่ต้องมีสิทธิ์นี้</p>
    <div class="table-wrap"><table class="list"><thead><tr><th>ชื่อ</th><th>บทบาทในระบบบริหารฯ</th><th>ทีมวัดและประเมินผล</th></tr></thead>
    <tbody>${list.map((t) => { const built = t.role === "superadmin"; return `<tr><td>${esc(t.full_name)}</td><td class="small muted">${esc(t.role)}</td>
      <td>${built ? '<span class="tag ok">มีสิทธิ์อยู่แล้ว</span>' : `<label class="check"><input type="checkbox" data-u="${t.id}" ${t.grade_role ? "checked" : ""}> ให้สิทธิ์</label>`}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  for (const c of view.querySelectorAll("[data-u]")) c.onchange = async () => {
    try { await api("/api/admin/staff-roles", { method: "PUT", body: { user_id: Number(c.dataset.u), grant: c.checked } }); toast(c.checked ? "ให้สิทธิ์แล้ว" : "ยกเลิกสิทธิ์แล้ว"); } catch (err) { c.checked = !c.checked; showError(err); }
  };
}

// ---------- อนุมัติผลการเรียน (ผู้บริหาร) ----------
async function renderApprove() {
  const { courses } = await api(`/api/admin/courses?${yq}`);
  const waiting = courses.filter((c) => c.status === "submitted");
  const done = courses.filter((c) => c.status === "approved");
  const rooms = [...new Set(waiting.map((c) => `${c.grade_level}/${c.classroom}`))];
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>รอการอนุมัติ <span class="tag">${waiting.length} รายวิชา</span></h2>
      ${waiting.length ? '<div class="actions"><label class="check"><input type="checkbox" id="allChk"> เลือกทั้งหมด</label><button class="btn primary" id="approveSel" disabled>อนุมัติที่เลือก</button></div>' : ""}</div>
    ${waiting.length ? rooms.map((r) => `<h3 style="margin-top:14px">${esc(r)}</h3>
      <div class="table-wrap"><table class="list"><thead><tr><th style="width:36px"></th><th>รหัส</th><th>วิชา</th><th>ครูผู้สอน</th><th>ส่งเมื่อ</th><th></th></tr></thead>
      <tbody>${waiting.filter((c) => `${c.grade_level}/${c.classroom}` === r).map((c) => `<tr>
        <td><input type="checkbox" class="pick" value="${c.id}" aria-label="เลือก ${esc(c.code)}" style="width:18px;height:18px;min-height:0"></td>
        <td>${esc(c.code)}</td><td><a href="/course.html?id=${c.id}&year=${Y}">${esc(c.name)}</a></td>
        <td class="small">${c.teachers.map((t) => esc(t.full_name)).join(", ")}</td><td class="small muted">${esc(String(c.submitted_at || "").slice(0, 16))}</td>
        <td class="actions"><a class="btn small" target="_blank" rel="noopener" href="/print/pp5.html?course=${c.id}">ตรวจ ปพ.5</a></td></tr>`).join("")}</tbody></table></div>`).join("")
      : `<div class="empty"><strong>ไม่มีรายวิชารออนุมัติ</strong>เมื่อครูส่งผลแล้ว รายวิชาจะขึ้นที่นี่</div>`}
  </div>
  <div class="panel"><div class="panel-head"><h2>อนุมัติแล้ว <span class="tag ok">${done.length}</span></h2></div>
    <p class="muted small">ถ้าต้องแก้ผลหลังอนุมัติ ให้ฝ่ายวิชาการส่งคืนพร้อมเหตุผลจากหน้ารายวิชา แล้วอนุมัติใหม่</p></div>`;
  const picks = () => [...view.querySelectorAll(".pick")];
  const sync = () => { const n = picks().filter((p) => p.checked).length; const b = document.getElementById("approveSel"); if (b) { b.disabled = !n; b.textContent = n ? `อนุมัติที่เลือก (${n})` : "อนุมัติที่เลือก"; } };
  for (const p of picks()) p.onchange = sync;
  const all = document.getElementById("allChk");
  if (all) all.onchange = () => { for (const p of picks()) p.checked = all.checked; sync(); };
  const btn = document.getElementById("approveSel");
  if (btn) btn.onclick = async () => {
    const ids = picks().filter((p) => p.checked).map((p) => Number(p.value));
    if (!(await confirmBox("อนุมัติผลการเรียน", `อนุมัติ ${ids.length} รายวิชา`, "อนุมัติ"))) return;
    try { const r = await api("/api/admin/courses/approve", { method: "POST", body: { course_ids: ids } }); toast(`อนุมัติ ${r.approved} รายวิชา`); render(); } catch (err) { showError(err); }
  };
}

// ---------- ประวัติการใช้งาน ----------
const ACTION_TEXT = {
  "course.submit": "ส่งผลการเรียน", "course.return": "ส่งคืนให้ครูแก้", "course.reopen_approved": "ส่งคืนหลังอนุมัติ", "course.approve": "อนุมัติผล",
  "settings.update": "แก้เกณฑ์/ผู้ลงนาม", "pilot.set": "ตั้งห้องที่เปิดใช้", "import.subjects": "นำเข้ารายวิชา", "import.teachers": "นำเข้าครูผู้สอน",
  "import.homerooms": "นำเข้าครูประจำชั้น", "template.save": "บันทึกแม่แบบ", "template.apply": "ใช้แม่แบบ", "scores.remedial": "บันทึกคะแนนแก้ตัว",
  "results.update": "แก้เวลาเรียน/ผลพิเศษ", "items.add": "เพิ่มช่องคะแนน", "item.update": "แก้ช่องคะแนน", "item.delete": "ลบช่องคะแนน",
  "staff_role": "ให้/ถอนสิทธิ์ทีมวัดผล", "subject.create": "เพิ่มรายวิชา", "subject.update": "แก้รายวิชา", "subject.delete": "ลบรายวิชา",
};
async function renderAudit() {
  const { entries } = await api("/api/admin/audit");
  view.innerHTML = `<div class="panel"><div class="panel-head"><h2>200 รายการล่าสุด</h2><input type="search" id="auditQ" placeholder="ค้นหาชื่อหรือการกระทำ" style="max-width:260px"></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>เวลา (UTC)</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead>
    <tbody>${entries.map((e) => `<tr data-q="${esc(`${e.full_name || ""} ${ACTION_TEXT[e.action] || e.action}`)}"><td class="small nowrap">${esc(e.created_at)}</td><td>${esc(e.full_name || "–")}</td>
      <td>${esc(ACTION_TEXT[e.action] || e.action)}</td><td class="small muted" style="max-width:420px;word-break:break-word">${esc(String(e.detail || "").slice(0, 220))}</td></tr>`).join("")}</tbody></table></div></div>`;
  const q = document.getElementById("auditQ");
  q.oninput = () => { for (const tr of view.querySelectorAll("tbody tr")) tr.hidden = !tr.dataset.q.includes(q.value.trim()); };
}

renderTabs();
render();
