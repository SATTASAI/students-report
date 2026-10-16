// ภาวะโภชนาการตามเกณฑ์ของกรมอนามัย
// - อายุไม่เกิน 5 ปี: มาตรฐาน WHO 2006 (กรมอนามัยใช้สำหรับเด็ก 0–5 ปี) — ตารางใน growth-who2006.js
// - อายุ 6–19 ปี: เกณฑ์อ้างอิงการเจริญเติบโตของเด็กอายุ 6–19 ปี กรมอนามัย (พ.ศ. 2564) — ตารางใน growth-doh619.js
//   (จากโปรแกรมกชกร v2; อายุ 5 ปี 1 เดือน–5 ปี 11 เดือนใช้ค่าคำนวณเชื่อมช่วงของโปรแกรมเดียวกัน)
// แปลผล 3 ด้าน: น้ำหนักตามเกณฑ์ส่วนสูง (รูปร่าง) · ส่วนสูงตามเกณฑ์อายุ · น้ำหนักตามเกณฑ์อายุ + "สูงดีสมส่วน"
// คิดตามค่าจริง ไม่ปัดเศษ

export const WFH_LEVELS = ["ผอม", "ค่อนข้างผอม", "สมส่วน", "ท้วม", "เริ่มอ้วน", "อ้วน"];
export const HFA_LEVELS = ["เตี้ย", "ค่อนข้างเตี้ย", "ตามเกณฑ์", "ค่อนข้างสูง", "สูง"];
export const WFA_LEVELS = ["น้ำหนักน้อย", "ค่อนข้างน้อย", "ตามเกณฑ์", "ค่อนข้างมาก", "น้ำหนักมาก"];
export const levelClass = (label) => (["สมส่วน", "ตามเกณฑ์"].includes(label) ? "ok" : ["ผอม", "อ้วน", "เตี้ย", "น้ำหนักน้อย", "น้ำหนักมาก"].includes(label) ? "bad" : "warn");

export const bmiOf = (weight, height) => (weight > 0 && height > 0 ? weight / (height / 100) ** 2 : null);

