// อ่านตารางที่วางจาก Excel / Google Sheets (คั่นด้วย Tab) หรือ CSV แล้วแปลงเป็นแถวตามชนิดข้อมูล
// ใช้ได้ทั้งในเบราว์เซอร์และในชุดทดสอบ (ไม่พึ่ง DOM)

export const IMPORT_KINDS = {
  subjects: {
    title: "รายวิชา",
    columns: [
      { key: "grade_level", label: "ชั้น", aliases: ["ระดับชั้น", "ชั้น"] },
      { key: "code", label: "รหัสวิชา", aliases: ["รหัสวิชา", "รหัส"] },
      { key: "name", label: "ชื่อวิชา", aliases: ["ชื่อวิชา", "รายวิชา", "วิชา"] },
      { key: "learning_area", label: "กลุ่มสาระ", aliases: ["กลุ่มสาระการเรียนรู้", "กลุ่มสาระ", "สาระ"] },
      { key: "subject_type", label: "ประเภท", aliases: ["ประเภท", "ประเภทวิชา"] },
      { key: "hours_per_year", label: "ชม./ปี", aliases: ["ชม./ปี", "ชั่วโมง/ปี", "เวลาเรียน", "ชั่วโมง"] },
      { key: "collect_ratio", label: "คะแนนระหว่างภาค (%)", aliases: ["คะแนนระหว่างภาค (%)", "คะแนนเก็บ", "ระหว่างภาค", "คะแนนเก็บ (%)"] },
    ],
    note: "ประเภท: พื้นฐาน / เพิ่มเติม · คะแนนระหว่างภาคเว้นว่างได้ (ใช้ค่าเริ่มต้นของปี) · รหัสวิชาเดิมของชั้นเดียวกันจะถูกแก้ตามไฟล์",
  },
  teachers: {
    title: "ครูผู้สอน",
    columns: [
      { key: "room", label: "ห้อง", aliases: ["ห้อง", "ชั้น/ห้อง", "ห้องเรียน"] },
      { key: "code", label: "รหัสวิชา", aliases: ["รหัสวิชา", "รหัส"] },
      { key: "name", label: "ชื่อวิชา", aliases: ["ชื่อวิชา", "วิชา"], optional: true },
      { key: "teachers", label: "ครูผู้สอน", aliases: ["ครูผู้สอน", "ครู", "ผู้สอน"] },
    ],
    note: "ห้องเขียนแบบ ป.4/2 · ครูหลายคนคั่นด้วยจุลภาค (,) · ใช้ชื่อ-สกุลตามบัญชีในระบบ หรืออีเมล · ครูในไฟล์จะแทนที่ครูเดิมของวิชานั้น",
  },
  homerooms: {
    title: "ครูประจำชั้น",
    columns: [
      { key: "room", label: "ห้อง", aliases: ["ห้อง", "ชั้น/ห้อง", "ห้องเรียน"] },
      { key: "teachers", label: "ครูประจำชั้น", aliases: ["ครูประจำชั้น", "ครู"] },
    ],
    note: "ห้องเขียนแบบ ป.4/2 · ครูหลายคนคั่นด้วยจุลภาค (,) · รายชื่อในไฟล์จะแทนที่ครูประจำชั้นเดิมของห้องนั้น",
  },
};

// แยกข้อความเป็นตาราง: รองรับ Tab (จาก Excel) และ CSV ที่มีเครื่องหมายคำพูด
export function parseGrid(text) {
  const src = String(text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.split("\n").find((l) => l.trim()) || "";
  const sep = firstLine.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

// แปลงตาราง → แถวข้อมูล: ถ้าแถวแรกเป็นหัวตาราง จับคอลัมน์ตามชื่อหัว ไม่เช่นนั้นใช้ลำดับคอลัมน์ตามแม่แบบ
export function gridToRows(kind, grid) {
  const spec = IMPORT_KINDS[kind];
  if (!spec || !grid.length) return { rows: [], header: false };
  const head = grid[0].map(norm);
  const index = {};
  for (const col of spec.columns) {
    const at = head.findIndex((h) => col.aliases.some((a) => h === norm(a)));
    if (at >= 0) index[col.key] = at;
  }
  const required = spec.columns.filter((c) => !c.optional);
  const header = required.filter((c) => c.key in index).length >= Math.min(2, required.length);
  let body = grid;
  if (header) body = grid.slice(1);
  else {
    // ไม่มีหัวตาราง: ลำดับคอลัมน์ตามแม่แบบ (ข้ามคอลัมน์ optional ถ้าจำนวนคอลัมน์ไม่พอ)
    const width = Math.max(...grid.map((r) => r.length));
    const cols = width >= spec.columns.length ? spec.columns : required;
    cols.forEach((c, i) => { index[c.key] = i; });
  }
  const rows = body.map((r) => Object.fromEntries(spec.columns.filter((c) => c.key in index).map((c) => [c.key, r[index[c.key]] ?? ""])));
  return { rows, header };
}

export function templateRows(kind) {
  return [IMPORT_KINDS[kind].columns.map((c) => c.label)];
}
