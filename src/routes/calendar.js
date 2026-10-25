// ปฏิทินวันหยุดของโรงเรียน (ฝ่ายวัดผลตั้ง) — ใช้ซ่อนวันหยุดในตารางมาเรียน และนับวันเรียนจริงเพื่อคิดร้อยละการมาเรียน / มส
// ช่วงภาคเรียน (วันเปิด–ปิด) มาจาก academic_terms ของระบบบริหารโรงเรียน
import { json, readJson, fail, requireAdmin, requireUser, text, audit, batchAll } from "../lib/http.js";
import { resolveYear, schoolCalendar, ensureGovernmentHolidays } from "../lib/data.js";
import { logLockedCourses } from "../lib/edit-requests.js";

const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export async function handleCalendar(request, env, user, parts, method, url) {
  requireUser(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  if (method === "GET") {
    // ดูได้: ฝ่ายวิชาการ/วัดผล และครูประจำชั้น (ครูประจำชั้นดูอย่างเดียว แก้ไม่ได้)
    if (!user.can_view_all) {
      const hr = await env.DB.prepare("SELECT 1 AS ok FROM gr_homerooms WHERE academic_year_id = ? AND user_id = ? LIMIT 1").bind(year.id, user.id).first();
      if (!hr) fail(403, "ปฏิทินวันหยุดดูได้เฉพาะครูประจำชั้นและฝ่ายวัดผล");
    }
    const cal = await schoolCalendar(env, year.id);
    return json({ year, terms: cal.terms, holidays: cal.holidays, school_days: cal.days.length, can_edit: !!(user.is_admin && user.can_import) });
  }
  requireAdmin(user);
  if (!user.can_import) fail(403, "ตั้งปฏิทินได้เฉพาะผู้ดูแลระบบและทีมวัดและประเมินผล");
  // เติมวันหยุดราชการที่ยังไม่มี (รวมวันที่เคยลบออก) — ไม่ทับชื่อวันหยุดที่ตั้งไว้แล้ว
  if (method === "POST" && parts[2] === "government") {
    const added = await ensureGovernmentHolidays(env, year.id, { force: true });
    await audit(env, user, "calendar.government", { year: year.id, added });
    if (added) await logLockedCourses(env, user, year.id, null, "ฝ่ายวัดผลแก้ปฏิทินวันหยุด", `เติมวันหยุดราชการ ${added} วัน — ร้อยละมาเรียน/มส อาจเปลี่ยน`);
    return json({ ok: true, added });
  }
  if (method === "POST") {
    const b = await readJson(request);
    const name = text(b.name, 120);
    if (!name) fail(400, "กรอกชื่อวันหยุด");
    const from = b.from, to = b.to || b.from;
    if (!validDate(from) || !validDate(to) || to < from) fail(400, "วันที่ไม่ถูกต้อง");
    const dates = [];
    for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to && dates.length <= 120; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay();
      if ((wd !== 0 && wd !== 6) || from === to) dates.push(d.toISOString().slice(0, 10)); // วันเดียว (เช่น แก้ชื่อวันหยุดราชการที่ตรงเสาร์–อาทิตย์) ใส่ได้
    }
    if (!dates.length) fail(400, "ช่วงวันที่ไม่มีวันจันทร์–ศุกร์");
    if (dates.length > 120) fail(400, "เพิ่มได้ครั้งละไม่เกิน 120 วัน");
    // วันหยุดไม่ใช่วันเรียน — ล้างบันทึกขาด/ลาของวันนั้น (ถ้าครูเผลอใส่ไว้)
    await batchAll(env, dates.flatMap((d) => [
      env.DB.prepare(`INSERT INTO gr_holidays (academic_year_id, holiday_date, name, created_by) VALUES (?,?,?,?)
        ON CONFLICT(academic_year_id, holiday_date) DO UPDATE SET name = excluded.name`).bind(year.id, d, name, user.id),
      env.DB.prepare("DELETE FROM gr_attendance WHERE academic_year_id = ? AND att_date = ?").bind(year.id, d),
      env.DB.prepare("DELETE FROM gr_daily_logs WHERE academic_year_id = ? AND log_date = ?").bind(year.id, d),
    ]));
    await audit(env, user, "calendar.add", { year: year.id, from, to, name, days: dates.length });
    await logLockedCourses(env, user, year.id, null, "ฝ่ายวัดผลแก้ปฏิทินวันหยุด", `เพิ่มวันหยุด "${name}" ${from}${to !== from ? ` ถึง ${to}` : ""} — ร้อยละมาเรียน/มส อาจเปลี่ยน`);
    return json({ ok: true, added: dates.length });
  }
  if (method === "DELETE" && parts[2]) {
    const d = parts[2];
    if (!validDate(d)) fail(400, "วันที่ไม่ถูกต้อง");
    await env.DB.prepare("DELETE FROM gr_holidays WHERE academic_year_id = ? AND holiday_date = ?").bind(year.id, d).run();
    await audit(env, user, "calendar.delete", { year: year.id, date: d });
    await logLockedCourses(env, user, year.id, null, "ฝ่ายวัดผลแก้ปฏิทินวันหยุด", `ลบวันหยุด ${d} — ร้อยละมาเรียน/มส อาจเปลี่ยน`);
    return json({ ok: true });
  }
  fail(405, "ไม่รองรับ");
}
