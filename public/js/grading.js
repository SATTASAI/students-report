// กติกาการคิดคะแนนและตัดเกรด — ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์ (Worker) และหน้าเว็บ
// เพื่อให้ผลที่ครูเห็นตอนกรอกตรงกับผลในเอกสารทุกฉบับ

export const GRADE_STEPS = [
  { min: 80, grade: "4" },
  { min: 75, grade: "3.5" },
  { min: 70, grade: "3" },
  { min: 65, grade: "2.5" },
  { min: 60, grade: "2" },
  { min: 55, grade: "1.5" },
  { min: 50, grade: "1" },
  { min: 0, grade: "0" },
];

export const NUMERIC_GRADES = ["4", "3.5", "3", "2.5", "2", "1.5", "1", "0"];
export const SPECIAL_RESULTS = ["ร", "มส"];

// ตัดเกรดจากคะแนนรวม 100 — ไม่ปัดเศษ (ตัดทศนิยมทิ้ง) ตามที่โรงเรียนกำหนด
// 79.99 → 79 → เกรด 3.5
export function gradeFromTotal(total) {
  if (total == null || !Number.isFinite(total)) return null;
  const whole = Math.floor(total + 1e-9);
  for (const step of GRADE_STEPS) if (whole >= step.min) return step.grade;
  return "0";
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ปัดลงเป็นทศนิยม 2 ตำแหน่ง (ใช้แสดงคะแนนรวม ให้สอดคล้องกับการไม่ปัดขึ้น)
export function floor2(n) {
  return Math.floor(n * 100 + 1e-7) / 100;
}

export function requiredHours(hoursPerYear, attendancePassPct) {
  return (Number(hoursPerYear) || 0) * (Number(attendancePassPct) || 80) / 100;
}

/**
 * คำนวณผลการเรียนของนักเรียน 1 คนใน 1 รายวิชา (ทั้งปี)
 * items: [{id, kind:'indicator'|'final', max_score, term_number}]
 * scores: Map/obj item_id -> number|null
 * result: { hours_attended, special, remedial_type, remedial_grade }
 * settings: { collect_ratio, hours_per_year, attendance_pass_pct, indicator_pass_pct }
 */
export function computeStudentResult(items, scores, result, settings) {
  const get = (id) => {
    const v = scores instanceof Map ? scores.get(id) : scores?.[id];
    return v == null || v === "" ? null : Number(v);
  };
  let collectSum = 0, collectMax = 0, finalSum = 0, finalMax = 0, missing = 0;
  const failedIndicators = [];
  const passPct = Number(settings.indicator_pass_pct ?? 50);
  for (const item of items) {
    const max = Number(item.max_score) || 0;
    const v = get(item.id);
    if (item.kind === "final") finalMax += max; else collectMax += max;
    if (v == null) { missing++; continue; }
    if (item.kind === "final") finalSum += v; else {
      collectSum += v;
      if (max > 0 && (v / max) * 100 < passPct) failedIndicators.push(item.id);
    }
  }

  const ratio = Math.min(100, Math.max(0, Number(settings.collect_ratio ?? 70)));
  let collectScaled = 0, finalScaled = 0;
  if (collectMax > 0 && finalMax > 0) {
    collectScaled = (collectSum / collectMax) * ratio;
    finalScaled = (finalSum / finalMax) * (100 - ratio);
  } else if (collectMax > 0) {
    collectScaled = (collectSum / collectMax) * 100;
  } else if (finalMax > 0) {
    finalScaled = (finalSum / finalMax) * 100;
  }
  const hasItems = collectMax + finalMax > 0;
  const total = hasItems ? floor2(collectScaled + finalScaled) : null;

  const hoursPerYear = Number(settings.hours_per_year) || 0;
  const hours = result?.hours_attended == null || result.hours_attended === ""
    ? hoursPerYear : Number(result.hours_attended);
  const needHours = requiredHours(hoursPerYear, settings.attendance_pass_pct);
  const lowAttendance = hoursPerYear > 0 && hours < needHours - 1e-9;

  let original;
  let reason = null;
  if (lowAttendance) { original = "มส"; reason = "เวลาเรียนไม่ถึงเกณฑ์"; }
  else if (result?.special === "มส") { original = "มส"; reason = "ครูกำหนด มส"; }
  else if (result?.special === "ร") { original = "ร"; reason = "ครูกำหนด ร"; }
  else if (!hasItems) { original = null; reason = "ยังไม่ได้ตั้งโครงสร้างคะแนน"; }
  else if (missing > 0) { original = "ร"; reason = `คะแนนยังไม่ครบ ${missing} ช่อง`; }
  else original = gradeFromTotal(total);

  const finalGrade = result?.remedial_grade ? String(result.remedial_grade) : original;

  return {
    collect_raw: round2(collectSum), collect_max: collectMax,
    final_raw: round2(finalSum), final_max: finalMax,
    collect_scaled: floor2(collectScaled), final_scaled: floor2(finalScaled),
    total, missing, hours, need_hours: needHours, low_attendance: lowAttendance,
    original_grade: original, reason, grade: finalGrade,
    failed_indicators: failedIndicators,
  };
}

// ตรวจผลสอบแก้ตัว/เรียนซ้ำ ตามระเบียบการวัดผล (ประถม)
// - แก้ 0 หรือ มส (ได้รับอนุญาตให้สอบ/เรียนเพิ่มแล้ว) → ได้สูงสุด 1
// - แก้ ร → ได้ตามคะแนนจริง (0–4)
// - เรียนซ้ำรายวิชา → ได้ตามคะแนนจริง (0–4)
export function validateRemedial(original, type, grade) {
  if (!type && !grade) return null;
  if (!["remedial", "repeat"].includes(type)) return "ประเภทการแก้ไขไม่ถูกต้อง";
  if (!NUMERIC_GRADES.includes(String(grade))) return "ผลหลังแก้ไขต้องเป็น 0–4";
  if (type === "remedial") {
    if (!["0", "ร", "มส"].includes(original)) return "สอบแก้ตัวได้เฉพาะผลการเรียน 0, ร หรือ มส";
    if ((original === "0" || original === "มส") && Number(grade) > 1) return "แก้ 0 หรือ มส ได้ผลการเรียนสูงสุด 1";
  }
  return null;
}

export function gradePoint(grade) {
  return NUMERIC_GRADES.includes(String(grade)) ? Number(grade) : null;
}

// ผลการเรียนเฉลี่ย ถ่วงน้ำหนักด้วยเวลาเรียน (ชม./ปี) ทศนิยม 2 ตำแหน่งไม่ปัด
// คำนวณเมื่อทุกวิชามีผลเป็นตัวเลขแล้วเท่านั้น — ถ้ายังมี ร / มส / ไม่มีผล จะคืน null
// เพื่อไม่ให้ผลเฉลี่ยที่คิดจากบางวิชาไปปรากฏในเอกสาร
export function weightedGPA(rows) {
  if (!rows.length) return null;
  let w = 0, s = 0;
  for (const r of rows) {
    const p = gradePoint(r.grade);
    if (p == null) return null;
    const h = Number(r.hours_per_year) || 0;
    w += h; s += p * h;
  }
  return w > 0 ? floor2(s / w) : null;
}

// ---------- การประเมินของครูประจำชั้น ----------
export const LEVELS = [
  { value: "3", label: "ดีเยี่ยม" },
  { value: "2", label: "ดี" },
  { value: "1", label: "ผ่าน" },
  { value: "0", label: "ไม่ผ่าน" },
];
export const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.value, l.label]));

