// ปฏิทินวันหยุดของโรงเรียน (ฝ่ายวัดผลตั้ง) — ใช้ซ่อนวันหยุดในตารางมาเรียน และนับวันเรียนจริงเพื่อคิดร้อยละการมาเรียน / มส
// ช่วงภาคเรียน (วันเปิด–ปิด) มาจาก academic_terms ของระบบบริหารโรงเรียน
import { json, readJson, fail, requireAdmin, text, audit, batchAll } from "../lib/http.js";
import { resolveYear, schoolCalendar } from "../lib/data.js";

const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export async function handleCalendar(request, env, user, parts, method, url) {
  requireAdmin(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  if (method === "GET") {
    const cal = await schoolCalendar(env, year.id);
    return json({ year, terms: cal.terms, holidays: cal.holidays, school_days: cal.days.length });
  }
  if (!user.can_import) fail(403, "ตั้งปฏิทินได้เฉพาะผู้ดูแลระบบและทีมวัดและประเมินผล");
  if (method === "POST") {
    const b = await readJson(request);
    const name = text(b.name, 120);
    if (!name) fail(400, "กรอกชื่อวันหยุด");
    const from = b.from, to = b.to || b.from;
    if (!validDate(from) || !validDate(to) || to < from) fail(400, "วันที่ไม่ถูกต้อง");
    const dates = [];
    for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to && dates.length <= 120; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) dates.push(d.toISOString().slice(0, 10));
    }
    if (!dates.length) fail(400, "ช่วงวันที่ไม่มีวันจันทร์–ศุกร์");
    if (dates.length > 120) fail(400, "เพิ่มได้ครั้งละไม่เกิน 120 วัน");
    // วันหยุดไม่ใช่วันเรียน — ล้างบันทึกขาด/ลาของวันนั้น (ถ้าครูเผลอใส่ไว้)
    await batchAll(env, dates.flatMap((d) => [
      env.DB.prepare(`INSERT INTO gr_holidays (academic_year_id, holiday_date, name, created_by) VALUES (?,?,?,?)
        ON CONFLICT(academic_year_id, holiday_date) DO UPDATE SET name = excluded.name`).bind(year.id, d, name, user.id),
      env.DB.prepare("DELETE FROM gr_attendance WHERE academic_year_id = ? AND att_date = ?").bind(year.id, d),
    ]));
    await audit(env, user, "calendar.add", { year: year.id, from, to, name, days: dates.length });
    return json({ ok: true, added: dates.length });
  }
  if (method === "DELETE" && parts[2]) {
    const d = parts[2];
    if (!validDate(d)) fail(400, "วันที่ไม่ถูกต้อง");
    await env.DB.prepare("DELETE FROM gr_holidays WHERE academic_year_id = ? AND holiday_date = ?").bind(year.id, d).run();
    await audit(env, user, "calendar.delete", { year: year.id, date: d });
    return json({ ok: true });
  }
  fail(405, "ไม่รองรับ");
}
