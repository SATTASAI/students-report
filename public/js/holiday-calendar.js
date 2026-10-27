// ปฏิทินวันหยุดของโรงเรียน — หน้าปฏิทินรายเดือน ใช้ร่วมกัน: ฝ่ายวัดผลแก้ไขได้ (admin.html#calendar) · ครูประจำชั้นดูอย่างเดียว (calendar.html)
import { api, esc, toast, showError, dialog, confirmBox } from "/js/app.js";

// ---------- ปฏิทินวันหยุด: หน้าปฏิทินรายเดือนแบบปฏิทินแขวน — ใช้ซ่อนวันหยุดในตารางมาเรียนและคิดร้อยละการมาเรียน / มส ----------
// แตะวันแรก แล้วแตะวันสุดท้าย (หรือลากด้วยเมาส์) เพื่อเลือกช่วง → ตั้งชื่อ → บันทึก · แตะวันหยุดเพื่อแก้ชื่อ/ลบ
const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_MON_S = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_WD = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const TH_WD_S = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const HOLIDAY_PRESETS = ["วันพืชมงคล", "วันครู (ตามประกาศโรงเรียน)", "วันปิยมหาราช", "วันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ", "วันรัฐธรรมนูญ", "วันสิ้นปี", "วันขึ้นปีใหม่", "วันมาฆบูชา", "วันจักรี",
  "วันสงกรานต์", "วันแรงงานแห่งชาติ", "วันฉัตรมงคล", "วันวิสาขบูชา", "วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี", "วันอาสาฬหบูชา", "วันเข้าพรรษา",
  "วันเฉลิมพระชนมพรรษา ร.10", "วันแม่แห่งชาติ", "วันนวมินทรมหาราช", "วันหยุดชดเชย", "วันหยุดพิเศษตามประกาศรัฐบาล", "กิจกรรมโรงเรียน (งดการเรียนการสอน)"];
const isoOf = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wdOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const thDate = (iso, wd = true) => { const [y, m, d] = iso.split("-").map(Number); return `${wd ? TH_WD_S[wdOf(iso)] + " " : ""}${d} ${TH_MON_S[m - 1]} ${String(y + 543).slice(-2)}`; };
const thRange = (a, b) => (a === b ? thDate(a) : `${thDate(a)} – ${thDate(b)}`);
const weekdaysIn = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) { const w = wdOf(d); if (w && w !== 6) out.push(d); } return out; };
const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
let calMonth = sessionStorage.getItem("sr-cal-month") || "";
let calAbort = null;
let calSel = null; // { a, b } ช่วงที่กำลังเลือก (a ≤ b)

