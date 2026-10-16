// SAR (รายงานการประเมินตนเองของสถานศึกษา) มาตรฐานที่ 1 — นิยามประเด็นพิจารณา แหล่งข้อมูล และระดับคุณภาพ
// ใช้ร่วมกันทั้งเซิร์ฟเวอร์ (/api/sar คำนวณตัวเลข) และหน้าเว็บ/ไฟล์ส่งออก — แก้ที่นี่ที่เดียว
// โครงสร้างตามมาตรฐานการศึกษาขั้นพื้นฐาน/ปฐมวัย (สพฐ.) — ปรับให้ตรงแบบฟอร์มของโรงเรียนเมื่อได้ไฟล์ SAR ปีก่อน

// ตัวชี้วัดที่ระบบคำนวณได้ (key → คำอธิบายวิธีคิด)
export const METRICS = {
  core3: "ร้อยละของผลการเรียนวิชาภาษาไทย คณิตศาสตร์ และภาษาต่างประเทศ ที่ได้ระดับ 3 ขึ้นไป",
  all: "ร้อยละของผลการเรียนทุกรายวิชาที่ได้ระดับ 3 ขึ้นไป",
  rtw_good: "ร้อยละนักเรียนที่ผลการประเมินการอ่าน คิดวิเคราะห์ และเขียน ระดับดีขึ้นไป",
  comp_2: "ร้อยละนักเรียนที่สมรรถนะความสามารถในการคิด ระดับดีขึ้นไป",
  comp_3: "ร้อยละนักเรียนที่สมรรถนะความสามารถในการแก้ปัญหา ระดับดีขึ้นไป",
  comp_4: "ร้อยละนักเรียนที่สมรรถนะความสามารถในการใช้ทักษะชีวิต ระดับดีขึ้นไป",
  comp_5: "ร้อยละนักเรียนที่สมรรถนะความสามารถในการใช้เทคโนโลยี ระดับดีขึ้นไป",
  trait_good: "ร้อยละนักเรียนที่ผลการประเมินคุณลักษณะอันพึงประสงค์ ระดับดีขึ้นไป",
  trait_7: "ร้อยละนักเรียนที่คุณลักษณะด้านรักความเป็นไทย ระดับดีขึ้นไป",
  act_pass: "ร้อยละนักเรียนที่ผ่านกิจกรรมพัฒนาผู้เรียนครบทุกกิจกรรม",
  att80: "ร้อยละนักเรียนที่มาเรียนถึงเกณฑ์เวลาเรียนที่โรงเรียนตั้งไว้ (ถึงวันนี้)",
  milk: "ร้อยละการดื่มนม (ครั้งที่ดื่ม ÷ วันที่มาเรียน)",
  brush: "ร้อยละการแปรงฟันหลังอาหารกลางวัน (ครั้งที่แปรง ÷ วันที่มาเรียน)",
  lunch: "ร้อยละการรับประทานอาหารกลางวัน (ครั้งที่รับประทาน ÷ วันที่มาเรียน)",
  duty: "ร้อยละการทำเขตรับผิดชอบ (ครั้งที่ทำ ÷ วันที่มาเรียน)",
  health_clean: "ร้อยละผลตรวจสุขภาพ เล็บ ฟัน ผม มือ ที่สะอาด",
  nut_shape: "ร้อยละนักเรียนที่มีรูปร่างสมส่วน (น้ำหนักตามเกณฑ์ส่วนสูง เกณฑ์กรมอนามัย) จากการชั่งวัดครั้งล่าสุด",
  nut_height: "ร้อยละนักเรียนที่มีส่วนสูงตามเกณฑ์อายุขึ้นไป (เกณฑ์กรมอนามัย) จากการชั่งวัดครั้งล่าสุด",
  nut_good: "ร้อยละนักเรียนสูงดีสมส่วน (เกณฑ์กรมอนามัย) จากการชั่งวัดครั้งล่าสุด",
};
export const areaMetric = (area) => `area:${area}`;
export const CORE_AREAS = ["ภาษาไทย", "คณิตศาสตร์", "ภาษาต่างประเทศ"];
export const LEARNING_AREAS = ["ภาษาไทย", "คณิตศาสตร์", "วิทยาศาสตร์และเทคโนโลยี", "สังคมศึกษา ศาสนาและวัฒนธรรม",
  "สุขศึกษาและพลศึกษา", "ศิลปะ", "การงานอาชีพ", "ภาษาต่างประเทศ"];
