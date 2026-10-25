// คลังเอกสาร: ที่เดียวสำหรับพิมพ์/ส่งออกเอกสารทุกชนิด (ปพ.5 ปพ.6 ปพ.1 หนังสือแจ้งผู้ปกครอง สรุปผล Excel CSV)
import { shell, api, esc, showError, ICONS, params, TERM_LABEL } from "/js/app.js";
import { exportRoomsExcel, exportRoomCsv } from "/js/export.js";

const me = await shell("docs");
const view = document.getElementById("view");
document.getElementById("main").hidden = false;
const Y = me.year.id;
// เอกสารของภาคเรียนที่เลือก: ภาค 1 = ข้อมูลภาค 1 · ภาค 2 = ภาค 2 พร้อมสรุปภาค 1 และผลทั้งปี
const T = me.term;
document.getElementById("yearLine").textContent = `${TERM_LABEL[T]} ปีการศึกษา ${me.year.year_be} · เอกสารทุกฉบับสร้างจากข้อมูลล่าสุดทุกครั้งที่กด · เปิดแล้วกด "พิมพ์ / บันทึกเป็น PDF"`;

let data;
try { data = await api(`/api/reports/docs?year=${Y}${me.role === "teacher" ? "&scope=mine" : ""}`); }
catch (err) { view.innerHTML = `<div class="panel empty"><strong>โหลดไม่สำเร็จ</strong>${esc(err.message)}</div>`; throw err; }

const enc = encodeURIComponent;
const roomQ = (r) => `year=${Y}&grade=${enc(r.grade_level)}&room=${enc(r.classroom)}&term=${T}`;
const STATUS = { approved: '<span class="tag ok">อนุมัติแล้ว</span>', reviewed: '<span class="tag">รอผู้บริหาร</span>', submitted: '<span class="tag">รอตรวจ</span>', draft: '<span class="tag warn">ร่าง</span>' };
const link = (href, label, cls = "") => `<a class="btn small ${cls}" target="_blank" rel="noopener" href="${href}">${ICONS.print} ${label}</a>`;
const want = params().get("room"); // ?room=ป.4/2 เลื่อนไปห้องนั้น