export const ASSESSMENT_GROUPS = [
  {
    key: "trait", title: "คุณลักษณะอันพึงประสงค์", short: "คุณลักษณะฯ", type: "level",
    items: [
      ["trait_1", "รักชาติ ศาสน์ กษัตริย์"], ["trait_2", "ซื่อสัตย์สุจริต"], ["trait_3", "มีวินัย"],
      ["trait_4", "ใฝ่เรียนรู้"], ["trait_5", "อยู่อย่างพอเพียง"], ["trait_6", "มุ่งมั่นในการทำงาน"],
      ["trait_7", "รักความเป็นไทย"], ["trait_8", "มีจิตสาธารณะ"],
    ],
  },
  {
    key: "rtw", title: "การอ่าน คิดวิเคราะห์ และเขียน", short: "อ่าน คิด เขียน", type: "level",
    items: [["rtw_read", "การอ่าน"], ["rtw_think", "การคิดวิเคราะห์"], ["rtw_write", "การเขียน"]],
  },
  {
    key: "comp", title: "สมรรถนะสำคัญของผู้เรียน", short: "สมรรถนะ", type: "level",
    items: [
      ["comp_1", "ความสามารถในการสื่อสาร"], ["comp_2", "ความสามารถในการคิด"],
      ["comp_3", "ความสามารถในการแก้ปัญหา"], ["comp_4", "ความสามารถในการใช้ทักษะชีวิต"],
      ["comp_5", "ความสามารถในการใช้เทคโนโลยี"],
    ],
  },
  {
    key: "act", title: "กิจกรรมพัฒนาผู้เรียน", short: "กิจกรรม", type: "pass",
    items: [
      ["act_guidance", "กิจกรรมแนะแนว"], ["act_scout", "ลูกเสือ-เนตรนารี"],
      ["act_club", "กิจกรรมชุมนุม"], ["act_social", "กิจกรรมเพื่อสังคมและสาธารณประโยชน์"],
    ],
  },
];

export const ASSESSMENT_KEYS = new Set(ASSESSMENT_GROUPS.flatMap((g) => g.items.map((i) => i[0])));

export function validAssessmentValue(key, value) {
  const group = ASSESSMENT_GROUPS.find((g) => g.items.some((i) => i[0] === key));
  if (!group) return false;
  if (value === "" || value == null) return true; // ลบค่า
  return group.type === "pass" ? ["ผ", "มผ"].includes(value) : ["0", "1", "2", "3"].includes(String(value));
}

// สรุปผลรวมของกลุ่มประเมินระดับคุณภาพ:
// ข้อใดไม่ผ่าน → ไม่ผ่าน; ไม่เช่นนั้นใช้ค่าเฉลี่ยแล้วปัดลง (ไม่ปัดขึ้น)
export function summarizeGroup(group, values) {
  const vals = group.items.map(([k]) => values?.[k]);
  if (vals.some((v) => v == null || v === "")) return null;
  if (group.type === "pass") return vals.every((v) => v === "ผ") ? "ผ" : "มผ";
  if (vals.some((v) => v === "0")) return "0";
  const avg = vals.reduce((a, v) => a + Number(v), 0) / vals.length;
  return String(Math.floor(avg + 1e-9));
}

export function roomLabel(grade, room) {
  return `${grade}/${room}`;
}
