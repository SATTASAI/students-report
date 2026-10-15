// ประเมินพัฒนาการอนุบาล (หลักสูตรการศึกษาปฐมวัย 2569) — ใช้ร่วมกันทั้งเซิร์ฟเวอร์ หน้ากรอก และหน้าพิมพ์
// ประเมินความสามารถผู้เรียนเมื่อจบชั้นปี 33 ข้อ/ชั้น ภาคเรียนละ 2 ครั้ง ระดับ 3 ดี · 2 พอใช้ · 1 ควรส่งเสริม

export const KINDER_DOMAINS = ["ด้านสุขภาวะทางกาย", "ด้านอารมณ์ จิตใจ และสังคม", "ด้านความเป็นพลเมืองและความเป็นไทย", "ด้านสติปัญญา"];
export const KINDER_COMMENT_FIELDS = [
  ["d1", "ด้านสุขภาวะทางกาย"], ["d2", "ด้านอารมณ์ จิตใจ และสังคม"], ["d3", "ด้านความเป็นพลเมืองและความเป็นไทย"], ["d4", "ด้านสติปัญญา"], ["other", "ด้านอื่น ๆ"],
];
export const KINDER_LEVELS = [[3, "ดี"], [2, "พอใช้"], [1, "ควรส่งเสริม"]];
export const levelLabel = (v) => KINDER_LEVELS.find(([n]) => n === Number(v))?.[1] || "";

// ผลของข้อในภาคเรียน = ครั้งล่าสุดที่ประเมิน (ครั้งที่ 2 ถ้ามี ไม่งั้นครั้งที่ 1)
export const termResult = (byKey, term) => byKey?.[`${term}-2`] ?? byKey?.[`${term}-1`] ?? null;
// ผลสิ้นปี = ภาคเรียนที่ 2 ถ้ามี ไม่งั้นภาคเรียนที่ 1
export const yearResult = (byKey) => termResult(byKey, 2) ?? termResult(byKey, 1);
// term: 1 | 2 | "year"
export const itemResult = (byKey, term) => (term === "year" ? yearResult(byKey) : termResult(byKey, term));

export const avgToLevel = (avg) => (avg == null ? null : avg >= 2.5 ? 3 : avg >= 1.5 ? 2 : 1);

// สรุปรายด้านของนักเรียน 1 คน: [{domain, n, total, avg, level}]
export function domainSummary(items, scoresOfStudent, term) {
  return KINDER_DOMAINS.map((domain) => {
    const vals = items.filter((i) => i.domain === domain).map((i) => itemResult(scoresOfStudent?.[i.code], term)).filter((v) => v != null);
    const total = items.filter((i) => i.domain === domain).length;
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { domain, n: vals.length, total, avg, level: avgToLevel(avg) };
  });
}

// สรุปรวมทุกด้าน
export function overallSummary(items, scoresOfStudent, term) {
  const vals = items.map((i) => itemResult(scoresOfStudent?.[i.code], term)).filter((v) => v != null);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  return { n: vals.length, total: items.length, avg, level: avgToLevel(avg) };
}

// ข้อความสั้นของรหัสข้อ เช่น "ด้าน 4.2 ข้อ 3.1" → "4.2/3.1"
export const shortCode = (code) => String(code).replace(/^ด้าน\s*/, "").replace(/\s*ข้อ\s*/, "/");