export const metricLabel = (key) => METRICS[key] || (key.startsWith("area:") ? `ร้อยละของผลการเรียนกลุ่มสาระ${key.slice(5)} ที่ได้ระดับ 3 ขึ้นไป` : key);
const HEALTH_SUBS = ["att80", "act_pass", "milk", "brush", "lunch", "health_clean", "nut_good"];
const NUT_SUBS = ["nut_shape", "nut_height"]; // แสดงประกอบ ไม่นำมาเฉลี่ย (สูงดีสมส่วนรวมสองค่านี้แล้ว)

// ประเด็นพิจารณา: main = ตัวชี้วัดหลัก (null = ครูกรอกเอง) · subs = ตัวชี้วัดประกอบ (แสดงเป็นข้อมูลสนับสนุน)
// main: "avg:<subs>" = ค่าเฉลี่ยของตัวชี้วัดประกอบที่มีข้อมูล
export const SAR_STAGES = [
  {
    key: "basic", title: "ระดับการศึกษาขั้นพื้นฐาน", standard: "มาตรฐานที่ 1 คุณภาพของผู้เรียน",
    groups: [
      { key: "1.1", title: "ผลสัมฤทธิ์ทางวิชาการของผู้เรียน", items: [
        { key: "1.1.1", title: "มีความสามารถในการอ่าน การเขียน การสื่อสาร และการคิดคำนวณ", main: "core3", subs: CORE_AREAS.map(areaMetric) },
        { key: "1.1.2", title: "มีความสามารถในการคิดวิเคราะห์ คิดอย่างมีวิจารณญาณ อภิปรายแลกเปลี่ยนความคิดเห็น และแก้ปัญหา", main: "rtw_good", subs: ["comp_2", "comp_3"] },
        { key: "1.1.3", title: "มีความสามารถในการสร้างนวัตกรรม", main: null, subs: [] },
        { key: "1.1.4", title: "มีความสามารถในการใช้เทคโนโลยีสารสนเทศและการสื่อสาร", main: "comp_5", subs: [areaMetric("วิทยาศาสตร์และเทคโนโลยี")] },
        { key: "1.1.5", title: "มีผลสัมฤทธิ์ทางการเรียนตามหลักสูตรสถานศึกษา", main: "all", subs: LEARNING_AREAS.map(areaMetric) },
        { key: "1.1.6", title: "มีความรู้ ทักษะพื้นฐาน และเจตคติที่ดีต่องานอาชีพ", main: areaMetric("การงานอาชีพ"), subs: [] },
      ] },
      { key: "1.2", title: "คุณลักษณะที่พึงประสงค์ของผู้เรียน", items: [
        { key: "1.2.1", title: "การมีคุณลักษณะและค่านิยมที่ดีตามที่สถานศึกษากำหนด", main: "trait_good", subs: [] },
        { key: "1.2.2", title: "ความภูมิใจในท้องถิ่นและความเป็นไทย", main: "trait_7", subs: [] },
        { key: "1.2.3", title: "การยอมรับที่จะอยู่ร่วมกันบนความแตกต่างและหลากหลาย", main: "comp_4", subs: [] },
        { key: "1.2.4", title: "สุขภาวะทางร่างกาย และจิตสังคม", main: `avg:${HEALTH_SUBS.join(",")}`, subs: [...HEALTH_SUBS, ...NUT_SUBS] },
      ] },
    ],
  },
  {
    key: "kinder", title: "ระดับการศึกษาปฐมวัย", standard: "มาตรฐานที่ 1 คุณภาพของเด็ก",
    groups: [
      { key: "k1", title: "พัฒนาการของเด็ก", items: [
        { key: "k1.1", title: "มีพัฒนาการด้านร่างกาย แข็งแรง มีสุขนิสัยที่ดี และดูแลความปลอดภัยของตนเองได้", main: "avg:att80,milk,brush,lunch,health_clean,nut_good", subs: ["att80", "milk", "brush", "lunch", "health_clean", "nut_good", ...NUT_SUBS] },
        { key: "k1.2", title: "มีพัฒนาการด้านอารมณ์ จิตใจ ควบคุมและแสดงออกทางอารมณ์ได้", main: null, subs: [] },
        { key: "k1.3", title: "มีพัฒนาการด้านสังคม ช่วยเหลือตนเองและเป็นสมาชิกที่ดีของสังคม", main: null, subs: ["duty"] },
        { key: "k1.4", title: "มีพัฒนาการด้านสติปัญญา สื่อสารได้ มีทักษะการคิดพื้นฐาน และแสวงหาความรู้ได้", main: null, subs: [] },
      ] },
    ],
  },
];
export const SAR_ITEMS = SAR_STAGES.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => ({ ...i, stage: s.key, group: g.key }))));
export const SAR_ITEM_KEYS = new Set(SAR_ITEMS.map((i) => i.key));