const grades = [...new Set(data.rooms.map((r) => r.grade_level))];
view.innerHTML = `
  ${T === 1 ? `<div class="note" style="margin-bottom:12px">เอกสาร<b>ภาคเรียนที่ 1</b>: ปพ.5 (ข้อมูลภาค 1) ปพ.6 (คะแนนภาค 1) และบันทึกของภาค 1 · ผลการเรียนทั้งปี ปพ.1 สรุปผลสัมฤทธิ์ และไฟล์ Excel/CSV ของผลการเรียน อยู่ที่ภาคเรียนที่ 2</div>` : ""}
  ${data.school && T === 2 ? `<div class="panel">
    <div class="panel-head"><h2>เอกสารทั้งโรงเรียน</h2></div>
    <div class="doc-grid">
      <div class="doc-item"><b>รายงานสรุปผลสัมฤทธิ์</b><span class="muted small">ทุกชั้น ทุกวิชา จำนวนนักเรียนตามระดับผลการเรียน</span>${link(`/print/summary.html?year=${Y}`, "พิมพ์")}</div>
      <div class="doc-item"><b>ผลการเรียนทุกห้อง (Excel)</b><span class="muted small">1 แผ่นงานต่อห้อง</span><button class="btn small" id="allXlsx">${ICONS.download} ดาวน์โหลด</button></div>
    </div></div>` : ""}
  ${data.rooms.length ? `<div class="actions" style="margin:4px 0 12px">
      <input type="search" id="q" placeholder="ค้นหาห้องหรือวิชา" style="max-width:260px">
      ${grades.length > 1 ? grades.map((g) => `<button class="btn small" data-g="${esc(g)}">${esc(g)}</button>`).join("") + '<button class="btn small primary" data-g="">ทุกชั้น</button>' : ""}
    </div>` : ""}
  <div id="rooms">${data.rooms.map((r, i) => `<div class="panel room-docs" data-i="${i}" data-grade="${esc(r.grade_level)}" data-text="${esc(`${r.grade_level}/${r.classroom} ${r.courses.map((c) => `${c.code} ${c.name}`).join(" ")}`)}" id="room-${esc(r.grade_level)}-${esc(r.classroom)}">
    <div class="panel-head"><h2>${esc(r.grade_level)}/${esc(r.classroom)} <span class="muted small">${r.students} คน</span></h2>
      ${r.full ? '' : '<span class="tag">เฉพาะวิชาที่สอน</span>'}</div>
    <div class="doc-grid">${r.kinder ? `
      <div class="doc-item"><b>หนังสือแจ้งผู้ปกครอง (บค.)</b><span class="muted small">เฉพาะนักเรียนที่ครูประจำชั้นบันทึกวันขาด/ลาใน${TERM_LABEL[T]}</span><button class="btn small" data-letters="${i}">แสดงรายชื่อ</button><div class="letters" id="letters-${i}"></div></div>
      <div class="doc-item"><b>น้ำหนัก ส่วนสูง และภาวะโภชนาการ</b><span class="muted small">${T === 1 ? "ครั้งที่ 1–2 (ภาค 1)" : "ครั้งที่ 1–4 (ภาค 1 และ 2)"} · ภาวะโภชนาการตามเกณฑ์กรมอนามัย · สรุปจำนวนและรายชื่อที่ควรติดตาม</span>${link(`/print/body.html?${roomQ(r)}`, "พิมพ์")}</div>
      <div class="doc-item"><b>สมุดรายงานพัฒนาการเด็กปฐมวัย</b><span class="muted small">${T === 1 ? "รายคน · ผลประเมินพัฒนาการ 4 ด้าน และความคิดเห็นครู ภาคเรียนที่ 1" : "รายคน · ผลประเมินพัฒนาการ 4 ด้าน ภาค 1–2 ความคิดเห็นครู และสรุปสิ้นปี"}</span>
        <div class="actions">${link(`/print/kinder.html?${roomQ(r)}`, "รายงานพัฒนาการทั้งห้อง", "primary")}${link(`/print/kinder.html?${roomQ(r)}&mode=room`, "สรุปผลทั้งห้อง")}</div></div>` : `
      <div class="doc-item wide"><b>ปพ.5 แบบบันทึกผลการพัฒนาคุณภาพผู้เรียน</b>
        <span class="muted small">${T === 1 ? "ภาคเรียนที่ 1: ปก (สรุปคะแนนภาค 1) → โครงสร้างรายวิชาภาค 1 → เวลาเรียนภาค 1 → ตัวชี้วัดภาค 1 → สรุปผลภาค 1"
          : "ทั้งปี: ปก → โครงสร้างรายวิชา → เวลาเรียน (ภาค 1, 2) → อ่านคิดฯ → คุณลักษณะ → ตัวชี้วัด ภาค 1–2 → สรุปผลรายภาค → สรุปผลทั้งปี · ยังไม่อนุมัติ = มีลายน้ำฉบับร่าง"}</span>
        <div class="actions">${r.full && r.courses.some((c) => c.item_count) ? link(`/print/pp5.html?${roomQ(r)}`, "ทุกวิชาของห้อง (ไฟล์เดียว)", "primary") : ""}
          ${r.courses.map((c) => c.item_count ? `<a class="btn small" target="_blank" rel="noopener" href="/print/pp5.html?course=${c.id}&term=${T}">${esc(c.code)} ${esc(c.name)} ${STATUS[c.status] || ""}</a>`
            : `<span class="btn small" aria-disabled="true" title="ยังไม่ได้ตั้งโครงสร้างคะแนน" style="opacity:.5">${esc(c.code)} ${esc(c.name)}</span>`).join("") || '<span class="muted small">ยังไม่มีรายวิชา</span>'}</div></div>
      ${r.full ? `
      <div class="doc-item"><b>ปพ.6 แบบรายงานผลการพัฒนาคุณภาพผู้เรียน ${TERM_LABEL[T]}</b><span class="muted small">รายคน เรียงตามเลขที่ ทั้งห้อง${T === 2 ? " · คะแนนภาค 1 + ภาค 2 และผลการเรียนทั้งปี" : " · คะแนนภาค 1 (ยังไม่ตัดเกรด)"}</span>${link(`/print/pp6.html?${roomQ(r)}`, `ปพ.6 ภาค ${T} ทั้งห้อง`)}</div>
      ${r.grade_level === "ป.6" && T === 2 ? `<div class="doc-item"><b>ปพ.1 (ฉบับตรวจทาน)</b><span class="muted small">ระเบียนแสดงผลการเรียน ป.6</span>${link(`/print/pp1.html?${roomQ(r)}`, "ปพ.1 ทั้งห้อง")}</div>` : ""}
      <div class="doc-item"><b>หนังสือแจ้งผู้ปกครอง (บค.)</b><span class="muted small">เฉพาะนักเรียนที่ครูประจำชั้นบันทึกวันขาด/ลาใน${TERM_LABEL[T]}</span><button class="btn small" data-letters="${i}">แสดงรายชื่อ</button><div class="letters" id="letters-${i}"></div></div>
      <div class="doc-item"><b>น้ำหนัก ส่วนสูง และภาวะโภชนาการ</b><span class="muted small">${T === 1 ? "ครั้งที่ 1–2 (ภาค 1)" : "ครั้งที่ 1–4 (ภาค 1 และ 2)"} · ภาวะโภชนาการตามเกณฑ์กรมอนามัย · สรุปจำนวนและรายชื่อที่ควรติดตาม</span>${link(`/print/body.html?${roomQ(r)}`, "พิมพ์")}</div>
      ${T === 2 ? `<div class="doc-item"><b>ผลการเรียนของห้อง (ทั้งปี)</b><span class="muted small">Excel ตารางสรุป · CSV 1 แถวต่อ 1 วิชา (สำหรับนำเข้าระบบอื่น)</span>
        <div class="actions"><button class="btn small" data-x="${i}">${ICONS.download} Excel</button><button class="btn small" data-c="${i}">${ICONS.download} CSV</button></div></div>` : ""}` : ""}`}
    </div></div>`).join("") || `<div class="panel empty"><strong>ยังไม่มีเอกสาร</strong>เมื่อได้รับมอบหมายรายวิชาหรือเป็นครูประจำชั้น เอกสารของห้องจะขึ้นที่นี่</div>`}</div>`;

