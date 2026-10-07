import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { ASSESSMENT_GROUPS, summarizeGroup, activityResult, validAssessmentValue, summaryText } from "../public/js/grading.js";

// ข้อมูลจริงจาก ปพ.5 ท11101 ป.1/1 ภาค 1/2569 (Q-Info): [คะแนนรายข้อ, ผลสรุปที่ Q-Info พิมพ์]
const REAL = {"rtw":[[[2,2,2,2,2],2],[[3,3,3,2,2],3],[[2,2,2,2,2],2],[[3,3,2,2,2],2],[[2,2,2,2,2],2],[[3,3,3,3,3],3],[[3,2,2,2,2],2],[[3,3,2,2,2],2],[[3,3,3,2,2],3],[[2,2,2,2,2],2],[[3,3,3,3,3],3],[[3,3,3,3,3],3],[[2,2,2,2,2],2],[[3,3,3,3,3],3],[[2,2,2,2,2],2],[[3,3,3,3,3],3],[[2,2,2,2,2],2],[[3,3,3,3,3],3],[[2,2,2,2,2],2],[[3,3,3,3,3],3],[[3,3,2,2,2],2],[[2,2,2,2,2],2]],"trait":[[[3,3,2,3,3,3,3,2],3],[[3,3,3,3,3,3,3,3],3],[[3,3,2,2,3,2,3,2],2],[[3,3,3,3,3,3,3,3],3],[[3,3,2,2,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,2,3,3,3,3],3],[[3,3,3,2,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3],[[3,3,3,3,3,3,3,3],3]]};
const G = (k) => ASSESSMENT_GROUPS.find((g) => g.key === k);
const vals = (g, arr) => Object.fromEntries(g.items.map(([k], i) => [k, String(arr[i])]));

test("ปพ.5 จริง: ผลสรุปอ่านคิดฯ 5 ข้อ และคุณลักษณะ 8 ข้อ ตรงกับ Q-Info ทั้ง 22 คน", () => {
  for (const key of ["rtw", "trait"]) {
    const g = G(key);
    assert.equal(g.items.length, key === "rtw" ? 5 : 8);
    REAL[key].forEach(([arr, want], i) => assert.equal(summarizeGroup(g, vals(g, arr)), String(want), `${key} เลขที่ ${i + 1}`));
  }
});

test("เกณฑ์สรุป: กรณีขอบ", () => {
  const t = G("trait"), r = G("rtw"), c = G("comp");
  assert.equal(summarizeGroup(t, vals(t, [3, 3, 3, 3, 3, 3, 3, 0])), "0");      // มีข้อไม่ผ่าน
  assert.equal(summarizeGroup(t, vals(t, [3, 3, 3, 3, 3, 1, 1, 1])), "2");      // ดีเยี่ยม 5 แต่มีต่ำกว่าดี
  assert.equal(summarizeGroup(t, vals(t, [2, 2, 2, 2, 2, 2, 2, 2])), "2");      // ดีทั้งหมด
  assert.equal(summarizeGroup(t, vals(t, [3, 1, 1, 1, 1, 1, 1, 1])), "1");
  assert.equal(summarizeGroup(t, { trait_1: "3" }), null);                       // ยังประเมินไม่ครบ
  assert.equal(summarizeGroup(r, vals(r, [3, 3, 3, 2, 1])), "2");               // รวม 12
  assert.equal(summarizeGroup(r, vals(r, [1, 1, 1, 1, 1])), "1");               // รวม 5
  assert.equal(summarizeGroup(r, vals(r, [1, 1, 1, 1, 0])), "0");               // รวม 4
  assert.equal(summarizeGroup(c, vals(c, [1, 2, 3, 1, 0])), "2");               // ผ่าน 4 ด้าน
  assert.equal(summaryText(c, "1"), "พอใช้");
  assert.equal(summaryText(t, "2"), "ดี");
});

test("ปพ.5.1: ค่าเริ่มต้นผ่าน ติ๊กเฉพาะคนไม่ผ่าน (เวลาเรียน/จุดประสงค์)", () => {
  const a = G("act");
  assert.equal(summarizeGroup(a, {}), "ผ");
  assert.equal(activityResult("act_scout", { act_scout_t: "มผ" }), "มผ");
  assert.equal(activityResult("act_scout", { act_guidance_o: "มผ" }), "ผ");
  assert.equal(summarizeGroup(a, { act_club_o: "มผ" }), "มผ");
  assert.equal(validAssessmentValue("act_club_o", "มผ"), true);
  assert.equal(validAssessmentValue("act_club_o", "ผ"), false);
  assert.equal(validAssessmentValue("act_club", "มผ"), false);
  assert.equal(validAssessmentValue("rtw_5", "3"), true);
  assert.equal(validAssessmentValue("rtw_read", "3"), false);
});

const ORIGIN = "http://school.test";
async function setup() {
  const env = await makeEnv();
  const cookies = {};
  async function call(who, method, path, body, { expect } = {}) {
    const headers = { "Content-Type": "application/json", Origin: ORIGIN };
    if (who && cookies[who]) headers.Cookie = cookies[who];
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const data = await res.json().catch(() => null);
    if (expect !== undefined) assert.equal(res.status, expect, `${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return { status: res.status, data };
  }
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"], ["t2", "teacher2@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie").split(";")[0];
  }
  await call("admin", "POST", "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] }, { expect: 200 });
  return { call };
}
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;

test("ครูประจำชั้น: ความคิดเห็น 4 ด้านต่อภาค คลังข้อความ และน้ำหนักส่วนสูง", async () => {
  const { call } = await setup();
  let d = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data;
  const s = d.students.filter((x) => x.enrollment_status === "enrolled");
  await call("t2", "PUT", `/api/homeroom/comments?${Q}`, { term: 2, changes: [{ student_id: s[0].id, field: "learn", body: "x" }] }, { expect: 403 });
  await call("t1", "PUT", `/api/homeroom/comments?${Q}`, { term: 3, changes: [] }, { expect: 400 });
  await call("t1", "PUT", `/api/homeroom/comments?${Q}`, { term: 2, changes: [{ student_id: s[0].id, field: "mood", body: "x" }] }, { expect: 400 });
  await call("t1", "PUT", `/api/homeroom/comments?${Q}`, { term: 2, changes: [{ student_id: s[0].id, field: "learn", body: "ก".repeat(301) }] }, { expect: 400 });
  // ใช้กับทั้งห้อง
  await call("t1", "PUT", `/api/homeroom/comments?${Q}`, { term: 2, changes: s.map((x) => ({ student_id: x.id, field: "habit", body: "มีความรับผิดชอบ  ตั้งใจเรียน" })) }, { expect: 200 });
  await call("t1", "PUT", `/api/homeroom/comments?${Q}`, { term: 2, changes: [{ student_id: s[1].id, field: "habit", body: "" }] }, { expect: 200 });
  d = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data;
  assert.equal(d.comments[s[0].id][2].habit, "มีความรับผิดชอบ ตั้งใจเรียน");
  assert.equal(d.comments[s[1].id]?.[2]?.habit, undefined);
  assert.equal(d.comments[s[0].id][1], undefined);
  // ปพ.6 ได้ความคิดเห็นด้วย
  const rep = (await call("t1", "GET", `/api/reports/room?${Q}`, null, { expect: 200 })).data;
  assert.equal(rep.students.find((x) => x.id === s[0].id).comments[2].habit, "มีความรับผิดชอบ ตั้งใจเรียน");
  // คลังข้อความเป็นของครูแต่ละคน
  let bank = (await call("t1", "POST", "/api/homeroom/comment-bank", { field: "learn", body: "ตั้งใจเรียนดีมาก" }, { expect: 200 })).data.comment_bank;
  await call("t1", "POST", "/api/homeroom/comment-bank", { field: "learn", body: "ตั้งใจเรียนดีมาก" }, { expect: 200 }); // ซ้ำไม่เพิ่ม
  bank = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.comment_bank;
  assert.equal(bank.length, 1);
  await call("t2", "DELETE", `/api/homeroom/comment-bank/${bank[0].id}`, null, { expect: 200 });
  assert.equal((await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.comment_bank.length, 1, "ครูคนอื่นลบไม่ได้");
  await call("t1", "DELETE", `/api/homeroom/comment-bank/${bank[0].id}`, null, { expect: 200 });
  // น้ำหนักส่วนสูง
  await call("t1", "PUT", `/api/homeroom/body?${Q}`, { changes: [{ student_id: s[0].id, round: 5, weight: 30 }] }, { expect: 400 });
  await call("t1", "PUT", `/api/homeroom/body?${Q}`, { changes: [{ student_id: s[0].id, round: 1, weight: 300 }] }, { expect: 400 });
  await call("t1", "PUT", `/api/homeroom/body?${Q}`, { changes: [{ student_id: s[0].id, round: 1, weight: 32.45, height: 135 }, { student_id: s[1].id, round: 2, height: 140 }] }, { expect: 200 });
  d = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data;
  assert.deepEqual(d.body[s[0].id][1], { weight: 32.5, height: 135 });
  assert.equal(d.body[s[1].id][2].weight, null);
  await call("t1", "PUT", `/api/homeroom/body?${Q}`, { changes: [{ student_id: s[0].id, round: 1, weight: "", height: "" }] }, { expect: 200 });
  d = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data;
  assert.equal(d.body[s[0].id], undefined);
  // กิจกรรมพัฒนาผู้เรียนบันทึกที่หน้ากิจกรรมเท่านั้น
  await call("t1", "PUT", `/api/homeroom/assessments?${Q}`, { changes: [{ student_id: s[0].id, item_key: "act_scout_t", value: "มผ" }] }, { expect: 400 });
  await call("t1", "PUT", `/api/homeroom/assessments?${Q}`, { changes: [{ student_id: s[0].id, item_key: "rtw_5", value: "2" }] }, { expect: 200 });
});

test("กิจกรรมพัฒนาผู้เรียน: ครูประจำชั้นบันทึกครบ 4 กิจกรรม ผลขึ้น ปพ.6", async () => {
  const { call } = await setup();
  const d = (await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data;
  const sid = d.students.find((x) => x.enrollment_status === "enrolled").id;
  const meta = (await call("t1", "GET", "/api/activities", null, { expect: 200 })).data;
  assert.equal(meta.activities.length, 4);
  assert.ok(meta.rooms.some((r) => r.grade_level === "ป.4" && r.classroom === "1"));
  const body = { grade: "ป.4", room: "1" };
  // ครูที่ไม่ใช่ครูประจำชั้นห้องนี้บันทึกไม่ได้
  await call("t2", "PUT", "/api/activities", { ...body, changes: [{ student_id: sid, item_key: "act_club_t", value: "มผ" }] }, { expect: 403 });
  const keys = ["act_guidance_t", "act_scout_o", "act_club_t", "act_social_o"];
  await call("t1", "PUT", "/api/activities", { ...body, changes: keys.map((item_key) => ({ student_id: sid, item_key, value: "มผ" })) }, { expect: 200 });
  await call("t1", "PUT", "/api/activities", { ...body, changes: [{ student_id: sid, item_key: "act_club_o", value: "ผ" }] }, { expect: 400 });
  await call("t1", "PUT", "/api/activities", { ...body, changes: [{ student_id: sid, item_key: "rtw_1", value: "มผ" }] }, { expect: 400 });
  await call("t1", "PUT", "/api/activities", { ...body, changes: [{ student_id: 9999, item_key: "act_club_o", value: "มผ" }] }, { expect: 400 });
  const g = (await call("t1", "GET", `/api/activities?${Q}`, null, { expect: 200 })).data;
  assert.deepEqual(Object.keys(g.students.find((x) => x.id === sid).values).sort(), [...keys].sort());
  const rep = (await call("t1", "GET", `/api/reports/room?${Q}`, null, { expect: 200 })).data;
  assert.equal(rep.students.find((x) => x.id === sid).assessments.act_club_t, "มผ");
  // ฝ่ายวิชาการแก้ได้ทุกห้อง
  await call("admin", "PUT", "/api/activities", { ...body, changes: [{ student_id: sid, item_key: "act_club_t", value: "" }] }, { expect: 200 });
  assert.equal((await call("t1", "GET", `/api/homeroom?${Q}`, null, { expect: 200 })).data.assessments[sid].act_club_t, undefined);
});

test("คลังเอกสาร: ครูเห็นเฉพาะห้องที่เป็นครูประจำชั้นและวิชาที่สอน ผู้ดูแลในบทบาทครูก็เหมือนกัน", async () => {
  const { call } = await setup();
  const mine = (await call("t1", "GET", "/api/reports/docs", null, { expect: 200 })).data;
  assert.equal(mine.school, false);
  assert.deepEqual(mine.rooms.map((r) => `${r.grade_level}/${r.classroom}`), ["ป.4/1"]);
  assert.equal(mine.rooms[0].full, true);
  const other = (await call("t2", "GET", "/api/reports/docs", null, { expect: 200 })).data;
  assert.equal(other.rooms.length, 0);
  const all = (await call("admin", "GET", "/api/reports/docs", null, { expect: 200 })).data;
  assert.equal(all.school, true);
  assert.ok(all.rooms.length > 1);
  const asTeacher = (await call("admin", "GET", "/api/reports/docs?scope=mine", null, { expect: 200 })).data;
  assert.equal(asTeacher.school, false);
  assert.equal(asTeacher.rooms.length, 0);
});
