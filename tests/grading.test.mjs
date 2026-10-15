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

test("ภาวะโภชนาการ: BMI ตามอายุ เกณฑ์ WHO", async () => {
  const g = await import("../public/js/growth.js");
  // ค่ามัธยฐาน (M) ของตาราง WHO = z 0
  assert.ok(Math.abs(g.bmiZ(15.2641, "ช", 61)) < 1e-9);
  assert.equal(g.analyzeBody({ gender: "ญ", birth_date: "2016-05-01" }, { weight: 45, height: 140 }, "2026-06-01").status, "อ้วน");
  assert.equal(g.analyzeBody({ name: "เด็กชายเอ", birth_date: "2022-06-04" }, { weight: 15, height: 100 }, "2026-06-01").status, "สมส่วน");
  assert.equal(g.analyzeBody({ gender: "ช", birth_date: "2016-01-01" }, { weight: 19, height: 140 }, "2026-06-01").status, "ผอมมาก");
  assert.equal(g.analyzeBody({ gender: "ช" }, { weight: 30, height: 130 }, "2026-06-01").why, "ไม่มีวันเกิด");
  assert.equal(g.bmiStatus(1.5, 48), "เสี่ยงน้ำหนักเกิน");
  assert.equal(g.bmiStatus(1.5, 72), "น้ำหนักเกิน");
  assert.equal(g.sexOf({ name: "เด็กหญิงบี" }), "ญ");
  assert.equal(g.ageText(g.ageMonths("2020-01-15", "2026-06-01")), "6 ปี 4 เดือน");
});
