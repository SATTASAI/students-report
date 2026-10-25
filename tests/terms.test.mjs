// ทำงานรายภาคเรียน: ภาคปัจจุบัน, การมาเรียนแยกภาค, หนังสือแจ้งผู้ปกครองรายภาค, ความคืบหน้ารายภาค
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
import { currentTerm, termOfDate } from "../src/lib/data.js";

const ORIGIN = "http://school.test";
const Q = `grade=${encodeURIComponent("ป.4")}&room=1`;

test("ภาคเรียนปัจจุบันและภาคของวันที่", () => {
  const terms = [{ term_number: 1, start_date: "2026-05-01", end_date: "2026-10-10" }, { term_number: 2, start_date: "2026-11-01", end_date: "2027-03-31" }];
  assert.equal(currentTerm(terms, "2026-04-20"), 1); // ก่อนเปิดปี
  assert.equal(currentTerm(terms, "2026-07-01"), 1);
  assert.equal(currentTerm(terms, "2026-10-25"), 2); // ปิดภาค → ภาคถัดไป
  assert.equal(currentTerm(terms, "2027-01-10"), 2);
  assert.equal(currentTerm(terms, "2027-05-01"), 2); // หลังจบปี
  assert.equal(currentTerm([], "2026-07-01"), 1);
  assert.equal(termOfDate(terms, "2026-10-31"), 1);
  assert.equal(termOfDate(terms, "2026-11-01"), 2);
  assert.equal(termOfDate(terms.slice(0, 1), "2027-01-01"), 1);
});

test("API รายภาค: /api/me, การมาเรียนแยกภาค, หนังสือแจ้งรายภาค, ความคืบหน้ารายภาค", async () => {
  const env = await makeEnv();
  const cookies = {};
  const call = async (who, method, path, body) => {
    const headers = { "Content-Type": "application/json", Origin: ORIGIN, ...(cookies[who] ? { Cookie: cookies[who] } : {}) };
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const data = await res.json();
    assert.equal(res.status, 200, `${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  for (const [who, email] of [["admin", "admin@test.local"], ["t1", "teacher1@test.local"]]) {
    const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) }), env);
    cookies[who] = r.headers.get("Set-Cookie").split(";")[0];
  }
  await call("admin", "POST", "/api/admin/import/homerooms", { rows: [{ room: "ป.4/1", teachers: "ครูสมใจ ใจดี" }] });
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.4"] });
  await call("admin", "POST", "/api/admin/courses/generate", {});
  const { courses } = await call("admin", "GET", "/api/admin/courses");
  const c = courses.find((x) => x.code === "ท14101" && x.classroom === "1");
  await call("admin", "PUT", `/api/admin/courses/${c.id}/teachers`, { user_ids: [2] });

  const me = await call("t1", "GET", "/api/me");
  assert.deepEqual(me.terms.map((t) => [t.term_number, t.start_date, t.end_date]), [[1, "2026-05-01", "2026-10-10"], [2, "2026-11-01", "2027-03-31"]]);
  assert.ok([1, 2].includes(me.current_term));

  // ความคืบหน้ารายภาค: ภาค 1 กรอกครบ ภาค 2 ยังไม่กรอก
  const d = await call("t1", "POST", `/api/courses/${c.id}/items`, { items: [1, 2].map((t) => ({ term_number: t, kind: "indicator", title: `เก็บ ${t}`, max_score: 50 })) });
  const kids = d.students.filter((s) => s.enrollment_status === "enrolled");
  const it1 = d.items.find((i) => i.term_number === 1);
  await call("t1", "PUT", `/api/courses/${c.id}/scores`, { changes: kids.map((s) => ({ item_id: it1.id, student_id: s.id, score: 30 })) });
  const mine = (await call("t1", "GET", "/api/me")).courses.find((x) => x.id === c.id);
  assert.deepEqual([mine.progress_t1, mine.progress_t2, mine.progress], [100, 0, 50]);

  // การมาเรียน: ภาค 1 (ก.ย.) 2 วัน + มาสาย 1, ภาค 2 (พ.ย.) 1 วัน
  const [a] = kids;
  await call("t1", "PUT", `/api/homeroom/attendance?${Q}`, { changes: [
    { student_id: a.id, date: "2026-09-01", code: "ข" }, { student_id: a.id, date: "2026-09-02", code: "ป" }, { student_id: a.id, date: "2026-09-03", code: "ส" },
    { student_id: a.id, date: "2026-11-03", code: "ข" }] });
  const rep = await call("t1", "GET", `/api/reports/room?${Q}`);
  const att = rep.students.find((s) => s.id === a.id).attendance;
  assert.deepEqual([att["ข"], att["ป"], att["ส"]], [2, 1, 1]);
  assert.deepEqual(att.by_term, { 1: { "ข": 1, "ป": 1, "ส": 1 }, 2: { "ข": 1 } });
  assert.equal(rep.students.find((s) => s.id === a.id).absent_days, 3); // ทั้งปี (ไม่นับมาสาย)
  assert.equal(rep.terms.length, 2);
  const course = await call("t1", "GET", `/api/courses/${c.id}`);
  assert.deepEqual(course.attendance[a.id].by_term[2], { "ข": 1 });

  const all = await call("t1", "GET", `/api/reports/absence?${Q}&student=${a.id}`);
  const t1 = await call("t1", "GET", `/api/reports/absence?${Q}&student=${a.id}&term=1`);
  const t2 = await call("t1", "GET", `/api/reports/absence?${Q}&student=${a.id}&term=2`);
  assert.deepEqual([all.absences.length, t1.absences.length, t2.absences.length, all.term, t1.term], [3, 2, 1, null, 1]);
});
