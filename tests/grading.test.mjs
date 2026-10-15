import test from "node:test";
import assert from "node:assert/strict";
import { gradeFromTotal, computeStudentResult, validateRemedial, weightedGPA, summarizeGroup, ASSESSMENT_GROUPS } from "../public/js/grading.js";

test("ตัดเกรดตามช่วงคะแนน ไม่ปัดขึ้น", () => {
  const cases = [[100, "4"], [80, "4"], [79.99, "3.5"], [75, "3.5"], [74.5, "3"], [70, "3"], [69.99, "2.5"], [65, "2.5"], [60, "2"], [59.9, "1.5"], [55, "1.5"], [50, "1"], [49.99, "0"], [0, "0"]];
  for (const [t, g] of cases) assert.equal(gradeFromTotal(t), g, `คะแนน ${t}`);
  assert.equal(gradeFromTotal(null), null);
});

test("ความคลาดเคลื่อนทศนิยมของเครื่องไม่ทำให้เกรดตก", () => {
  // 56/70*70 + 24/30*30 = 80 แต่การคำนวณ float อาจได้ 79.99999
  const items = [{ id: 1, kind: "indicator", max_score: 70 }, { id: 2, kind: "final", max_score: 30 }];
  const r = computeStudentResult(items, { 1: 56, 2: 24 }, {}, { collect_ratio: 70, hours_per_year: 40, attendance_pass_pct: 80, indicator_pass_pct: 50 });
  assert.equal(r.total, 80);
  assert.equal(r.grade, "4");
  // สัดส่วน 3 ส่วน
  const items3 = [{ id: 1, kind: "indicator", max_score: 3 }, { id: 2, kind: "final", max_score: 3 }];
  const r3 = computeStudentResult(items3, { 1: 2, 2: 2 }, {}, { collect_ratio: 60, hours_per_year: 40 });
  assert.equal(r3.total, 66.66);
  assert.equal(r3.grade, "2.5");
});

test("ไม่มีสอบปลายภาค → คิดจากคะแนนเก็บเต็ม 100", () => {
  const r = computeStudentResult([{ id: 1, kind: "indicator", max_score: 40 }], { 1: 30 }, {}, { collect_ratio: 70, hours_per_year: 40 });
  assert.equal(r.total, 75);
  assert.equal(r.grade, "3.5");
});

test("มส มาก่อน ร และผลแก้ไขแทนผลเดิม", () => {
  const items = [{ id: 1, kind: "indicator", max_score: 10 }];
  const s = { collect_ratio: 70, hours_per_year: 40, attendance_pass_pct: 80 };
  assert.equal(computeStudentResult(items, {}, { hours_attended: 31 }, s).grade, "มส");
  // คะแนนไม่ครบ: ระหว่างปียังไม่มีผล ("-"), ยืนยันผลแล้วจึงเป็น ร
  assert.equal(computeStudentResult(items, {}, { hours_attended: 32 }, s).grade, null);
  assert.equal(computeStudentResult(items, {}, { hours_attended: 32 }, { ...s, finalized: true }).grade, "ร");
  assert.equal(computeStudentResult(items, { 1: 2 }, { remedial_grade: "1" }, s).grade, "1");
  assert.equal(computeStudentResult(items, { 1: 2 }, { remedial_grade: "1" }, s).original_grade, "0");
});

test("กติกาผลแก้ตัว", () => {
  assert.equal(validateRemedial("0", "remedial", "1"), null);
  assert.ok(validateRemedial("0", "remedial", "2"));
  assert.ok(validateRemedial("มส", "remedial", "1.5"));
  assert.equal(validateRemedial("ร", "remedial", "3"), null);
  assert.ok(validateRemedial("3", "remedial", "1"));
  assert.equal(validateRemedial("0", "repeat", "2.5"), null);
  assert.ok(validateRemedial("0", "remedial", "ร"));
});

test("ผลการเรียนเฉลี่ยถ่วงชั่วโมง และไม่คิดถ้ายังมีวิชาที่ไม่มีผล", () => {
  assert.equal(weightedGPA([{ grade: "4", hours_per_year: 200 }, { grade: "2", hours_per_year: 40 }]), 3.66);
  assert.equal(weightedGPA([{ grade: "4", hours_per_year: 200 }, { grade: "ร", hours_per_year: 40 }]), null);
  assert.equal(weightedGPA([{ grade: "4", hours_per_year: 200 }, { grade: null, hours_per_year: 40 }]), null);
  assert.equal(weightedGPA([]), null);
});

test("สรุปการประเมินของครูประจำชั้น", () => {
  const trait = ASSESSMENT_GROUPS.find((g) => g.key === "trait");
  const all = (v) => Object.fromEntries(trait.items.map(([k]) => [k, v]));
  assert.equal(summarizeGroup(trait, all("3")), "3");
  assert.equal(summarizeGroup(trait, { ...all("3"), trait_8: "0" }), "0");
  // 3 จำนวน 7 ข้อ + 2 อีก 1 ข้อ = ดีเยี่ยม ตามเกณฑ์ (ตรงกับ ปพ.5 จริงเลขที่ 7)
  assert.equal(summarizeGroup(trait, { ...all("3"), trait_8: "2" }), "3");
  assert.equal(summarizeGroup(trait, { ...all("3"), trait_8: undefined }), null);
  const act = ASSESSMENT_GROUPS.find((g) => g.key === "act");
  assert.equal(summarizeGroup(act, { act_social_t: "มผ" }), "มผ");
});