const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { showError(err); } btn.disabled = false; };
const all = document.getElementById("allXlsx");
if (all) all.onclick = () => busy(all, () => exportRoomsExcel(Y, data.rooms.filter((r) => r.full && !r.kinder), `ผลการเรียน_${me.year.year_be}_ทุกห้อง.xlsx`));
for (const b of view.querySelectorAll("[data-x]")) b.onclick = () => { const r = data.rooms[Number(b.dataset.x)]; busy(b, () => exportRoomsExcel(Y, [r], `ผลการเรียน_${me.year.year_be}_${r.grade_level}-${r.classroom}.xlsx`)); };
for (const b of view.querySelectorAll("[data-c]")) b.onclick = () => { const r = data.rooms[Number(b.dataset.c)]; busy(b, () => exportRoomCsv(Y, r.grade_level, r.classroom)); };
for (const b of view.querySelectorAll("[data-letters]")) b.onclick = () => busy(b, async () => {
  const r = data.rooms[Number(b.dataset.letters)];
  const rep = await api(`/api/reports/room?${roomQ(r)}`);
  // วันขาด/ลา (ข ล ป) ของภาคเรียนที่เลือก
  const off = (s) => { const a = s.attendance?.by_term?.[T] || {}; return (a["ข"] || 0) + (a["ล"] || 0) + (a["ป"] || 0); };
  for (const s of rep.students) s.absent_days = off(s);
  const list = rep.students.filter((s) => s.absent_days > 0);
  document.getElementById(`letters-${b.dataset.letters}`).innerHTML = list.length
    ? `<div class="actions" style="margin-top:6px">${list.map((s) => link(`/print/absence-letter.html?${roomQ(r)}&student=${s.id}`, `${s.number ?? ""} ${esc(s.name)} (${s.absent_days} วัน)`)).join("")}</div>`
    : '<p class="muted small" style="margin:6px 0 0">ยังไม่มีนักเรียนที่บันทึกวันขาด</p>';
  b.hidden = true;
});

// กรองตามชั้น / ค้นหา
let grade = "";
const q = document.getElementById("q");
const filter = () => {
  const t = (q?.value || "").trim();
  for (const el of view.querySelectorAll(".room-docs")) el.hidden = (grade && el.dataset.grade !== grade) || (t && !el.dataset.text.includes(t));
  for (const b of view.querySelectorAll("[data-g]")) b.classList.toggle("primary", b.dataset.g === grade);
};
if (q) q.oninput = filter;
for (const b of view.querySelectorAll("[data-g]")) b.onclick = () => { grade = b.dataset.g; filter(); };
if (want) document.getElementById(`room-${want.replace("/", "-")}`)?.scrollIntoView({ block: "start" });
