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
  assert.equal(computeStudentResult(items, {}, { hours_attended: 32 }, s).grade, "ร");
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
  assert.equal(summarizeGroup(trait, { ...all("3"), trait_8: "2" }), "2");
  assert.equal(summarizeGroup(trait, { ...all("3"), trait_8: undefined }), null);
  const act = ASSESSMENT_GROUPS.find((g) => g.key === "act");
  assert.equal(summarizeGroup(act, { act_guidance: "ผ", act_scout: "ผ", act_club: "ผ", act_social: "มผ" }), "มผ");
});
