import { shell, api, esc, toast, showError, dialog, confirmBox } from "/js/app.js";
import { parseIndicatorLines } from "/js/indicators.js";

const me = await shell("admin");
const view = document.getElementById("view");
const main = document.getElementById("main");
if (!me.user.is_admin) {
  main.hidden = false;
  view.innerHTML = `<div class="panel empty"><strong>หน้านี้สำหรับฝ่ายวิชาการ/วัดผล</strong>ติดต่อผู้บริหารเพื่อขอสิทธิ์</div>`;
  throw new Error("not admin");
}
const Y = me.year.id;
const yq = `year=${Y}`;
main.hidden = false;
document.getElementById("yearLine").textContent = `ปีการศึกษา ${me.year.year_be} — ใช้ข้อมูลห้องเรียนและนักเรียนจากระบบบริหารโรงเรียน`;
const GRADES = ["ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];
let tab = sessionStorage.getItem("sr-admin-tab") || "start";
let teachersCache;
const teachers = async () => (teachersCache ||= (await api("/api/admin/teachers")).teachers);

function renderTabs() {
  for (const b of document.querySelectorAll("#tabs button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    b.onclick = () => { tab = b.dataset.tab; sessionStorage.setItem("sr-admin-tab", tab); renderTabs(); render(); };
  }
}

async function render() {
  view.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
  try {
    await ({ start: renderStart, subjects: renderSubjects, courses: renderCourses, homerooms: renderHomerooms, bank: renderBank, settings: renderSettings, people: renderPeople })[tab]();
  } catch (err) { view.innerHTML = `<div class="panel empty"><strong>โหลดข้อมูลไม่สำเร็จ</strong>${esc(err.message)}</div>`; }
}

// ---------- เริ่มต้นปี: ขั้นตอนตามลำดับ ----------
async function renderStart() {
  const [{ rooms }, { subjects }, { courses }, hr] = await Promise.all([
    api(`/api/admin/rooms?${yq}`), api(`/api/admin/subjects?${yq}`), api(`/api/admin/courses?${yq}`), api(`/api/admin/homerooms?${yq}`),
  ]);
  const primaryRooms = rooms.filter((r) => GRADES.includes(r.grade_level));
  const noTeacher = courses.filter((c) => !c.teachers.length).length;
  const noHomeroom = hr.rooms.filter((r) => !r.teachers.length).length;
  const steps = [
    { done: primaryRooms.length > 0, title: "ห้องเรียนและรายชื่อนักเรียน", text: primaryRooms.length ? `พบ ${primaryRooms.length} ห้อง (ป.1–ป.6) นักเรียน ${primaryRooms.reduce((a, r) => a + r.students, 0)} คน จากระบบบริหารโรงเรียน` : "ยังไม่มีนักเรียนลงทะเบียนในปีนี้ ให้จัดชั้นเรียนในระบบบริหารโรงเรียนก่อน", action: "" },
    { done: subjects.length > 0, title: "รายวิชาของแต่ละชั้น", text: subjects.length ? `มี ${subjects.length} รายวิชา` : "สร้างรายวิชาพื้นฐาน 9 วิชาของ ป.1–ป.6 ได้ในคลิกเดียว แล้วค่อยแก้เวลาเรียน/เพิ่มวิชาเพิ่มเติม", action: `<button class="btn ${subjects.length ? "" : "primary"}" id="tplBtn">สร้างรายวิชาพื้นฐาน</button>` },
    { done: courses.length > 0, title: "รายวิชาของแต่ละห้อง", text: courses.length ? `มี ${courses.length} รายวิชา-ห้อง` : "จับคู่รายวิชากับทุกห้องเรียนของชั้นนั้น", action: `<button class="btn ${subjects.length && !courses.length ? "primary" : ""}" id="genBtn" ${subjects.length ? "" : "disabled"}>สร้าง/เติมรายวิชาทุกห้อง</button>` },
    { done: courses.length > 0 && noTeacher === 0, title: "มอบหมายครูผู้สอน", text: courses.length ? (noTeacher ? `ยังไม่มีครูผู้สอน ${noTeacher} รายวิชา` : "ครบทุกรายวิชา") : "ทำหลังขั้นตอนที่ 3", action: `<button class="btn" data-go="courses">ไปมอบหมาย</button>` },
    { done: hr.rooms.length > 0 && noHomeroom === 0, title: "ครูประจำชั้น", text: noHomeroom ? `ยังไม่กำหนด ${noHomeroom} ห้อง` : "ครบทุกห้อง", action: `<button class="btn" data-go="homerooms">ไปกำหนด</button>` },
  ];
  view.innerHTML = `<div class="panel"><ol style="margin:0;padding:0;list-style:none;display:grid;gap:4px">${steps.map((s, i) => `
    <li style="display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line-soft)">
      <span class="grade ${s.done ? "g4" : ""}" style="min-width:30px">${s.done ? "✓" : i + 1}</span>
      <span><b>${s.title}</b><br><span class="muted small">${s.text}</span></span>${s.action}</li>`).join("")}</ol></div>
    <p class="muted small" style="margin-top:12px">ทำซ้ำได้ปลอดภัย: ปุ่มสร้างจะเพิ่มเฉพาะส่วนที่ยังไม่มี ไม่ลบหรือเขียนทับของเดิม</p>`;
  document.getElementById("tplBtn").onclick = async () => {
    if (!(await confirmBox("สร้างรายวิชาพื้นฐาน", "สร้าง 9 รายวิชาพื้นฐานของ ป.1–ป.6 ตามโครงสร้างเวลาเรียนหลักสูตรแกนกลางฯ 2551 (วิชาที่มีรหัสซ้ำจะข้าม) — หลังสร้างแล้วโปรดตรวจเวลาเรียนให้ตรงหลักสูตรสถานศึกษา", "สร้าง"))) return;
    try { await api("/api/admin/subjects/template", { method: "POST", body: { year: Y } }); toast("สร้างรายวิชาแล้ว"); render(); } catch (err) { showError(err); }
  };
  document.getElementById("genBtn").onclick = async () => {
    try { const r = await api("/api/admin/courses/generate", { method: "POST", body: { year: Y } }); toast(`เพิ่ม ${r.created} รายวิชา-ห้อง`); render(); } catch (err) { showError(err); }
  };
  for (const b of view.querySelectorAll("[data-go]")) b.onclick = () => { tab = b.dataset.go; renderTabs(); render(); };
}

// ---------- รายวิชา ----------
async function renderSubjects() {
  const { subjects, learning_areas } = await api(`/api/admin/subjects?${yq}`);
  view.innerHTML = `<div class="panel">
    <div class="panel-head"><h2>รายวิชาปีการศึกษา ${me.year.year_be}</h2><button class="btn primary" id="addSub">เพิ่มรายวิชา</button></div>
    ${GRADES.map((g) => { const list = subjects.filter((s) => s.grade_level === g); return list.length ? `
      <h3 style="margin-top:18px">${g}</h3>
      <div class="table-wrap"><table class="list"><thead><tr><th>รหัส</th><th>ชื่อวิชา</th><th>กลุ่มสาระ</th><th>ประเภท</th><th class="num">ชม./ปี</th><th class="num">เก็บ:สอบ</th><th class="num">ห้อง</th><th></th></tr></thead>
      <tbody>${list.map((s) => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td class="small">${esc(s.learning_area)}</td><td>${s.subject_type === "basic" ? "พื้นฐาน" : "เพิ่มเติม"}</td>
        <td class="num">${s.hours_per_year}</td><td class="num">${s.collect_ratio}:${100 - s.collect_ratio}</td><td class="num">${s.course_count}</td>
        <td class="actions"><button class="btn small" data-edit="${s.id}">แก้ไข</button><button class="btn small danger" data-del="${s.id}">ลบ</button></td></tr>`).join("")}</tbody></table></div>` : ""; }).join("") || `<div class="empty"><strong>ยังไม่มีรายวิชา</strong>เริ่มจากแท็บ "เริ่มต้นปีการศึกษา" หรือกดเพิ่มรายวิชา</div>`}
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
    <label class="field">คะแนนเก็บ (%)<input name="collect_ratio" inputmode="numeric" required value="${s.collect_ratio ?? 70}"></label>
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
  for (const b of view.querySelectorAll("[data-del]")) b.onclick = async () => {
    const s = subjects.find((x) => x.id === Number(b.dataset.del));
    if (!(await confirmBox("ลบรายวิชา", `ลบ ${esc(s.code)} ${esc(s.name)} ของ ${esc(s.grade_level)} และรายวิชาของทุกห้อง (ลบได้เฉพาะเมื่อยังไม่มีคะแนน)`, "ลบ", true))) return;
    try { await api(`/api/admin/subjects/${s.id}`, { method: "DELETE" }); toast("ลบแล้ว"); render(); } catch (err) { showError(err); }
  };
}

// ---------- ครูผู้สอน ----------
let selRoom = sessionStorage.getItem("sr-admin-room") || "";
async function renderCourses() {
  const [{ courses }, list] = await Promise.all([api(`/api/admin/courses?${yq}`), teachers()]);
  const rooms = [...new Set(courses.map((c) => `${c.grade_level}/${c.classroom}`))];
  if (!rooms.length) { view.innerHTML = `<div class="panel empty"><strong>ยังไม่มีรายวิชาของห้องเรียน</strong>ทำขั้นตอนในแท็บ "เริ่มต้นปีการศึกษา" ก่อน</div>`; return; }
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
      <td>${c.locked ? '<span class="tag ok">ยืนยันผลแล้ว</span>' : c.item_count ? '<span class="tag">กำลังกรอก</span>' : '<span class="tag warn">ยังไม่ตั้งโครงสร้าง</span>'}</td>
      <td class="actions"><button class="btn small" data-teach="${c.id}">ครูผู้สอน</button>${c.locked ? `<button class="btn small" data-unlock="${c.id}">ปลดล็อก</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
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
    if (!(await confirmBox("ปลดล็อก", "ให้ครูผู้สอนแก้ไขคะแนนรายวิชานี้ได้อีกครั้ง", "ปลดล็อก"))) return;
    try { await api(`/api/admin/courses/${b.dataset.unlock}/lock`, { method: "POST", body: { locked: false } }); toast("ปลดล็อกแล้ว"); render(); } catch (err) { showError(err); }
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
    <div class="panel-head"><h2>ครูประจำชั้น</h2><button class="btn" id="importHr">ดึงจากหน้าวิเคราะห์ผู้เรียน (ระบบบริหารฯ)</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>ห้อง</th><th class="num">นักเรียน</th><th>ครูประจำชั้น</th><th></th></tr></thead>
    <tbody>${rooms.map((r, i) => `<tr><td><a href="/homeroom.html?grade=${encodeURIComponent(r.grade_level)}&room=${encodeURIComponent(r.classroom)}&year=${Y}">${esc(r.grade_level)}/${esc(r.classroom)}</a></td><td class="num">${r.students}</td>
      <td>${r.teachers.length ? r.teachers.map((t) => esc(t.full_name)).join(", ") : '<span class="tag warn">ยังไม่กำหนด</span>'}</td>
      <td><button class="btn small" data-i="${i}">กำหนด</button></td></tr>`).join("")}</tbody></table></div></div>`;
  document.getElementById("importHr").onclick = async () => {
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
      <label class="field">คะแนนเก็บเริ่มต้นของวิชาใหม่ (%)<input name="collect_ratio" inputmode="numeric" value="${s.collect_ratio}" required></label>
      <label class="field">เกณฑ์ผ่านตัวชี้วัด (%)<input name="indicator_pass_pct" inputmode="numeric" value="${s.indicator_pass_pct}" required></label>
      <label class="field">เกณฑ์เวลาเรียน (%)<input name="attendance_pass_pct" inputmode="numeric" value="${s.attendance_pass_pct}" required></label>
    </div>
    <label class="field" style="margin-top:14px;max-width:420px">การเรียงเลขที่ในห้อง<select name="roster_order">
      <option value="gender" ${s.roster_order !== "code" ? "selected" : ""}>ชายก่อนหญิง แล้วเรียงตามเลขประจำตัว</option>
      <option value="code" ${s.roster_order === "code" ? "selected" : ""}>เรียงตามเลขประจำตัวอย่างเดียว</option></select></label>
    <p class="muted small">ต้องตรงกับรายชื่อที่ครูใช้ใน Excel เพราะการวางคะแนนจะลงตามลำดับเลขที่</p>
    <label class="check" style="margin-top:14px"><input type="checkbox" name="entry_open" ${s.entry_open ? "checked" : ""}> เปิดให้ครูกรอก/แก้ไขคะแนน</label>
    <h2 style="margin-top:24px">ข้อมูลบนเอกสาร</h2>
    <div class="form-grid">
      <label class="field">ชื่อโรงเรียน<input name="school_name" value="${esc(s.school_name)}" maxlength="120"></label>
      <label class="field">สังกัด / เขตพื้นที่<input name="school_area" value="${esc(s.school_area)}" maxlength="160" placeholder="สำนักงานเขตพื้นที่การศึกษาประถมศึกษา…"></label>
      <label class="field">ผู้อำนวยการ<input name="director_name" value="${esc(s.director_name)}" maxlength="120"></label>
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
  view.innerHTML = `<div class="panel"><div class="panel-head"><h2>ผู้ดูแลงานวัดผล</h2></div>
    <p class="muted small">ผู้บริหารและผู้ดูแลระบบมีสิทธิ์อยู่แล้ว เพิ่มสิทธิ์ให้ครูฝ่ายวิชาการ/วัดผลที่ต้องตั้งค่ารายวิชา ดูรายงาน และปลดล็อกได้ที่นี่</p>
    <div class="table-wrap"><table class="list"><thead><tr><th>ชื่อ</th><th>บทบาทในระบบบริหารฯ</th><th>ผู้ดูแลงานวัดผล</th></tr></thead>
    <tbody>${list.map((t) => { const built = ["superadmin", "executive"].includes(t.role); return `<tr><td>${esc(t.full_name)}</td><td class="small muted">${esc(t.role)}</td>
      <td>${built ? '<span class="tag ok">มีสิทธิ์อยู่แล้ว</span>' : `<label class="check"><input type="checkbox" data-u="${t.id}" ${t.grade_role ? "checked" : ""}> ให้สิทธิ์</label>`}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  for (const c of view.querySelectorAll("[data-u]")) c.onchange = async () => {
    try { await api("/api/admin/staff-roles", { method: "PUT", body: { user_id: Number(c.dataset.u), grant: c.checked } }); toast(c.checked ? "ให้สิทธิ์แล้ว" : "ยกเลิกสิทธิ์แล้ว"); } catch (err) { c.checked = !c.checked; showError(err); }
  };
}

renderTabs();
render();
