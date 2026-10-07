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
  // ค่าว่าง = 80% แต่ 0 คือ 0 จริง (ไม่ใช้ || เพราะ 0 จะกลายเป็น 80)
  const pct = attendancePassPct == null || attendancePassPct === "" || !Number.isFinite(Number(attendancePassPct)) ? 80 : Number(attendancePassPct);
  return (Number(hoursPerYear) || 0) * pct / 100;
}

// เกณฑ์ผ่านรายตัวชี้วัดของภาคเรียนนั้น (ร้อยละของคะแนนเต็ม) — ภาค 2 ใช้ค่าของภาค 1 ถ้าไม่ได้ตั้งแยก
export function indicatorPassPct(settings, term) {
  const t2 = settings?.indicator_pass_pct_t2;
  if (Number(term) === 2 && t2 != null && t2 !== "") return Number(t2);
  return Number(settings?.indicator_pass_pct ?? 50);
}

// ผลรายตัวชี้วัด: "ผ" ผ่าน, "มผ" ไม่ผ่าน, null ยังไม่มีคะแนน
export function indicatorResult(item, score, settings) {
  if (score == null || score === "") return null;
  const max = Number(item.max_score) || 0;
  if (max <= 0) return null;
  return (Number(score) / max) * 100 + 1e-9 >= indicatorPassPct(settings, item.term_number) ? "ผ" : "มผ";
}

const sum2 = (a, b) => Math.round((a + b) * 100) / 100;

// คะแนนที่นับได้สูงสุดจากการสอบแก้ตัวของตัวชี้วัด = เกณฑ์ผ่านของภาคนั้น
// ใช้คะแนนทศนิยม 2 ตำแหน่งที่น้อยที่สุดที่ "ผ่าน" (ปัดขึ้น) เพื่อให้ตรงกับ indicatorResult เสมอ
// เช่น เต็ม 4.35 เกณฑ์ 55% = 2.3925 → นับได้ 2.40 (ถ้าปัดเป็น 2.39 จะยังขึ้นว่าไม่ผ่าน)
export function remedialCap(item, settings) {
  const max = Number(item.max_score) || 0;
  return Math.ceil(Math.round(max * indicatorPassPct(settings, item.term_number) * 1e6) / 1e6 - 1e-9) / 100;
}