// ระดับคุณภาพ 5 ระดับ (ค่าเริ่มต้น — ปรับได้ที่หน้า SAR ให้ตรงเกณฑ์ของโรงเรียน)
export const DEFAULT_LEVELS = [
  { min: 90, label: "ยอดเยี่ยม" }, { min: 80, label: "ดีเลิศ" }, { min: 70, label: "ดี" }, { min: 60, label: "ปานกลาง" }, { min: 0, label: "กำลังพัฒนา" },
];
export function levelOf(pct, levels = DEFAULT_LEVELS) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  return [...levels].sort((a, b) => b.min - a.min).find((l) => Number(pct) >= l.min)?.label ?? null;
}
const r2 = (x) => { const v = Math.trunc(Number((x * 100).toPrecision(12))) / 100; return Number(v.toPrecision(12)); }; // ตัดทศนิยมตำแหน่งที่ 3 ทิ้ง ไม่ปัด
export const pctOf = (m) => (m && m.den ? r2((m.num / m.den) * 100) : null);

// ค่าของประเด็น: ครูกรอกเอง (manual) มาก่อน ไม่งั้นใช้ตัวชี้วัดหลักที่ระบบคำนวณ
export function autoValue(item, metrics) {
  if (!item.main) return null;
  if (item.main.startsWith("avg:")) {
    const vals = item.main.slice(4).split(",").map((k) => pctOf(metrics[k])).filter((v) => v != null);
    return vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  return pctOf(metrics[item.main]);
}
// ผลประเมินทั้งหมด: { items: {key: {auto, value, target, level, met}}, groups: {key: {value, level}}, stages: {key: {value, level}} }
export function evaluateSar(stageMetrics, values = {}, levels = DEFAULT_LEVELS) {
  const items = {}, groups = {}, stages = {};
  for (const s of SAR_STAGES) {
    const sv = [];
    for (const g of s.groups) {
      const gv = [];
      for (const it of g.items) {
        const v = values[it.key] || {};
        const auto = autoValue(it, stageMetrics[s.key] || {});
        const manual = v.manual_value == null || v.manual_value === "" ? null : Number(v.manual_value);
        const value = manual ?? auto;
        const target = v.target == null || v.target === "" ? null : Number(v.target);
        items[it.key] = { auto, manual, value, target, level: levelOf(value, levels), met: value == null || target == null ? null : value >= target, note: v.note || "" };
        if (value != null) gv.push(value);
      }
      const gval = gv.length ? r2(gv.reduce((a, b) => a + b, 0) / gv.length) : null;
      groups[g.key] = { value: gval, level: levelOf(gval, levels), filled: gv.length, total: g.items.length };
      if (gval != null) sv.push(gval);
    }
    const sval = sv.length ? r2(sv.reduce((a, b) => a + b, 0) / sv.length) : null;
    stages[s.key] = { value: sval, level: levelOf(sval, levels) };
  }
  return { items, groups, stages };
}
