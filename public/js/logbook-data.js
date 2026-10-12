// แบบบันทึกประจำวันของครูประจำชั้น — แปลงข้อมูลรายเดือนจาก /api/homeroom/logs เป็นตาราง
// ใช้ร่วมกัน: หน้าบันทึก (logs.js), ส่งออก Excel และหน้าพิมพ์ PDF (/print/logs.html) — ทั้งสามจึงตรงกันเสมอ
// โมดูลนี้ไม่พึ่ง app.js เพื่อให้หน้าพิมพ์ใช้ได้

export const LOG_FORMS = [["milk", "ดื่มนม"], ["brush", "แปรงฟัน"], ["lunch", "อาหารกลางวัน"], ["duty", "เขตรับผิดชอบ"], ["health", "ตรวจสุขภาพ"]];
export const LOG_TITLE = {
  milk: "แบบบันทึกการดื่มนม", brush: "แบบบันทึกการแปรงฟัน", lunch: "แบบบันทึกการรับประทานอาหารกลางวัน",
  duty: "แบบบันทึกการทำเขตรับผิดชอบ", health: "แบบบันทึกการตรวจสุขภาพ",
};
export const LOG_DONE = { milk: "ดื่มนม", brush: "แปรงฟัน", lunch: "รับประทานอาหารกลางวัน", duty: "ทำเขตรับผิดชอบ" };
export const ABS_LABEL = { "ข": "ขาดเรียน", "ล": "ลากิจ", "ป": "ลาป่วย" };
const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const MON_S = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const WD_S = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

