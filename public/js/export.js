// ส่งออกผลการเรียนเป็น Excel / CSV (สร้างในเบราว์เซอร์ ไม่ส่งข้อมูลออกนอกระบบ)
import { api, toast } from "/js/app.js";
import { ASSESSMENT_GROUPS, summarizeGroup, summaryText } from "/js/grading.js";

let xlsxLoading;
export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxLoading = null; reject(new Error("โหลดตัวสร้างไฟล์ Excel ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่")); };
    document.head.appendChild(s);
  });
  return xlsxLoading;
}

async function roomData(yearId, grade, room) {
  return api(`/api/reports/room?year=${yearId}&grade=${encodeURIComponent(grade)}&room=${encodeURIComponent(room)}`);
}

// ตารางผลการเรียนของห้อง: 1 แถวต่อนักเรียน
export function roomSheetRows(data) {
  const subjects = [];
  for (const s of data.students) for (const g of s.subjects) if (!subjects.some((x) => x.code === g.code)) subjects.push(g);
  const header = ["เลขที่", "เลขประจำตัว", "เลขประจำตัวประชาชน", "ชื่อ–สกุล", ...subjects.map((s) => `${s.code} ${s.name}`), "ผลการเรียนเฉลี่ย",
    ...ASSESSMENT_GROUPS.map((g) => g.title), "วันขาดเรียน (ที่บันทึก)"];
  const rows = data.students.map((st) => {
    const by = Object.fromEntries(st.subjects.map((g) => [g.code, g.grade]));
    return [st.number ?? "", st.student_code, st.national_id || "", st.name, ...subjects.map((s) => by[s.code] ?? ""), st.gpa ?? "",
      ...ASSESSMENT_GROUPS.map((g) => summaryText(g, summarizeGroup(g, st.assessments))), st.absent_days];
  });
  return [header, ...rows];
}

// แบบยาว 1 แถวต่อ 1 วิชา — ใช้เตรียมนำเข้าระบบอื่น (SGS / Q-info) จนกว่าจะได้รูปแบบไฟล์ทางการ
export function longRows(data) {
  const header = ["ปีการศึกษา", "ระดับชั้น", "ห้อง", "เลขประจำตัว", "เลขประจำตัวประชาชน", "ชื่อ–สกุล", "รหัสวิชา", "ชื่อวิชา", "ประเภท", "เวลาเรียน(ชม.)", "คะแนนรวม", "ผลการเรียน", "ผลเดิมก่อนแก้ไข"];
  const rows = [];
  for (const st of data.students) for (const g of st.subjects) {
    rows.push([data.year.year_be, data.grade, data.room, st.student_code, st.national_id || "", st.name, g.code, g.name,
      g.subject_type === "basic" ? "พื้นฐาน" : "เพิ่มเติม", g.hours_per_year, g.total ?? "", g.grade ?? "", g.original_grade !== g.grade ? g.original_grade ?? "" : ""]);
  }
  return [header, ...rows];
}

export async function exportRoomsExcel(yearId, rooms, fileName) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const all = [];
  for (const r of rooms) {
    toast(`กำลังเตรียม ${r.grade_level}/${r.classroom}…`);
    const data = await roomData(yearId, r.grade_level, r.classroom);
    const ws = XLSX.utils.aoa_to_sheet(roomSheetRows(data));
    ws["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 16 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, ws, `${r.grade_level}-${r.classroom}`.replace(/[\\/?*[\]:]/g, "-"));
    const long = longRows(data);
    all.push(...(all.length ? long.slice(1) : long));
  }
  if (rooms.length > 1 || all.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(all), "รายวิชา (แบบยาว)");
  XLSX.writeFile(wb, fileName);
}

export async function exportRoomCsv(yearId, grade, room) {
  const data = await roomData(yearId, grade, room);
  const rows = longRows(data);
  const csv = rows.map((r) => r.map((v) => {
    const s = String(v ?? "");
    // ป้องกันสูตรอันตรายเมื่อเปิดใน Excel และ escape ตามมาตรฐาน CSV
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `ผลการเรียน_${data.year.year_be}_${grade}-${room}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
