import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";

const ORIGIN = "http://school.test";
async function setup() {
  const env = await makeEnv();
  const r = await worker.fetch(new Request(ORIGIN + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "admin@test.local", password: PASSWORD }) }), env);
  const cookie = r.headers.get("Set-Cookie").split(";")[0];
  const call = async (method, path, body) => {
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    const data = await res.json().catch(() => null);
    assert.ok(res.status < 300, `${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  return { env, call };
}

test("รายวิชาที่เพิ่มในหน้ารายวิชา ขึ้นในหน้าครูผู้สอนทุกห้องของชั้นทันที", async () => {
  const { call } = await setup();
  const { rooms } = await call("GET", "/api/admin/rooms?year=1");
  const p4 = rooms.filter((r) => r.grade_level === "ป.4");
  assert.ok(p4.length > 0);
  const { id } = await call("POST", "/api/admin/subjects", { year: 1, grade_level: "ป.4", code: "ส14299", name: "วิชาทดสอบลิงก์", learning_area: "สังคมศึกษา ศาสนาและวัฒนธรรม", subject_type: "additional", hours_per_year: 40, collect_ratio: 70, sort_order: 999 });
  const { courses } = await call("GET", "/api/admin/courses?year=1");
  const mine = courses.filter((c) => c.subject_id === id);
  assert.deepEqual(mine.map((c) => c.classroom).sort(), p4.map((r) => r.classroom).sort());
  const { subjects } = await call("GET", "/api/admin/subjects?year=1");
  assert.equal(subjects.find((s) => s.id === id).course_count, p4.length);
  // แก้ชื่อในหน้ารายวิชา → หน้าครูผู้สอนเห็นชื่อใหม่
  await call("PUT", `/api/admin/subjects/${id}`, { grade_level: "ป.4", code: "ส14299", name: "ชื่อใหม่", learning_area: "สังคมศึกษา ศาสนาและวัฒนธรรม", subject_type: "additional", hours_per_year: 40, collect_ratio: 70, sort_order: 999 });
  const after = (await call("GET", "/api/admin/courses?year=1")).courses.filter((c) => c.subject_id === id);
  assert.ok(after.every((c) => c.name === "ชื่อใหม่"));
  // ลบรายวิชา → หายจากหน้าครูผู้สอน
  await call("DELETE", `/api/admin/subjects/${id}`);
  assert.equal((await call("GET", "/api/admin/courses?year=1")).courses.filter((c) => c.subject_id === id).length, 0);
});