const day = (iso) => { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`); return Number.isNaN(d.getTime()) ? null : d; };
export function ageDays(birthIso, atIso) {
  if (!birthIso || !atIso) return null;
  const b = day(birthIso), a = day(atIso);
  return b && a && a >= b ? Math.round((a - b) / 86400000) : null; // ผลต่างวันเป็นจำนวนเต็มอยู่แล้ว (round กันเวลาออมแสง)
}
export const ageMonths = (birthIso, atIso) => { const d = ageDays(birthIso, atIso); return d == null ? null : d / 30.4375; };
export const ageText = (months) => (months == null ? "" : `${Math.floor(months / 12)} ปี ${Math.floor(months % 12)} เดือน`);

// เพศจากข้อมูลทะเบียน ถ้าไม่มีดูจากคำนำหน้าชื่อ
export function sexOf(student) {
  if (student?.gender === "ช" || student?.gender === "ญ") return student.gender;
  const n = String(student?.name || student?.name_prefix || "");
  return /^(เด็กชาย|ด\.ช\.|นาย)/.test(n) ? "ช" : /^(เด็กหญิง|ด\.ญ\.|นางสาว|น\.ส\.)/.test(n) ? "ญ" : null;
}

// ---------- WHO: ค่า z จาก LMS (น้ำหนักใช้การปรับส่วนเกิน ±3 SD ตามวิธีของ WHO) ----------
function zWeight(x, L, M, S) {
  const sd = (k) => M * (1 + L * S * k) ** (1 / L);
  let z = ((x / M) ** L - 1) / (L * S);
  if (z > 3) z = 3 + (x - sd(3)) / (sd(3) - sd(2));
  else if (z < -3) z = -3 + (x - sd(-3)) / (sd(-2) - sd(-3));
  return z;
}
const zLevel = (z, six) => {
  if (z == null) return null;
  // เส้นแบ่ง −2, −1.5, +1.5, +2, (+3 เฉพาะน้ำหนักตามส่วนสูง)
  if (z < -2) return 0; if (z < -1.5) return 1; if (z <= 1.5) return 2; if (z <= 2) return 3;
  return six && z > 3 ? 5 : 4;
};

// ---------- กรมอนามัย 6–19 ปี: ตารางค่าน้ำหนัก/ส่วนสูงที่เส้น SD → เทียบค่ากับเส้นโดยตรง ----------
// ref.wfh[sex] = { from, step, rows: [[-2, -1.5, median, +1.5, +2, +3], ...] } ตามส่วนสูง (ซม.)
// ref.hfa[sex] / ref.wfa[sex] = { from, step, rows: [[-2, -1.5, median, +1.5, +2], ...] } ตามอายุ (เดือน)
function lineRow(tab, x) {
  if (!tab || x == null) return null;
  const i = (x - tab.from) / tab.step, i0 = Math.floor(i + 1e-9);
  if (i0 < 0 || i0 >= tab.rows.length) return null;
  if (i0 === tab.rows.length - 1 || Math.abs(i - i0) < 1e-9) return tab.rows[i0];
  const f = i - i0, a = tab.rows[i0], b = tab.rows[i0 + 1];
  return a.map((v, k) => v + (b[k] - v) * f); // ระหว่างแถว: เส้นตรงเชื่อมสองจุดของกราฟ
}
function lineLevel(row, v, six) {
  if (!row) return null;
  if (v < row[0]) return 0; if (v < row[1]) return 1; if (v <= row[3]) return 2; if (v <= row[4]) return 3;
  return six && v > row[5] ? 5 : 4;
}

let refs = null;
// โหลดตารางอ้างอิง (ไฟล์ใหญ่ — โหลดเฉพาะหน้าที่ใช้)
export async function loadGrowthRefs() {
  if (refs) return refs;
  const who = (await import("./growth-who2006.js")).default;
  let doh = null;
  try { doh = (await import("./growth-doh619.js")).default; } catch { /* ยังไม่มีตาราง 6–19 ปี */ }
  refs = { who, doh };
  return refs;
}
export function setGrowthRefs(r) { refs = r; } // ใช้ในเทสต์ (Node)

// วิเคราะห์ 1 ครั้งการวัด → { bmi, days, months, sex, wfh, hfa, wfa, good, why }
// wfh/hfa/wfa = { label, z? } · good = สูงดีสมส่วน (ส่วนสูงตามเกณฑ์ขึ้นไป และรูปร่างสมส่วน)
export function analyzeBody(student, rec, atIso) {
  const w = Number(rec?.weight) || null, h = Number(rec?.height) || null;
  if (!w && !h) return null;
  const days = ageDays(student?.birth_date, atIso), sex = sexOf(student);
  const out = { bmi: w && h ? bmiOf(w, h) : null, days, months: days == null ? null : days / 30.4375, sex, wfh: null, hfa: null, wfa: null, good: null, why: null };
  if (!sex) { out.why = "ไม่ทราบเพศ"; return out; }
  if (!refs) { out.why = "ยังไม่โหลดเกณฑ์"; return out; }
  const { who, doh } = refs;
  const months = out.months;
  // รูปร่าง (น้ำหนักตามส่วนสูง) ไม่ขึ้นกับอายุ แต่เลือกเกณฑ์ตามช่วงอายุ: ไม่มีวันเกิด → ดูจากช่วงส่วนสูงของเกณฑ์ 2–5 ปี
  const under6 = months != null ? months < 72 : h != null && h <= 120;
  if (under6) {
    if (w && h) {
      const t = who.wfh[sex], i = Math.round((h - t.from) * 10); // ส่วนสูงทศนิยม 1 ตำแหน่ง → แถวตรงตัว
      const r = t.rows[i];
      if (r) { const z = zWeight(w, ...r); out.wfh = { z, label: WFH_LEVELS[zLevel(z, true)] }; }
    }
    if (days != null && days >= who.hfa[sex].from) {
      const r = who.hfa[sex].rows[days - who.hfa[sex].from];
      if (r && h) { const z = (h / r[0] - 1) / r[1]; out.hfa = { z, label: HFA_LEVELS[zLevel(z, false)] }; }
      const q = who.wfa[sex].rows[days - who.wfa[sex].from];
      if (q && w) { const z = zWeight(w, ...q); out.wfa = { z, label: WFA_LEVELS[zLevel(z, false)] }; }
    }
    if (days != null && days > who.hfa[sex].from + who.hfa[sex].rows.length - 1 && !doh) out.why = "อายุ 5–6 ปี: รอตารางเกณฑ์กรมอนามัย 6–19 ปี";
  }
  if (!under6 || (doh && months != null && months >= 60 && !out.hfa)) {
    if (!doh) out.why = "รอตารางเกณฑ์กรมอนามัย 6–19 ปี";
    else {
      if (w && h && !out.wfh) {
        const t = doh.wfh?.[sex];
        if (t && h < t.from) { // ตารางกรมอนามัยเริ่ม 120 ซม. — เด็กโตที่ตัวเตี้ยกว่านั้นใช้ WHO 2006 (แบบเดียวกับโปรแกรมกชกร)
          const r = who.wfh[sex].rows[Math.round((h - who.wfh[sex].from) * 10)];
          if (r) { const z = zWeight(w, ...r); out.wfh = { z, label: WFH_LEVELS[zLevel(z, true)] }; }
        } else { const lv = lineLevel(lineRow(t, h), w, true); if (lv != null) out.wfh = { label: WFH_LEVELS[lv] }; }
      }
      if (months != null) {
        const m = Math.floor(months); // อายุเต็มเดือน (ตามที่กรมอนามัยใช้: นับเดือนเต็ม ไม่ปัดขึ้น)
        if (h) { const lv = lineLevel(lineRow(doh.hfa?.[sex], m), h, false); if (lv != null) out.hfa = { label: HFA_LEVELS[lv] }; }
        if (w) { const lv = lineLevel(lineRow(doh.wfa?.[sex], m), w, false); if (lv != null) out.wfa = { label: WFA_LEVELS[lv] }; }
      }
    }
  }
  if (!out.why && days == null) out.why = "ไม่มีวันเกิด (ประเมินได้เฉพาะรูปร่าง)";
  if (out.wfh && out.hfa) out.good = out.wfh.label === "สมส่วน" && HFA_LEVELS.indexOf(out.hfa.label) >= 2;
  return out;
}