// คะแนนที่ใช้คิดผล: ถ้ามีคะแนนแก้ตัว นับ max(คะแนนเดิม, min(แก้ตัว, เกณฑ์ผ่าน))
export function effectiveScore(item, score, remedial, settings) {
  if (remedial == null || remedial === "" || item.kind === "final") return score;
  const capped = Math.min(Number(remedial), remedialCap(item, settings));
  // ไม่มีคะแนนเดิม = ยังไม่ครบ (คะแนนแก้ตัวที่ค้างอยู่จะกลับมานับเมื่อกรอกคะแนนเดิมอีกครั้ง)
  return score == null || score === "" ? null : Math.max(Number(score), capped);
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * คำนวณผลการเรียนของนักเรียน 1 คนใน 1 รายวิชา (ทั้งปี)
 * items: [{id, kind:'indicator'|'final', max_score, term_number}]
 * scores: Map/obj item_id -> number|null
 * result: { hours_attended, special, remedial_type, remedial_grade }
 * settings: { collect_ratio, hours_per_year, attendance_pass_pct, indicator_pass_pct, indicator_pass_pct_t2, finalized }
 * remedials: Map/obj item_id -> คะแนนแก้ตัว (ถ้ามี)
 *
 * กติกา (ตามที่โรงเรียนตกลง):
 * - คิดรายภาค ภาคละ 50 คะแนน = ระหว่างภาค (collect_ratio / 2) + ปลายภาค ((100 - collect_ratio) / 2) เช่น 35 + 15
 *   ทั้งปี = ภาค 1 + ภาค 2 (เต็ม 100) แล้วตัดเกรดครั้งเดียว
 * - ไม่ปัดเศษอัตโนมัติ: ถ้าคะแนนเต็มของภาคตรงสัดส่วน ใช้คะแนนจริงบวกกันตรง ๆ (ทศนิยม 2 ตำแหน่งตามที่ครูกรอก)
 *   ถ้าไม่ตรง (ระบบจะไม่ให้ยืนยันผล) จึงเทียบสัดส่วนชั่วคราวแล้วตัดทศนิยมตำแหน่งที่ 3 ทิ้ง
 * - ระหว่างปี (ยังไม่ยืนยันผล) ถ้ายังไม่ครบ 2 ภาค หรือคะแนนยังไม่ครบ → ยังไม่มีผลการเรียน ("-")
 *   เมื่อยืนยันผลแล้วคะแนนยังไม่ครบ → ร
 * - รายการที่ไม่ระบุภาค (ข้อมูลรุ่นเก่า/ทดสอบ) คิดรวมทั้งปีเป็นก้อนเดียวเต็ม 100
 * - carry = { 1: {collect, final, total} } คะแนนภาคที่ยกมาจาก ปพ.6 โรงเรียนเดิม (นักเรียนย้ายเข้า) ใช้แทนช่องคะแนนของภาคนั้นทั้งภาค
 */
export function computeStudentResult(items, scores, result, settings, remedials, carry) {
  const carried = (t) => { const c = carry?.[t]; return c && c.total != null && c.total !== "" ? c : null; };
  const pick = (m, id) => { const v = m instanceof Map ? m.get(id) : m?.[id]; return v == null || v === "" ? null : Number(v); };
  const remediated = [];
  const getItem = (item) => {
    const raw = pick(scores, item.id), rem = pick(remedials, item.id);
    if (rem == null) return raw;
    remediated.push(item.id);
    return effectiveScore(item, raw, rem, settings);
  };
  const ratio = Math.min(100, Math.max(0, Number(settings.collect_ratio ?? 70)));
  const yearly = items.some((i) => Number(i.term_number) !== 1 && Number(i.term_number) !== 2);
  const failedIndicators = [];
  let missing = 0;
  const per = {}; // term (0 = ทั้งปี) -> {collect, collectMax, final, finalMax, missing}
  for (const item of items) {
    const max = Number(item.max_score) || 0;
    const t = yearly ? 0 : Number(item.term_number);
    const b = per[t] ||= { collect: 0, collectMax: 0, final: 0, finalMax: 0, missing: 0 };
    if (item.kind === "final") b.finalMax = sum2(b.finalMax, max); else b.collectMax = sum2(b.collectMax, max);
    if (!yearly && carried(t)) continue; // ภาคนี้ใช้คะแนนยกมา ไม่นับช่องคะแนน
    const v = getItem(item);
    if (v == null) { missing++; b.missing++; continue; }
    if (item.kind === "final") b.final = sum2(b.final, v);
    else {
      b.collect = sum2(b.collect, v);
      if (indicatorResult(item, v, settings) === "มผ") failedIndicators.push(item.id);
    }
  }

  // แปลงคะแนนของแต่ละก้อนให้อยู่ในสัดส่วน (full = 50 ต่อภาค หรือ 100 ทั้งปี)
  let exact = true;
  const part = (b, full) => {
    const cTarget = ratio * full / 100, fTarget = full - cTarget;
    let cw = 0, fw = 0;
    if (b.collectMax > 0 && b.finalMax > 0) { cw = cTarget / b.collectMax; fw = fTarget / b.finalMax; }
    else if (b.collectMax > 0) cw = full / b.collectMax;
    else if (b.finalMax > 0) fw = full / b.finalMax;
    const ok = (b.collectMax === 0 || near(cw, 1)) && (b.finalMax === 0 || near(fw, 1));
    if (!ok) exact = false;
    const sc = (c, f) => ok ? sum2(c, f) : floor2(c * cw + f * fw);
    const collect = sc(b.collect, 0), final = sc(0, b.final);
    return {
      // รวมภาค = ระหว่างภาค + ปลายภาค ที่แสดง (กรณีย่อขยาย ตัดเศษแต่ละส่วนก่อนแล้วจึงรวม ตัวเลขบนเอกสารจึงบวกกันลงตัว)
      collect, final, total: sum2(collect, final),
      collect_max: sc(b.collectMax, 0), final_max: sc(0, b.finalMax), max: sc(b.collectMax, b.finalMax),
      missing: b.missing, complete: b.missing === 0, exact: ok,
    };
  };
  const term_scores = {};
  let total = null, collectScaled = 0, finalScaled = 0;
  if (yearly) {
    if (per[0]) { const p = part(per[0], 100); total = p.total; collectScaled = p.collect; finalScaled = p.final; }
  } else {
    for (const t of [1, 2]) if (carried(t)) {
      const c = carried(t), n = (v) => v == null || v === "" ? null : Number(v);
      term_scores[t] = { collect: n(c.collect), final: n(c.final), total: Number(c.total), collect_max: null, final_max: null, max: 50,
        missing: 0, complete: true, exact: true, carried: true };
      total = sum2(total ?? 0, term_scores[t].total);
      collectScaled = sum2(collectScaled, term_scores[t].collect ?? 0);
      finalScaled = sum2(finalScaled, term_scores[t].final ?? 0);
    } else if (per[t]) {
      term_scores[t] = part(per[t], 50);
      total = sum2(total ?? 0, term_scores[t].total);
      collectScaled = sum2(collectScaled, term_scores[t].collect);
      finalScaled = sum2(finalScaled, term_scores[t].final);
    }
  }
  const bothTerms = yearly || ((!!per[1] || !!carried(1)) && (!!per[2] || !!carried(2)));
  const hasItems = (items.length > 0 && Object.values(per).some((b) => b.collectMax + b.finalMax > 0)) || (!yearly && !!(carried(1) || carried(2)));
  const raw = (k) => Object.values(per).reduce((a, b) => sum2(a, b[k]), 0);

  const hoursPerYear = Number(settings.hours_per_year) || 0;
  const hours = result?.hours_attended == null || result.hours_attended === ""
    ? hoursPerYear : Number(result.hours_attended);
  const needHours = requiredHours(hoursPerYear, settings.attendance_pass_pct);
  const lowAttendance = hoursPerYear > 0 && hours < needHours - 1e-9;
  const finalized = !!settings.finalized;

  let original;
  let reason = null;
  if (lowAttendance) { original = "มส"; reason = "เวลาเรียนไม่ถึงเกณฑ์"; }
  else if (result?.special === "มส") { original = "มส"; reason = "ครูกำหนด มส"; }
  else if (result?.special === "ร") { original = "ร"; reason = "ครูกำหนด ร"; }
  else if (!hasItems) { original = null; reason = "ยังไม่ได้ตั้งโครงสร้างคะแนน"; }
  else if (!bothTerms) { original = null; reason = "ผลการเรียนออกเมื่อครบ 2 ภาคเรียน"; }
  else if (missing > 0) { original = finalized ? "ร" : null; reason = `คะแนนยังไม่ครบ ${missing} ช่อง`; }
  else original = gradeFromTotal(total);

  const finalGrade = result?.remedial_grade ? String(result.remedial_grade) : original;

  return {
    collect_raw: raw("collect"), collect_max: raw("collectMax"),
    final_raw: raw("final"), final_max: raw("finalMax"),
    collect_scaled: hasItems ? collectScaled : 0, final_scaled: hasItems ? finalScaled : 0,
    exact, total: hasItems ? total : null, total_max: yearly ? 100 : Object.keys(term_scores).length * 50,
    missing, term_scores, hours, need_hours: needHours, low_attendance: lowAttendance,
    original_grade: original, reason, grade: finalGrade, carried_terms: yearly ? [] : [1, 2].filter((t) => carried(t)),
    failed_indicators: failedIndicators, remediated,
  };
}

// เวลาเรียนรายวิชาจากการมาเรียนของครูประจำชั้น (ครูผู้สอนไม่กรอกชั่วโมง): ชั่วโมงเต็ม × ร้อยละการมาเรียน
// ใช้เฉพาะเมื่อไม่มี hours_attended ที่บันทึกไว้เดิม · rate = { pct } จาก attendanceRates (null = ยังไม่เปิดภาค)
export function resultWithAttendance(result, rate, hoursPerYear) {
  if (!rate || rate.pct == null || (result && result.hours_attended != null && result.hours_attended !== "")) return result || {};
  return { ...(result || {}), hours_attended: Math.floor(Number(hoursPerYear || 0) * rate.pct) / 100 };
}

// ตรวจโครงสร้างคะแนนก่อนยืนยันผล: คะแนนเต็มของแต่ละภาคต้องตรงสัดส่วน (เช่น 35 + 15 = 50)
// เพื่อไม่ให้ระบบต้องย่อขยายคะแนน (ซึ่งทำให้เกิดทศนิยมเอง)
export function structureIssues(items, collectRatio, word = "ตัวชี้วัด") {
  const ratio = Number(collectRatio ?? 70);
  if (!items.length) return ["ยังไม่ได้ตั้งโครงสร้างคะแนน"];
  const issues = [];
  const sum = (list, final) => list.filter((i) => (i.kind === "final") === final).reduce((a, i) => sum2(a, Number(i.max_score || 0)), 0);
  for (const t of [1, 2]) {
    const list = items.filter((i) => Number(i.term_number) === t);
    if (!list.length) continue;
    const c = sum(list, false), f = sum(list, true), cT = ratio / 2, fT = 50 - cT;
    if (f > 0 && !near(c, cT)) issues.push(`ภาค ${t}: คะแนนเต็ม${word}รวม ${c} ต้องเท่ากับคะแนนระหว่างภาค ${cT}`);
    if (f > 0 && !near(f, fT)) issues.push(`ภาค ${t}: คะแนนเต็มสอบปลายภาค ${f} ต้องเท่ากับ ${fT}`);
    if (f === 0 && !near(c, 50)) issues.push(`ภาค ${t}: ไม่มีสอบปลายภาค คะแนนเต็ม${word}รวม ${c} ต้องเท่ากับ 50`);
  }
  return issues;
}

// คำเรียกช่องคะแนน: หลักสูตรใหม่ (ป.1–3) ใช้ "ผลการเรียนรู้", หลักสูตรเดิม (ป.4–6) ใช้ "ตัวชี้วัด"
export function indicatorWord(gradeLevel) {
  return /^ป\.[123]$/.test(String(gradeLevel || "")) ? "ผลการเรียนรู้" : "ตัวชี้วัด";
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
    key: "trait", title: "คุณลักษณะอันพึงประสงค์", short: "คุณลักษณะฯ", type: "level", rule: "trait",
    items: [
      ["trait_1", "รักชาติ ศาสน์ กษัตริย์"], ["trait_2", "ซื่อสัตย์สุจริต"], ["trait_3", "มีวินัย"],
      ["trait_4", "ใฝ่เรียนรู้"], ["trait_5", "อยู่อย่างพอเพียง"], ["trait_6", "มุ่งมั่นในการทำงาน"],
      ["trait_7", "รักความเป็นไทย"], ["trait_8", "มีจิตสาธารณะ"],
    ],
  },
  {
    // 5 ตัวชี้วัดตามแนวปฏิบัติการวัดและประเมินผล (หลักสูตรแกนกลางฯ) — ตรงกับ ปพ.5 ของโรงเรียนที่มี 5 ข้อ
    key: "rtw", title: "การอ่าน คิดวิเคราะห์ และเขียน", short: "อ่าน คิด เขียน", type: "level", rule: "rtw",
    items: [
      ["rtw_1", "สามารถคัดสรรสื่อที่ต้องการอ่านเพื่อหาข้อมูลสารสนเทศได้ตามวัตถุประสงค์ สร้างความเข้าใจและประยุกต์ใช้ความรู้จากการอ่าน"],
      ["rtw_2", "สามารถจับประเด็นสำคัญ เปรียบเทียบ เชื่อมโยงความเป็นเหตุเป็นผลจากการอ่าน"],
      ["rtw_3", "สามารถเชื่อมโยงความสัมพันธ์ของเรื่องราว เหตุการณ์ของเรื่องที่อ่าน"],
      ["rtw_4", "สามารถแสดงความคิดเห็นต่อเรื่องที่อ่าน โดยมีเหตุผลประกอบ"],
      ["rtw_5", "สามารถถ่ายทอดความเข้าใจ ความคิดเห็น คุณค่าจากเรื่องที่อ่าน โดยการเขียน"],
    ],
  },
  {
    key: "comp", title: "สมรรถนะสำคัญของผู้เรียน", short: "สมรรถนะ", type: "level", rule: "comp",
    summaryLabels: { 3: "ดีเยี่ยม", 2: "ดี", 1: "พอใช้", 0: "ปรับปรุง" },
    items: [
      ["comp_1", "ความสามารถในการสื่อสาร"], ["comp_2", "ความสามารถในการคิด"],
      ["comp_3", "ความสามารถในการแก้ปัญหา"], ["comp_4", "ความสามารถในการใช้ทักษะชีวิต"],
      ["comp_5", "ความสามารถในการใช้เทคโนโลยี"],
    ],
  },
  {
    // ปพ.5.1: ต่อกิจกรรมมี 2 เงื่อนไข — เวลาเรียน (_t) และจุดประสงค์ (_o)
    // ค่าเริ่มต้นผ่าน: เก็บเฉพาะ "มผ" ของคนที่ไม่ผ่าน ไม่ต้องยืนยันเด็กทุกเทอม
    key: "act", title: "กิจกรรมพัฒนาผู้เรียน", short: "กิจกรรม (ปพ.5.1)", type: "activity",
    items: [
      ["act_guidance", "กิจกรรมแนะแนว"], ["act_scout", "ลูกเสือ-เนตรนารี"],
      ["act_club", "ฐานการเรียนรู้"], ["act_social", "กิจกรรมเพื่อสังคมและสาธารณประโยชน์"],
    ],
  },
];