export const monthLabel = (m) => { const [y, mm] = m.split("-").map(Number); return `${MONTHS[mm - 1]} ${y + 543}`; };
export const dayShort = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MON_S[m - 1]}`; };
export const dayNum = (iso) => Number(iso.slice(8, 10));
export const weekdayOf = (iso) => WD_S[new Date(`${iso}T00:00:00Z`).getUTCDay()];

// ภาคเรียนของเดือน (ดูจากวันเรียนวันแรกของเดือน หรือวันที่ 15)
export function termOfMonth(d) {
  const probe = d.days?.[0] || `${d.month}-15`;
  return d.terms?.find((t) => probe >= t.start_date && probe <= t.end_date)?.term_number || null;
}
export const headerLine = (d) => `ชั้น ${d.grade}/${d.room} · เดือน${monthLabel(d.month)}${termOfMonth(d) ? ` · ภาคเรียนที่ ${termOfMonth(d)}` : ""} · ปีการศึกษา ${d.year.year_be}`;

const val = (d, sid, type, key) => d.records[sid]?.[type]?.[key] || "";
const isActive = (s) => s.enrollment_status === "enrolled";

// ตารางติ๊กรายวัน: cells = "✓" | "ข" | "ล" | "ป" | "" (null = ไม่ได้อยู่ในห้องแล้ว)
export function dailyModel(d) {
  const T = d.type;
  const rows = d.students.map((s) => {
    const active = isActive(s);
    const cells = d.days.map((day) => {
      if (!active) return null;
      const a = d.absent[s.id]?.[day];
      if (a) return a;
      return val(d, s.id, T, day) === "1" ? "✓" : "";
    });
    const present = active ? cells.filter((c) => c === "✓" || c === "").length : 0;
    const done = cells.filter((c) => c === "✓").length;
    return { id: s.id, number: s.number ?? "", name: s.name, active, cells, done, present };
  });
  const foot = d.days.map((_, i) => {
    const pres = rows.filter((r) => r.active && (r.cells[i] === "✓" || r.cells[i] === ""));
    return { done: pres.filter((r) => r.cells[i] === "✓").length, present: pres.length };
  });
  return { rows, foot };
}

// ตรวจสุขภาพ: 4 สัปดาห์ × เล็บ ฟัน ผม มือ — cells[w][k] = "✓" | "✗" | ""
export function healthModel(d) {
  const items = Object.entries(d.health_items);
  const wk = (w) => `${d.month}-w${w}`;
  const rows = d.students.map((s) => {
    const active = isActive(s);
    const cells = d.weeks.map((w) => items.map(([k]) => {
      if (!active) return null;
      const v = val(d, s.id, k, wk(w.week));
      return v === "ok" ? "✓" : v === "no" ? "✗" : "";
    }));
    const bad = cells.flat().filter((c) => c === "✗").length;
    return { id: s.id, number: s.number ?? "", name: s.name, active, cells, bad };
  });
  // จำนวนคนที่ไม่สะอาด ต่อสัปดาห์ต่อรายการ
  const foot = d.weeks.map((_, wi) => items.map((_, ki) => rows.filter((r) => r.cells[wi]?.[ki] === "✗").length));
  return { items, rows, foot };
}

export const weekRange = (w) => (w.from ? (w.from === w.to ? dayShort(w.from) : `${dayShort(w.from)} – ${dayShort(w.to)}`) : "");

// ตารางสำหรับ Excel: { aoa, merges, cols } — 1 ชีตต่อ 1 เดือน
export function sheetForMonth(d) {
  const title = [`${LOG_TITLE[d.type]} — ${d.school?.name || ""}`];
  const sub = [headerLine(d)];
  const merges = [];
  if (d.type !== "health") {
    const m = dailyModel(d);
    const head1 = ["เลขที่", "ชื่อ–สกุล", ...d.days.map(weekdayOf), "รวม", "มาเรียน"];
    const head2 = ["", "", ...d.days.map(dayNum), "(วัน)", "(วัน)"];
    const body = m.rows.map((r) => [r.number, r.name + (r.active ? "" : " (ย้ายออก)"), ...r.cells.map((c) => c ?? ""), r.active ? r.done : "", r.active ? r.present : ""]);
    const foot = ["", "รวมรายวัน (ติ๊ก/มาเรียน)", ...m.foot.map((f) => `${f.done}/${f.present}`), "", ""];
    const legend = [`✓ = ${LOG_DONE[d.type]} · ข = ขาดเรียน · ล = ลากิจ · ป = ลาป่วย (จากบันทึกการมาเรียน) · วันหยุดไม่แสดง`];
    const width = head1.length;
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: width - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } });
    const aoa = [title, sub, head1, head2, ...body, foot, [], legend];
    if (!d.days.length) aoa.splice(2, aoa.length, ["เดือนนี้ไม่มีวันเรียน"]);
    return { aoa, merges, cols: [{ wch: 6 }, { wch: 28 }, ...d.days.map(() => ({ wch: 4 })), { wch: 6 }, { wch: 7 }] };
  }
  const m = healthModel(d);
  const n = m.items.length;
  const head1 = ["เลขที่", "ชื่อ–สกุล"], head2 = ["", ""];
  d.weeks.forEach((w, wi) => {
    head1.push(`สัปดาห์ที่ ${w.week}${w.from ? ` (${weekRange(w)})` : ""}`, ...Array(n - 1).fill(""));
    head2.push(...m.items.map(([, l]) => l));
    merges.push({ s: { r: 2, c: 2 + wi * n }, e: { r: 2, c: 1 + (wi + 1) * n } });
  });
  head1.push("ไม่สะอาด"); head2.push("(ครั้ง)");
  const body = m.rows.map((r) => [r.number, r.name + (r.active ? "" : " (ย้ายออก)"), ...r.cells.flatMap((w) => w.map((c) => c ?? "")), r.active ? r.bad : ""]);
  const foot = ["", "จำนวนคนที่ไม่สะอาด", ...m.foot.flat(), ""];
  const width = head1.length;
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: width - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } });
  return {
    aoa: [title, sub, head1, head2, ...body, foot, [], ["✓ = สะอาด · ✗ = ไม่สะอาด · ตรวจสัปดาห์ละครั้ง เดือนละ 4 สัปดาห์"]],
    merges, cols: [{ wch: 6 }, { wch: 28 }, ...Array(d.weeks.length * n).fill({ wch: 5 }), { wch: 8 }],
  };
}
