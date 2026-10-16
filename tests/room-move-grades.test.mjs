// นักเรียนย้ายห้องกลางปี: คะแนนภาค 1 อยู่ห้องเดิม ภาค 2 อยู่ห้องใหม่ → ผลการเรียนทั้งปีต้องรวม 2 ภาค (เดิมเห็นภาคเดียว เกรดเป็น "-")
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";

const ORIGIN = "http://school.test";
test("ย้ายห้องกลางปี: ปพ.6/สรุปผล รวมคะแนนภาค 1 จากห้องเดิมกับภาค 2 จากห้องใหม่", async () => {
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
  const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "admin@test.local", password: PASSWORD }) }), env);
  cookies.admin = r.headers.get("Set-Cookie").split(";")[0];
  await call("admin", "POST", "/api/admin/subjects/template", { grades: ["ป.1"] }, { expect: 200 });
  await call("admin", "POST", "/api/admin/courses/generate", {}, { expect: 200 });
  const { courses } = (await call("admin", "GET", "/api/admin/courses", null, { expect: 200 })).data;
  const c1 = courses.find((x) => x.code === "ท11101" && x.classroom === "1");
  const c2 = courses.find((x) => x.code === "ท11101" && x.classroom === "2");
  assert.ok(c1 && c2, "ต้องมีรายวิชาเดียวกัน 2 ห้อง");
  const st = (s) => s.map((x, i) => ({ term_number: s === T1 ? 1 : 2, ...x, sort_order: i }));
  const T1 = [{ kind: "indicator", title: "ภาค1", max_score: 35 }, { kind: "final", title: "สอบ1", max_score: 15 }];
  const T2 = [{ kind: "indicator", title: "ภาค2", max_score: 35 }, { kind: "final", title: "สอบ2", max_score: 15 }];
  const d1 = (await call("admin", "POST", `/api/courses/${c1.id}/items`, { items: [...st(T1), ...st(T2)] }, { expect: 200 })).data;
  const d2 = (await call("admin", "POST", `/api/courses/${c2.id}/items`, { items: [...st(T1), ...st(T2)] }, { expect: 200 })).data;
  const kid = d1.students.find((x) => x.enrollment_status === "enrolled");
  const t1Items = d1.items.filter((i) => i.term_number === 1);
  await call("admin", "PUT", `/api/courses/${c1.id}/scores`, { changes: t1Items.map((i) => ({ item_id: i.id, student_id: kid.id, score: i.kind === "final" ? 10 : 30 })) }, { expect: 200 });
  // ย้ายไปห้อง 2 แล้วครูห้อง 2 กรอกภาค 2
  await call("admin", "PUT", `/api/roster/${kid.id}`, { grade_level: "ป.1", classroom: "2" }, { expect: 200 });
  const t2Items = d2.items.filter((i) => i.term_number === 2);
  await call("admin", "PUT", `/api/courses/${c2.id}/scores`, { changes: t2Items.map((i) => ({ item_id: i.id, student_id: kid.id, score: i.kind === "final" ? 10 : 30 })) }, { expect: 200 });
  const rep = (await call("admin", "GET", `/api/reports/room?grade=${encodeURIComponent("ป.1")}&room=2`, null, { expect: 200 })).data;
  const subj = rep.students.find((x) => x.id === kid.id).subjects.find((x) => x.code === "ท11101");
  assert.equal(subj.total, 80);
  assert.equal(subj.grade, "4");
});