export const ACTIVITY_PARTS = [["t", "เวลาเรียน"], ["o", "จุดประสงค์"]];
export const ASSESSMENT_KEYS = new Set(ASSESSMENT_GROUPS.flatMap((g) => g.type === "activity"
  ? g.items.flatMap(([k]) => ACTIVITY_PARTS.map(([p]) => `${k}_${p}`))
  : g.items.map((i) => i[0])));

export function validAssessmentValue(key, value) {
  if (!ASSESSMENT_KEYS.has(key)) return false;
  if (value === "" || value == null) return true; // ลบค่า
  if (/^act_/.test(key)) return value === "มผ";
  return ["0", "1", "2", "3"].includes(String(value));
}

// ผลกิจกรรม 1 รายการ: ผ่านเมื่อทั้งเวลาเรียนและจุดประสงค์ไม่ถูกติ๊กว่าไม่ผ่าน
export function activityResult(key, values) {
  return ACTIVITY_PARTS.some(([p]) => values?.[`${key}_${p}`] === "มผ") ? "มผ" : "ผ";
}

// สรุปผลของกลุ่ม "ตามเกณฑ์" (แนวปฏิบัติ สพฐ.) — ยืนยันกับ ปพ.5 จริงของโรงเรียน (tests/assessment.test.mjs)
// คุณลักษณะ 8 ข้อ: มีข้อใด 0 → ไม่ผ่าน; ดีเยี่ยม 5–8 ข้อและไม่มีข้อใดต่ำกว่าดี → ดีเยี่ยม;
//   ดีเยี่ยม 1–4 ข้อและไม่มีต่ำกว่าดี / ดีทั้งหมด / ดีเยี่ยม 4 ข้อและที่เหลือไม่ต่ำกว่าผ่าน → ดี; นอกนั้น → ผ่าน
// อ่าน คิดวิเคราะห์ เขียน 5 ข้อ: รวมคะแนน 13–15 ดีเยี่ยม, 9–12 ดี, 5–8 ผ่าน, 0–4 ไม่ผ่าน
// สมรรถนะ 5 ด้าน: นับด้านที่ผ่าน (ระดับ 1 ขึ้นไป) 5 = ดีเยี่ยม, 4 = ดี, 3 = พอใช้, 0–2 = ปรับปรุง
export function summarizeGroup(group, values) {
  if (group.type === "activity") return group.items.some(([k]) => activityResult(k, values) === "มผ") ? "มผ" : "ผ";
  const vals = group.items.map(([k]) => values?.[k]);
  if (vals.some((v) => v == null || v === "")) return null;
  const n = vals.map(Number);
  if (group.rule === "rtw") {
    const sum = n.reduce((a, b) => a + b, 0), max = n.length * 3;
    const scale = (x) => Math.round((x / 15) * max); // ปรับช่วงตามจำนวนข้อ (5 ข้อ = 13/9/5)
    return sum >= scale(13) ? "3" : sum >= scale(9) ? "2" : sum >= scale(5) ? "1" : "0";
  }
  if (group.rule === "comp") {
    const pass = n.filter((v) => v >= 1).length;
    return pass >= 5 ? "3" : pass === 4 ? "2" : pass === 3 ? "1" : "0";
  }
  if (n.some((v) => v === 0)) return "0";
  const c3 = n.filter((v) => v === 3).length, low = n.some((v) => v < 2);
  const need = Math.ceil(n.length * 5 / 8); // 8 ข้อ → 5
  if (c3 >= need && !low) return "3";
  if ((!low) || (c3 >= need - 1)) return "2";
  return "1";
}

