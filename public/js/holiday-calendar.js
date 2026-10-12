// ปฏิทินวันหยุดของโรงเรียน — หน้าปฏิทินรายเดือน ใช้ร่วมกัน: ฝ่ายวัดผลแก้ไขได้ (admin.html#calendar) · ครูประจำชั้นดูอย่างเดียว (calendar.html)
import { api, esc, toast, showError, dialog, confirmBox } from "/js/app.js";

// ---------- ปฏิทินวันหยุด: หน้าปฏิทินรายเดือนแบบปฏิทินแขวน — ใช้ซ่อนวันหยุดในตารางมาเรียนและคิดร้อยละการมาเรียน / มส ----------
// แตะวันแรก แล้วแตะวันสุดท้าย (หรือลากด้วยเมาส์) เพื่อเลือกช่วง → ตั้งชื่อ → บันทึก · แตะวันหยุดเพื่อแก้ชื่อ/ลบ
const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_MON_S = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_WD = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const TH_WD_S = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const HOLIDAY_PRESETS = ["วันปิยมหาราช", "วันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ", "วันรัฐธรรมนูญ", "วันสิ้นปี", "วันขึ้นปีใหม่", "วันมาฆบูชา", "วันจักรี",
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
  const hol = new Map(c.holidays.map((h) => [h.holiday_date, h.name]));
  // รวมวันหยุดชื่อเดียวกันที่ต่อกันจริง (ข้ามเสาร์–อาทิตย์ได้) เป็นช่วงเดียว
  const groups = [];
  for (const h of c.holidays) {
    const g = groups.at(-1);
    let next = g && addDays(g.to, 1);
    while (next && [0, 6].includes(wdOf(next))) next = addDays(next, 1);
    if (g && g.name === h.name && next === h.holiday_date) { g.to = h.holiday_date; g.dates.push(h.holiday_date); }
    else groups.push({ name: h.name, from: h.holiday_date, to: h.holiday_date, dates: [h.holiday_date] });
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
        <span><i class="lg hol"></i>วันหยุด</span>${canEdit ? '<span><i class="lg sel"></i>กำลังเลือก</span>' : ""}<span><i class="lg off"></i>ปิดภาคเรียน</span><span><i class="lg wkd"></i>เสาร์–อาทิตย์</span>
      </div>
      ${canEdit ? "" : `<p class="muted small cal-hint">ดูอย่างเดียว · วันหยุดกำหนดโดยฝ่ายวัดผล วันที่เป็นวันหยุดจะไม่แสดงในตารางบันทึกการมาเรียนและแบบบันทึกประจำวัน</p>`}
      <p class="muted small cal-hint"${canEdit ? "" : " hidden"}>แตะวันแรก แล้วแตะวันสุดท้ายเพื่อเลือกช่วงวันหยุด (ใช้เมาส์ลากได้) · แตะวันหยุดเพื่อแก้ชื่อหรือลบ · นับเฉพาะวันจันทร์–ศุกร์ · ถ้าครูเคยบันทึกขาด/ลาไว้ในวันนั้น ระบบจะล้างให้</p>
    </div>
    <div class="cal-bar" id="calBar" hidden${canEdit ? "" : ' data-readonly'}>
      <div class="cal-bar-in">
        <div class="cal-bar-info"><strong id="calSelText"></strong><span id="calSelSub" class="muted small"></span></div>
        <input id="calName" list="calNames" maxlength="120" placeholder="ชื่อวันหยุด เช่น วันปิยมหาราช" autocomplete="off">
        <datalist id="calNames">${holidayNames.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <button class="btn primary" id="calSave">บันทึกวันหยุด</button>
        <button class="btn ghost" id="calCancel">ยกเลิก</button>
      </div>
    </div>
    <div class="panel"><div class="panel-head"><h2>วันหยุดทั้งปี</h2><span class="muted small">${groups.length} รายการ · แตะเพื่อไปที่เดือนนั้น</span></div>
      <div class="cal-list">${groups.map((g, i) => `<button class="cal-item" data-go="${i}"><span class="cal-item-date">${thRange(g.from, g.to)}</span><span class="cal-item-name">${esc(g.name)}</span><span class="cal-item-n">${g.dates.length} วัน</span></button>`).join("") || (canEdit ? '<p class="empty">ยังไม่มีวันหยุด — แตะวันที่ในปฏิทินด้านบนเพื่อเริ่ม</p>' : '<p class="empty">ฝ่ายวัดผลยังไม่ได้ตั้งวันหยุด</p>')}</div>
    </div>
    <p class="muted small">วันเปิด–ปิดภาคเรียนแก้ได้ที่ระบบบริหารโรงเรียน (ปีการศึกษา/ภาคเรียน) เพื่อให้ทุกระบบใช้วันเดียวกัน</p>`;

  const grid = document.getElementById("calGrid"), bar = document.getElementById("calBar"), nameIn = document.getElementById("calName");
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
      const other = cm !== m, name = hol.get(iso), term = termOf(iso);
      const cls = ["cal-day", !canEdit && "ro", other && "other", (wd === 0 || wd === 6) && "we", name && "hol", !term && "off", iso === today && "today", inSel(iso) && "sel"].filter(Boolean).join(" ");
      const marks = terms.flatMap((t) => [iso === t.start_date && `<em class="mark open">เปิดภาค ${t.term_number}</em>`, iso === t.end_date && `<em class="mark close">ปิดภาค ${t.term_number}</em>`]).filter(Boolean).join("");
      const label = `${TH_WD[wd]} ${cd} ${TH_MONTHS[cm - 1]}${name ? ` วันหยุด ${name}` : ""}`;
      html += `<${canEdit ? 'button type="button"' : "div"} class="${cls}" data-d="${iso}" aria-label="${esc(label)}"${inSel(iso) ? ' aria-selected="true"' : ""}>
        <span class="num">${cd}</span>${marks}${name ? `<span class="hname">${esc(name)}</span>` : ""}</${canEdit ? "button" : "div"}>`;
    }
    grid.innerHTML = html;
  }

  function drawBar() {
    bar.hidden = !calSel;
    if (!calSel) return;
    const wk = weekdaysIn(calSel.a, calSel.b), existing = wk.filter((d) => hol.has(d)).length;
    document.getElementById("calSelText").textContent = thRange(calSel.a, calSel.b);
    document.getElementById("calSelSub").textContent = !wk.length ? "ช่วงนี้มีแต่เสาร์–อาทิตย์ — เลือกวันจันทร์–ศุกร์"
      : `หยุด ${wk.length} วันทำการ${existing ? ` · ทับวันหยุดเดิม ${existing} วัน (จะเปลี่ยนเป็นชื่อใหม่)` : ""}${calSel.a === calSel.b ? " · แตะอีกวันเพื่อขยายเป็นช่วง" : ""}`;
    document.getElementById("calSave").disabled = !wk.length;
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
  if (!canEdit) { calSel = null; drawMonth(); return; }

  // เลือกช่วง: แตะ/คลิก หรือลากด้วยเมาส์
  let drag = null;
  const setSel = (a, b) => { calSel = a <= b ? { a, b } : { a: b, b: a }; redraw(); };
  async function openHoliday(iso) {
    const g = groupOf(iso);
    let act = "";
    const r = await dialog({
      title: "วันหยุด",
      body: `<p class="muted" style="margin-top:0">${thRange(g.from, g.to)} · ${g.dates.length} วันทำการ</p>
        <label class="field">ชื่อวันหยุด<input name="name" list="calNames" value="${esc(g.name)}" required maxlength="120"></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button type="button" class="btn danger small" data-act="all">ลบทั้งช่วง (${g.dates.length} วัน)</button>
          ${g.dates.length > 1 ? `<button type="button" class="btn small" data-act="one">ลบเฉพาะ ${thDate(iso)}</button>` : ""}
        </div>`,
      okText: "บันทึกชื่อ",
      onOpen: (d) => { for (const b of d.querySelectorAll("[data-act]")) b.onclick = () => { act = b.dataset.act; d.close(); }; },
    });
    try {
      if (act) {
        const dates = act === "all" ? g.dates : [iso];
        if (act === "all" && !(await confirmBox("ลบวันหยุด", `ลบ "${esc(g.name)}" ${g.dates.length} วัน`, "ลบ", true))) return;
        for (const d of dates) await api(`/api/calendar/${d}?${yq}`, { method: "DELETE" });
        toast(`ลบวันหยุด ${dates.length} วัน`); return render();
      }
      if (r.ok && r.data.name.trim() && r.data.name.trim() !== g.name) {
        await api(`/api/calendar?${yq}`, { method: "POST", body: { from: g.from, to: g.to, name: r.data.name.trim() } });
        toast("แก้ชื่อแล้ว"); render();
      }
    } catch (err) { showError(err); }
  }
  grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest("[data-d]");
    if (!cell || e.pointerType !== "mouse" || e.button !== 0 || hol.has(cell.dataset.d)) return;
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
    if (hol.has(iso) && !calSel) return openHoliday(iso);
    if (calSel && calSel.a === calSel.b && iso !== calSel.a) setSel(calSel.a, iso);
    else if (calSel && calSel.a === iso && calSel.b === iso) { calSel = null; redraw(); }
    else setSel(iso, iso);
    if (iso.slice(0, 7) !== calMonth) { calMonth = iso.slice(0, 7); redraw(); }
    if (matchMedia("(pointer: fine)").matches) nameIn.focus();
  });
  document.getElementById("calCancel").onclick = () => { calSel = null; redraw(); };
  const save = async () => {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return toast("กรอกชื่อวันหยุด", "bad"); }
    try { const r = await api(`/api/calendar?${yq}`, { method: "POST", body: { from: calSel.a, to: calSel.b, name } }); toast(`เพิ่มวันหยุด ${r.added} วัน`); calSel = null; render(); } catch (err) { showError(err); }
  };
  document.getElementById("calSave").onclick = save;
  nameIn.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { calSel = null; redraw(); } };
  redraw();
}