test("ห้ามปัดเศษ: คะแนนรวม ตัดเกรด เกณฑ์แก้ตัว เวลาเรียน และการแสดงผล ใช้ค่าจริง", async () => {
  const { computeStudentResult, gradeFromTotal, remedialCap, resultWithAttendance, clean, trunc } = await import("../public/js/grading.js");
  const { fmt } = await import("./_fmt.mjs");
  assert.equal(gradeFromTotal(79.99), "3.5");
  assert.equal(gradeFromTotal(79.999), "3.5");
  assert.equal(gradeFromTotal(80), "4");
  assert.equal(clean(0.1 + 0.2), 0.3);
  assert.equal(trunc(66.6666, 2), 66.66);
  assert.equal(trunc(0.29, 2), 0.29);
  // เกณฑ์แก้ตัว: ค่าจริง ไม่ปัดขึ้น
  assert.equal(remedialCap({ max_score: 4.35, term_number: 1 }, { indicator_pass_pct: 55 }), 2.3925);
  // คะแนนทศนิยมรวมกันตรง ๆ
  const items = [{ id: 1, kind: "indicator", max_score: 17.5, term_number: 1 }, { id: 2, kind: "indicator", max_score: 17.5, term_number: 1 }, { id: 3, kind: "final", max_score: 15, term_number: 1 }];
  const r = computeStudentResult(items, { 1: 10.25, 2: 10.35, 3: 12.15 }, {}, { collect_ratio: 70 });
  assert.equal(r.term_scores[1].total, 32.75);
  // ร้อยละมาเรียน 12/15 = 80 พอดี → ชั่วโมงไม่ถูกตัดจนไม่ถึงเกณฑ์
  assert.equal(resultWithAttendance({}, { pct: clean((12 * 100) / 15) }, 200).hours_attended, 160);
  // การแสดงผล: ไม่ปัด
  assert.equal(fmt(2.3925), "2.3925");
  assert.equal(fmt(7.36666, 1), "7.3");
  assert.equal(fmt(79.999, 2), "79.99");
});

test("ภาวะโภชนาการตามเกณฑ์กรมอนามัย: เด็กไม่เกิน 5 ปี (WHO 2006) รูปร่าง ส่วนสูง สูงดีสมส่วน", async () => {
  const g = await import("../public/js/growth.js");
  const who = (await import("../public/js/growth-who2006.js")).default;
  g.setGrowthRefs({ who, doh: null });
  // ค่ามัธยฐาน (M) ของตาราง = z 0 → สมส่วน / ตามเกณฑ์
  const M100 = who.wfh["ช"].rows[350][1]; // 65 + 35.0 = 100 ซม.
  assert.ok(M100 > 15 && M100 < 16);
  const kid = { gender: "ช", birth_date: "2022-06-01" };
  const hM = who.hfa["ช"].rows[g.ageDays("2022-06-01", "2026-06-01") - 731][0];
  let a = g.analyzeBody(kid, { weight: M100, height: 100 }, "2026-06-01");
  assert.ok(Math.abs(a.wfh.z) < 1e-9); assert.equal(a.wfh.label, "สมส่วน");
  assert.ok(hM > 100 && hM < 106);
  a = g.analyzeBody(kid, { weight: M100, height: 100 }, "2026-06-01");
  assert.equal(a.hfa.label, "ตามเกณฑ์"); // 100 ซม. ตอนอายุ 4 ปี
  assert.equal(a.good, true);
  assert.equal(g.analyzeBody(kid, { weight: 12, height: 100 }, "2026-06-01").wfh.label, "ผอม");
  assert.equal(g.analyzeBody(kid, { weight: 21, height: 100 }, "2026-06-01").wfh.label, "อ้วน");
  assert.equal(g.analyzeBody(kid, { weight: 14, height: 92 }, "2026-06-01").hfa.label, "เตี้ย");
  assert.equal(g.analyzeBody(kid, { weight: 14, height: 92 }, "2026-06-01").good, false);
  // ไม่มีวันเกิด: ยังประเมินรูปร่างได้ แต่ไม่ได้ส่วนสูงตามอายุ
  a = g.analyzeBody({ name: "เด็กหญิงบี" }, { weight: 15, height: 100 }, "2026-06-01");
  assert.ok(a.wfh && !a.hfa && a.why);
  // 6 ปีขึ้นไป: ต้องใช้ตารางกรมอนามัย 6–19 ปี (ยังไม่มี → แจ้งเหตุ)
  a = g.analyzeBody({ gender: "ช", birth_date: "2016-01-01" }, { weight: 30, height: 135 }, "2026-06-01");
  assert.equal(a.wfh, null); assert.match(a.why, /6–19/);
  // ตาราง 6–19 แบบเส้น SD (ตัวอย่างสมมติเพื่อทดสอบกลไก)
  g.setGrowthRefs({ who, doh: { wfh: { "ช": { from: 130, step: 1, rows: [[22, 23, 27, 32, 34, 40], [23, 24, 28, 33, 35, 41]] } }, hfa: { "ช": { from: 120, step: 1, rows: [[125, 128, 136, 145, 148]] } } } });
  a = g.analyzeBody({ gender: "ช", birth_date: "2016-01-01" }, { weight: 33.5, height: 130.5 }, "2026-06-01"); // เส้น +1.5 ที่ 130.5 = 32.5, +2 = 34.5
  assert.equal(a.wfh.label, "ท้วม");
  assert.equal(a.hfa, null); // อายุ 125 เดือน อยู่นอกตารางตัวอย่าง
  assert.equal(g.sexOf({ name: "เด็กหญิงบี" }), "ญ");
  assert.equal(g.ageText(g.ageMonths("2020-01-15", "2026-06-01")), "6 ปี 4 เดือน");
});