export function summaryText(group, v) {
  if (v == null) return "";
  if (group.type === "activity") return v === "ผ" ? "ผ่าน" : "ไม่ผ่าน";
  return group.summaryLabels?.[v] ?? LEVEL_LABEL[v];
}

export function roomLabel(grade, room) {
  return `${grade}/${room}`;
}

// ตรวจก่อนส่งผล: ช่องว่าง, คะแนนรวมมีทศนิยม (ครูตัดสินใจปัดเอง), คะแนนรวมใกล้รอยต่อเกรด (ต่ำกว่าเกณฑ์ไม่ถึง 1 คะแนน), มส
// students: [{id, name, enrollment_status}], computed: {id: computeStudentResult}
export function submissionChecks(students, computed) {
  const out = { blanks: [], decimals: [], borderline: [], ms: [] };
  const hasDec = (v) => v != null && Math.abs(v - Math.round(v)) > 1e-9;
  for (const s of students) {
    if ((s.enrollment_status || "enrolled") !== "enrolled") continue;
    const k = computed[s.id];
    if (!k) continue;
    if (k.grade === "มส" || k.original_grade === "มส") out.ms.push({ id: s.id, name: s.name });
    if (k.missing > 0) out.blanks.push({ id: s.id, name: s.name, missing: k.missing });
    const terms = Object.entries(k.term_scores || {});
    const decTerms = terms.filter(([, t]) => hasDec(t.total)).map(([n, t]) => `ภาค ${n} = ${t.total}`);
    if (decTerms.length) out.decimals.push({ id: s.id, name: s.name, detail: decTerms.join(", ") });
    if (k.total_max === 100 && k.total != null && k.missing === 0) {
      const next = GRADE_STEPS.find((g) => g.min > k.total && g.min - k.total < 1 - 1e-9);
      if (next) out.borderline.push({ id: s.id, name: s.name, total: k.total, need: next.min, grade: next.grade });
    }
  }
  return out;
}