export async function renderHolidayCalendar(view, yq, render) {
  const c = await api(`/api/calendar?${yq}`);
  const canEdit = !!c.can_edit;
  const types = c.types || [];
  const typeLabel = (value) => types.find((t) => t.value === value)?.label || "วันหยุด";
  const typeOptions = (value) => types.map((t) => `<option value="${t.value}"${t.value === value ? " selected" : ""}>${esc(t.label)}</option>`).join("");
  const events = c.events || [];
  const eventRows = new Map();
  for (const e of events) eventRows.set(e.event_date, [...(eventRows.get(e.event_date) || []), e]);
  const hol = new Map(c.holidays.map((h) => [h.holiday_date, h.name]));
  const govSet = new Set(c.holidays.filter((h) => h.gov).map((h) => h.holiday_date)); // วันหยุดราชการที่ระบบใส่ให้
  const importantDays = c.important_days || [];
  const important = new Map();
  for (const d of importantDays) important.set(d.date, [important.get(d.date), d.name].filter(Boolean).join(" / "));
  for (const e of events) important.set(e.event_date, [important.get(e.event_date), `${typeLabel(e.category)}: ${e.name}`].filter(Boolean).join(" / "));
  // รวมวันหยุดชื่อเดียวกันที่ต่อกันจริง (ข้ามเสาร์–อาทิตย์ได้) เป็นช่วงเดียว
  const groups = [];
  for (const h of c.holidays) {
    const g = groups.at(-1);
    let next = g && addDays(g.to, 1);
    while (next && [0, 6].includes(wdOf(next))) next = addDays(next, 1);
    if (g && ![0, 6].includes(wdOf(g.to)) && ![0, 6].includes(wdOf(h.holiday_date)) && g.name === h.name && g.category === (h.category || "holiday") && g.description === (h.description || "") && !!h.gov === g.gov && next === h.holiday_date) { g.to = h.holiday_date; g.dates.push(h.holiday_date); }
    else groups.push({ name: h.name, from: h.holiday_date, to: h.holiday_date, dates: [h.holiday_date], gov: !!h.gov, category: h.category || "holiday", description: h.description || "" });
  }
  const groupOf = (iso) => groups.find((g) => g.dates.includes(iso));
  const terms = c.terms;
  const termOf = (iso) => terms.find((t) => iso >= t.start_date && iso <= t.end_date);
  const termDays = terms.map((t) => weekdaysIn(t.start_date, t.end_date).filter((d) => !hol.has(d)).length);
  // เดือนในปีการศึกษา (ตั้งแต่เดือนเปิดภาคแรก ถึงเดือนปิดภาคสุดท้าย)
  const months = [];
  if (terms.length) {
    let [y, m] = terms[0].start_date.split("-").map(Number); m -= 1;
    const [ey, em] = terms.at(-1).end_date.split("-").map(Number);
    while (y < ey || (y === ey && m <= em - 1)) { months.push(`${y}-${String(m + 1).padStart(2, "0")}`); if (++m > 11) { m = 0; y++; } }
  }
  const today = todayIso();
  if (!/^\d{4}-\d{2}$/.test(calMonth)) calMonth = months.includes(today.slice(0, 7)) || !months.length ? today.slice(0, 7) : months[0];
  const holidayNames = [...new Set([...HOLIDAY_PRESETS, ...c.holidays.map((h) => h.name)])];

  view.innerHTML = `<div class="cal-summary">
      ${terms.map((t, i) => `<div class="cal-stat"><span>ภาคเรียนที่ ${t.term_number}</span><strong>${termDays[i]}</strong><small>วันเรียน · ${thDate(t.start_date, false)} – ${thDate(t.end_date, false)}</small></div>`).join("")}
      <div class="cal-stat total"><span>รวมทั้งปี</span><strong>${c.school_days}</strong><small>วันเรียน (จ.–ศ. ไม่รวมวันหยุด) · หยุด ${c.holidays.length} วัน</small></div>
    </div>
    <div class="panel cal-panel">
      <div class="cal-top">
        <div class="cal-nav">
          <button class="btn ghost cal-arrow" data-nav="-1" aria-label="เดือนก่อน">‹</button>
          <h2 id="calTitle"></h2>
          <button class="btn ghost cal-arrow" data-nav="1" aria-label="เดือนถัดไป">›</button>
        </div>
        <button class="btn small" data-today>เดือนนี้</button>
      </div>
      ${months.length ? `<div class="cal-months" id="calMonths"></div>` : ""}
      <div class="cal-grid" id="calGrid" role="grid"></div>
      <div class="cal-legend">
        <span><i class="lg hol"></i>วันหยุด (ราชการ / โรงเรียน / เสาร์–อาทิตย์)</span><span><i class="lg important"></i>วันสำคัญที่ไม่ใช่วันหยุด</span>${canEdit ? '<span><i class="lg sel"></i>กำลังเลือก</span>' : ""}<span><i class="lg off"></i>ปิดภาคเรียน</span>
      </div>
      <p class="muted small cal-hint">สีแดง = วันหยุด · สีเหลือง = วันสำคัญที่ยังนับเป็นวันเรียนเมื่ออยู่ในภาคเรียน · หากตรงวันหยุด ช่องวันเป็นสีแดงและแสดงชื่อวันสำคัญประกอบ</p>
      <p class="muted small cal-hint">วันครูแสดงเป็นวันสำคัญ หากโรงเรียนประกาศหยุดให้ฝ่ายวัดผลเพิ่มวันหยุด · วันพืชมงคลและวันหยุดพิเศษต้องเพิ่มตามประกาศทางการของปีนั้น</p>
      <p class="muted small cal-hint">เทศกาลจีนมีวันที่ตรวจสอบแล้วสำหรับ พ.ศ. 2569–2571 · กำหนดจัดงานของแต่ละพื้นที่อาจต่างจากวันเทศกาลในปฏิทิน</p>
      ${canEdit ? "" : `<p class="muted small cal-hint">ดูอย่างเดียว · วันหยุดราชการระบบใส่ให้ทุกปี ส่วนวันหยุดอื่นกำหนดโดยฝ่ายวัดผล วันหยุดแสดงในบันทึกการมาเรียนและบันทึกประจำวัน โดยไม่นับเป็นวันเรียน ส่วนเทศกาลและกิจกรรมที่ไม่หยุดเรียนแสดงเฉพาะปฏิทิน</p>`}
      <p class="muted small cal-hint"${canEdit ? "" : " hidden"}>วันหยุดราชการ (สีแดง) ระบบใส่ให้เองทุกปีการศึกษา รวมวันหยุดชดเชย — ฝ่ายวัดผลเพิ่มเฉพาะวันหยุดอื่น เช่น วันพืชมงคล วันหยุดพิเศษตามประกาศ ครม. กิจกรรมโรงเรียน · แตะวันแรก แล้วแตะวันสุดท้ายเพื่อเลือกช่วง (ใช้เมาส์ลากได้) · เลือกประเภทและกรอกรายละเอียด · แตะรายการเพื่อแก้ไขหรือลบ · เทศกาลและกิจกรรมไม่เปลี่ยนวันเรียนหรือบันทึกเดิม · การตั้งวันหยุดจะล้างบันทึกมาเรียนและบันทึกประจำวันของวันนั้น</p>
    </div>
    <div class="cal-bar" id="calBar" hidden${canEdit ? "" : ' data-readonly'}>
      <div class="cal-bar-in">
        <div class="cal-bar-info"><strong id="calSelText"></strong><span id="calSelSub" class="muted small"></span></div>
        <label class="cal-type">ประเภท<select id="calType" aria-label="ประเภทรายการ">${typeOptions("holiday")}</select></label>
        <input id="calName" list="calNames" maxlength="120" aria-label="ชื่อรายการ" placeholder="ชื่อวันหยุด เทศกาล หรือกิจกรรม" autocomplete="off">
        <datalist id="calNames">${holidayNames.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <textarea id="calDescription" aria-label="รายละเอียดรายการ" maxlength="2000" rows="2" placeholder="รายละเอียด เช่น เวลา สถานที่ ผู้รับผิดชอบ"></textarea>
        <p id="calEffect" class="small cal-effect"></p>
        <button class="btn primary" id="calSave">บันทึกรายการ</button>
        <button class="btn ghost" id="calCancel">ยกเลิก</button>
      </div>
    </div>
    <div class="panel"><div class="panel-head"><h2>วันหยุดทั้งปี</h2><span class="muted small">${groups.length} รายการ · แตะเพื่อไปที่เดือนนั้น</span>
      ${canEdit ? `<button class="btn small" id="calGov" data-tip="ใส่วันหยุดราชการที่ยังไม่มีในปฏิทินกลับเข้าไป (รวมวันที่เคยลบ) ไม่ทับวันที่ตั้งชื่อไว้แล้ว">เติมวันหยุดราชการ</button>` : ""}</div>
      <div class="cal-list">${groups.map((g, i) => `<button class="cal-item${g.gov ? " gov" : ""}" data-go="${i}"><span class="cal-item-date">${thRange(g.from, g.to)}</span><span class="cal-item-name">${esc(g.name)} <em class="gov-tag">${esc(typeLabel(g.category))}</em>${g.description ? `<small class="cal-detail">${esc(g.description)}</small>` : ""}${g.gov ? ' <em class="gov-tag">ราชการ</em>' : ""}</span><span class="cal-item-n">${g.dates.length} วัน</span></button>`).join("") || (canEdit ? '<p class="empty">ยังไม่มีวันหยุด — แตะวันที่ในปฏิทินด้านบนเพื่อเริ่ม</p>' : '<p class="empty">ฝ่ายวัดผลยังไม่ได้ตั้งวันหยุด</p>')}</div>
    </div>
    <div class="panel"><div class="panel-head"><h2>เทศกาลและกิจกรรมโรงเรียน</h2><span class="muted small">แสดงเฉพาะปฏิทิน · ไม่เปลี่ยนวันเรียน</span></div>
      <div class="cal-list">${events.map((e) => `<button class="cal-item important" data-event-id="${e.id}"><span class="cal-item-date">${thDate(e.event_date)}</span><span class="cal-item-name">${esc(e.name)} <em class="gov-tag">${esc(typeLabel(e.category))}</em>${e.description ? `<small class="cal-detail">${esc(e.description)}</small>` : ""}</span><span class="cal-item-n">${canEdit ? "แก้ไข" : "ดูรายการ"}</span></button>`).join("") || '<p class="empty">ยังไม่มีรายการ</p>'}</div>
    </div>
    <div class="panel"><div class="panel-head"><h2>วันสำคัญในปีการศึกษา</h2><span class="muted small">แสดงประกอบปฏิทิน · ไม่เพิ่มวันหยุด</span></div>
      <div class="cal-list">${importantDays.map((d) => {
        const isOff = hol.has(d.date) || [0, 6].includes(wdOf(d.date));
        return `<button class="cal-item${isOff ? "" : " important"}" data-important-date="${d.date}"><span class="cal-item-date">${thDate(d.date)}</span><span class="cal-item-name">${esc(d.name)}</span><span class="cal-item-n">${isOff ? "ตรงวันหยุด" : "วันสำคัญ"}</span></button>`;
      }).join("") || '<p class="empty">ไม่มีวันสำคัญในช่วงปีการศึกษานี้</p>'}</div>
    </div>
    <p class="muted small">วันเปิด–ปิดภาคเรียนแก้ได้ที่ระบบบริหารโรงเรียน (ปีการศึกษา/ภาคเรียน) เพื่อให้ทุกระบบใช้วันเดียวกัน</p>`;

  const grid = document.getElementById("calGrid"), bar = document.getElementById("calBar"), nameIn = document.getElementById("calName"), typeIn = document.getElementById("calType"), descriptionIn = document.getElementById("calDescription");
  const inSel = (iso) => calSel && iso >= calSel.a && iso <= calSel.b;

  function drawMonth() {
    sessionStorage.setItem("sr-cal-month", calMonth);
    const [y, m] = calMonth.split("-").map(Number);
    document.getElementById("calTitle").innerHTML = `${TH_MONTHS[m - 1]} <span>${y + 543}</span>`;
    const mEl = document.getElementById("calMonths");
    if (mEl) mEl.innerHTML = months.map((k) => {
      const [yy, mm] = k.split("-").map(Number), n = c.holidays.filter((h) => h.holiday_date.startsWith(k)).length;
      return `<button class="cal-mchip${k === calMonth ? " on" : ""}" data-month="${k}">${TH_MON_S[mm - 1]}<small>${String(yy + 543).slice(-2)}</small>${n ? `<b>${n}</b>` : ""}</button>`;
    }).join("");
    mEl?.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "center" });
    const first = isoOf(y, m - 1, 1), lead = wdOf(first), dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let html = TH_WD.map((w, i) => `<div class="cal-wd${i === 0 || i === 6 ? " we" : ""}"><span class="full">${w}</span><span class="short">${TH_WD_S[i]}</span></div>`).join("");
    const cells = Math.ceil((lead + dim) / 7) * 7;
    for (let i = 0; i < cells; i++) {
      const iso = addDays(first, i - lead), [, cm, cd] = iso.split("-").map(Number), wd = wdOf(iso);
      const other = cm !== m, name = hol.get(iso), term = termOf(iso), event = important.get(iso), weekend = wd === 0 || wd === 6;
      const cls = ["cal-day", !canEdit && "ro", other && "other", weekend && "we", name && "hol", event && !name && !weekend && "important", govSet.has(iso) && "gov", !term && "off", iso === today && "today", inSel(iso) && "sel"].filter(Boolean).join(" ");
      const marks = terms.flatMap((t) => [iso === t.start_date && `<em class="mark open">เปิดภาค ${t.term_number}</em>`, iso === t.end_date && `<em class="mark close">ปิดภาค ${t.term_number}</em>`]).filter(Boolean).join("");
      const label = `${TH_WD[wd]} ${cd} ${TH_MONTHS[cm - 1]} ${Number(iso.slice(0, 4)) + 543}${name ? ` วันหยุด ${name}` : weekend ? " วันหยุดประจำสัปดาห์" : ""}${event ? ` วันสำคัญ ${event}` : ""}`;
      html += `<${canEdit ? 'button type="button"' : "div"} class="${cls}" data-d="${iso}" title="${esc(label)}" aria-label="${esc(label)}"${inSel(iso) ? ' aria-selected="true"' : ""}>
        <span class="num">${cd}</span>${marks}${name ? `<span class="hname">${esc(name)}</span>` : ""}${event ? `<span class="iname">${esc(event)}</span>` : ""}</${canEdit ? "button" : "div"}>`;
    }
    grid.innerHTML = html;
  }

  function drawBar() {
    bar.hidden = !calSel;
    if (!calSel) return;
    const isHoliday = types.find((t) => t.value === typeIn.value)?.is_holiday !== false;
    const wk = weekdaysIn(calSel.a, calSel.b);
    const all = []; for (let d = calSel.a; d <= calSel.b; d = addDays(d, 1)) all.push(d);
    const dates = isHoliday && calSel.a !== calSel.b ? wk : all;
    const existing = isHoliday ? dates.filter((d) => hol.has(d)).length : 0;
    document.getElementById("calSelText").textContent = thRange(calSel.a, calSel.b);
    document.getElementById("calSelSub").textContent = `${dates.length} วัน${existing ? ` · จะปรับวันหยุดเดิม ${existing} วัน` : ""}${!isHoliday ? " · รวมเสาร์–อาทิตย์" : ""}`;
    document.getElementById("calEffect").textContent = isHoliday
      ? "วันหยุด: ไม่นับเป็นวันเรียน แสดงในบันทึกประจำวัน บันทึกมาเรียน และ ปพ.5–6 · บันทึกเดิมของวันนั้นจะถูกล้าง"
      : "แสดงเฉพาะปฏิทิน: ไม่เปลี่ยนวันเรียน ไม่ล้างข้อมูล และไม่ขึ้นเป็นรายการพิเศษในบันทึกหรือ ปพ.5–6";
    document.getElementById("calSave").disabled = !dates.length || dates.length > 120;

  }
  const redraw = () => { drawMonth(); drawBar(); };

  view.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => {
    let [y, m] = calMonth.split("-").map(Number); m += Number(b.dataset.nav);
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    calMonth = `${y}-${String(m).padStart(2, "0")}`; drawMonth();
  }));
  view.querySelector("[data-today]").onclick = () => { calMonth = today.slice(0, 7); drawMonth(); };
  document.getElementById("calMonths")?.addEventListener("click", (e) => { const b = e.target.closest("[data-month]"); if (b) { calMonth = b.dataset.month; drawMonth(); } });
  for (const b of view.querySelectorAll("[data-go]")) b.onclick = () => { calMonth = groups[Number(b.dataset.go)].from.slice(0, 7); drawMonth(); view.querySelector(".cal-panel").scrollIntoView({ behavior: "smooth", block: "start" }); };
  for (const b of view.querySelectorAll("[data-important-date]")) b.onclick = () => { calMonth = b.dataset.importantDate.slice(0, 7); drawMonth(); view.querySelector(".cal-panel").scrollIntoView({ behavior: "smooth", block: "start" }); };
  for (const b of view.querySelectorAll("[data-event-id]")) b.onclick = () => {
    const e = events.find((x) => x.id === Number(b.dataset.eventId));
    calMonth = e.event_date.slice(0, 7); drawMonth();
    if (canEdit) openEvent(e).catch(showError);
    else view.querySelector(".cal-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  if (!canEdit) { calSel = null; drawMonth(); return; }
  typeIn.onchange = drawBar;

  // เลือกช่วง: แตะ/คลิก หรือลากด้วยเมาส์
  let drag = null;
  const setSel = (a, b) => { calSel = a <= b ? { a, b } : { a: b, b: a }; redraw(); };
  async function openHoliday(iso) {
    const g = groupOf(iso);
    let act = "";
    const r = await dialog({
      title: "แก้ไขรายการปฏิทิน",
      body: `<p class="muted" style="margin-top:0">${thRange(g.from, g.to)} · ${g.dates.length} วันทำการ</p>
        <label class="field">ประเภท<select name="category">${typeOptions(g.category)}</select></label>
        <label class="field">ชื่อรายการ<input name="name" list="calNames" value="${esc(g.name)}" required maxlength="120"></label>
        <label class="field">รายละเอียด<textarea name="description" maxlength="2000" rows="3">${esc(g.description)}</textarea></label>
        <p class="small muted">ประเภทวันหยุดไม่นับวันเรียน · เทศกาลและกิจกรรมโรงเรียนแสดงเฉพาะปฏิทิน การเปลี่ยนประเภทจะเปลี่ยนผลต่อวันเรียนด้วย</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button type="button" class="btn danger small" data-act="all">ลบทั้งช่วง (${g.dates.length} วัน)</button>
          ${g.dates.length > 1 ? `<button type="button" class="btn small" data-act="one">ลบเฉพาะ ${thDate(iso)}</button>` : ""}
        </div>`,
      okText: "บันทึกการแก้ไข",
      onOpen: (d) => { for (const b of d.querySelectorAll("[data-act]")) b.onclick = () => { act = b.dataset.act; d.close(); }; },
    });
    try {
      if (act) {
        const dates = act === "all" ? g.dates : [iso];
        if (act === "all" && !(await confirmBox("ลบวันหยุด", `ลบ "${esc(g.name)}" ${g.dates.length} วัน`, "ลบ", true))) return;
        for (const d of dates) await api(`/api/calendar/${d}?${yq}`, { method: "DELETE" });
        toast(`ลบวันหยุด ${dates.length} วัน`); return render();
      }
      if (r.ok && r.data.name.trim()) {
        await api(`/api/calendar?${yq}`, { method: "POST", body: { from: g.from, to: g.to, name: r.data.name.trim(), category: r.data.category, description: r.data.description, replace_holiday: true } });
        toast("แก้ไขรายการแล้ว"); render();
      }
    } catch (err) { showError(err); }
  }
  async function openEvent(e) {
    let remove = false;
    const r = await dialog({ title: "แก้ไขรายการปฏิทิน", body: `
      <p>${thDate(e.event_date)}</p>
      <label class="field">ประเภท<select name="category">${typeOptions(e.category)}</select></label>
      <label class="field">ชื่อรายการ<input name="name" value="${esc(e.name)}" required maxlength="120"></label>
      <label class="field">รายละเอียด<textarea name="description" maxlength="2000" rows="3">${esc(e.description || "")}</textarea></label>
      <p class="small muted">หากเปลี่ยนเป็นประเภทวันหยุด วันนั้นจะไม่นับเป็นวันเรียน และล้างบันทึกมาเรียน/บันทึกประจำวันเดิม</p>
      <button type="button" class="btn danger small" data-remove>ลบรายการ</button>`,
      onOpen: (d) => { d.querySelector("[data-remove]").onclick = () => { remove = true; d.close(); }; },
    });
    if (remove) {
      if (!(await confirmBox("ลบรายการ", `ลบ "${esc(e.name)}"`, "ลบ", true))) return;
      await api(`/api/calendar/events/${e.id}?${yq}`, { method: "DELETE" });
    } else if (r.ok) {
      const category = r.data.category;
      if (types.find((t) => t.value === category)?.is_holiday && !(await confirmBox("เปลี่ยนเป็นวันหยุด", "วันนั้นจะไม่นับเป็นวันเรียน และล้างบันทึกมาเรียน/บันทึกประจำวันเดิม", "ยืนยัน"))) return;
      await api(`/api/calendar?${yq}`, { method: "POST", body: { from: e.event_date, name: r.data.name.trim(), category, description: r.data.description, event_id: e.id } });
    } else return;
    calSel = null; toast(remove ? "ลบรายการแล้ว" : "แก้ไขรายการแล้ว"); return render();
  }
  async function openDay(iso) {
    let choice = "";
    const g = groupOf(iso), rows = eventRows.get(iso) || [];
    await dialog({ title: thDate(iso), okText: "", cancelText: "ปิด", body: `
      <div class="cal-day-actions">${g ? `<button type="button" class="btn" data-choice="holiday">${esc(typeLabel(g.category))}: ${esc(g.name)}</button>` : ""}
      ${rows.map((e) => `<button type="button" class="btn" data-choice="${e.id}">${esc(typeLabel(e.category))}: ${esc(e.name)}</button>`).join("")}
      <button type="button" class="btn primary" data-choice="add">เพิ่มรายการในวันนี้</button></div>`,
      onOpen: (d) => { for (const b of d.querySelectorAll("[data-choice]")) b.onclick = () => { choice = b.dataset.choice; d.close(); }; },
    });
    if (choice === "holiday") return openHoliday(iso);
    if (choice === "add") { typeIn.value = "school_activity"; setSel(iso, iso); nameIn.focus(); }
    else if (choice) return openEvent(rows.find((e) => e.id === Number(choice)));
  }
  grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest("[data-d]");
    if (!cell || e.pointerType !== "mouse" || e.button !== 0 || hol.has(cell.dataset.d) || eventRows.has(cell.dataset.d)) return;
    drag = { a: cell.dataset.d, moved: false };
  });
  grid.addEventListener("pointerover", (e) => {
    const cell = e.target.closest("[data-d]");
    if (!drag || !cell || cell.dataset.d === drag.a && !drag.moved) return;
    drag.moved = true; setSel(drag.a, cell.dataset.d);
  });
  calAbort?.abort(); calAbort = new AbortController();
  window.addEventListener("pointerup", () => { if (drag?.moved) { drag.justDragged = true; setTimeout(() => (drag = null), 0); nameIn.focus(); } else drag = null; }, { signal: calAbort.signal });
  grid.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-d]");
    if (!cell || drag?.justDragged) return;
    const iso = cell.dataset.d;
    if ((hol.has(iso) || eventRows.has(iso)) && !calSel) return openDay(iso).catch(showError);
    if (calSel && calSel.a === calSel.b && iso !== calSel.a) setSel(calSel.a, iso);
    else if (calSel && calSel.a === iso && calSel.b === iso) { calSel = null; redraw(); }
    else setSel(iso, iso);
    if (iso.slice(0, 7) !== calMonth) { calMonth = iso.slice(0, 7); redraw(); }
    if (matchMedia("(pointer: fine)").matches) nameIn.focus();
  });
  document.getElementById("calGov").onclick = async () => {
    try { const r = await api(`/api/calendar/government?${yq}`, { method: "POST", body: {} }); toast(r.added ? `เติมวันหยุดราชการ ${r.added} วัน` : "วันหยุดราชการครบแล้ว"); render(); } catch (err) { showError(err); }
  };
  document.getElementById("calCancel").onclick = () => { calSel = null; redraw(); };
  const save = async () => {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return toast("กรอกชื่อรายการ", "bad"); }
    if (!calSel || document.getElementById("calSave").disabled) return;
    const button = document.getElementById("calSave"); button.disabled = true;
    try {
      const r = await api(`/api/calendar?${yq}`, { method: "POST", body: { from: calSel.a, to: calSel.b, name, category: typeIn.value, description: descriptionIn.value.trim() } });
      toast(`บันทึก ${r.added} วัน`); calSel = null; nameIn.value = ""; descriptionIn.value = ""; await render();
    } catch (err) { showError(err); drawBar(); }
  };
  document.getElementById("calSave").onclick = save;
  nameIn.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { calSel = null; redraw(); } };
  redraw();
}

