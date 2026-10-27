// Calendar-only events live separately from the shared holiday table, so attendance,
// daily logs, reports and other systems reading gr_holidays see actual holidays only.
import { json, readJson, fail, requireAdmin, requireUser, text, audit, batchAll } from "../lib/http.js";
import { resolveYear, schoolCalendar, ensureGovernmentHolidays, yearWindow } from "../lib/data.js";
import { importantDaysBetween } from "../lib/thai-observances.js";
import { logLockedCourses } from "../lib/edit-requests.js";
import { CALENDAR_TYPES, calendarType } from "../lib/calendar-types.js";

const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export async function handleCalendar(request, env, user, parts, method, url) {
  requireUser(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  if (method === "GET" && !parts[2]) {
    if (!user.can_view_all) {
      const hr = await env.DB.prepare("SELECT 1 AS ok FROM gr_homerooms WHERE academic_year_id = ? AND user_id = ? LIMIT 1").bind(year.id, user.id).first();
      if (!hr) fail(403, "ปฏิทินดูได้เฉพาะครูประจำชั้นและฝ่ายวัดผล");
    }
    const cal = await schoolCalendar(env, year.id);
    const window = await yearWindow(env, year.id);
    const important_days = window ? importantDaysBetween(window.from, window.to) : [];
    const { results: events } = await env.DB.prepare("SELECT id, event_date, name, category, description FROM gr_calendar_events WHERE academic_year_id = ? ORDER BY event_date, id").bind(year.id).all();
    return json({ year, terms: cal.terms, holidays: cal.holidays, events, types: CALENDAR_TYPES, important_days, school_days: cal.days.length, can_edit: !!(user.is_admin && user.can_import) });
  }
  requireAdmin(user);
  if (!user.can_import) fail(403, "ตั้งปฏิทินได้เฉพาะผู้ดูแลระบบและทีมวัดและประเมินผล");
  if (method === "POST" && parts[2] === "government" && !parts[3]) {
    const added = await ensureGovernmentHolidays(env, year.id, { force: true });
    await audit(env, user, "calendar.government", { year: year.id, added });
    if (added) await logLockedCourses(env, user, year.id, null, "ฝ่ายวัดผลแก้ปฏิทินวันหยุด", `เติมวันหยุดราชการ ${added} วัน — ร้อยละมาเรียน/มส อาจเปลี่ยน`);
    return json({ ok: true, added });
  }
  if (method === "POST" && !parts[2]) {
    const b = await readJson(request);
    const name = text(b.name, 120), description = text(b.description, 2000);
    const type = calendarType(b.category ?? "holiday");
    if (!type) fail(400, "ประเภทปฏิทินไม่ถูกต้อง");
    if (!name) fail(400, "กรอกชื่อรายการ");
    const from = b.from, to = b.to || b.from;
    if (!validDate(from) || !validDate(to) || to < from) fail(400, "วันที่ไม่ถูกต้อง");
    // Bound the actual range too: calendar-only events include weekends.
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 180) fail(400, "ช่วงวันที่ยาวเกิน 180 วัน");
    const eventId = b.event_id;
    if (eventId != null && (!Number.isSafeInteger(eventId) || eventId <= 0 || from !== to || b.replace_holiday)) fail(400, "รายการที่แก้ไขไม่ถูกต้อง");
    if (b.replace_holiday != null && typeof b.replace_holiday !== "boolean") fail(400, "รายการที่แก้ไขไม่ถูกต้อง");
    if (eventId != null && !(await env.DB.prepare("SELECT id FROM gr_calendar_events WHERE academic_year_id = ? AND id = ?").bind(year.id, eventId).first())) fail(404, "ไม่พบรายการปฏิทิน");
    const dates = [];
    for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay();
      if ((!type.is_holiday && !b.replace_holiday) || (wd !== 0 && wd !== 6) || from === to) dates.push(d.toISOString().slice(0, 10));
    }
    if (!dates.length) fail(400, "ช่วงวันที่ไม่มีวันจันทร์–ศุกร์");
    if (dates.length > 120) fail(400, "เพิ่มได้ครั้งละไม่เกิน 120 วัน");
    const stmts = [];
    if (eventId != null) stmts.push(env.DB.prepare("DELETE FROM gr_calendar_events WHERE academic_year_id = ? AND id = ?").bind(year.id, eventId));
    if (b.replace_holiday) {
      // Check every original date before converting a group; never partially convert.
      const { results: old } = await env.DB.prepare("SELECT holiday_date FROM gr_holidays WHERE academic_year_id = ? AND holiday_date >= ? AND holiday_date <= ?").bind(year.id, from, to).all();
      if (dates.some((d) => !old.some((h) => h.holiday_date === d))) fail(409, "รายการวันหยุดเปลี่ยนไปแล้ว กรุณาโหลดปฏิทินใหม่");
      for (const d of dates) stmts.push(env.DB.prepare("DELETE FROM gr_holidays WHERE academic_year_id = ? AND holiday_date = ?").bind(year.id, d));
    }
    for (const d of dates) {
      if (type.is_holiday) stmts.push(
        env.DB.prepare(`INSERT INTO gr_holidays (academic_year_id, holiday_date, name, category, description, created_by) VALUES (?,?,?,?,?,?)
          ON CONFLICT(academic_year_id, holiday_date) DO UPDATE SET name = excluded.name, category = excluded.category, description = excluded.description`).bind(year.id, d, name, type.value, description, user.id),
        env.DB.prepare("DELETE FROM gr_attendance WHERE academic_year_id = ? AND att_date = ?").bind(year.id, d),
        env.DB.prepare("DELETE FROM gr_daily_logs WHERE academic_year_id = ? AND log_date = ?").bind(year.id, d),
      );
      else stmts.push(env.DB.prepare(`INSERT INTO gr_calendar_events (academic_year_id, event_date, name, category, description, created_by) VALUES (?,?,?,?,?,?)
        ON CONFLICT(academic_year_id, event_date, category, name) DO UPDATE SET description = excluded.description`).bind(year.id, d, name, type.value, description, user.id));
    }
    // At most 481 statements: batchAll commits the whole change atomically.
    await batchAll(env, stmts);
    await audit(env, user, "calendar.add", { year: year.id, from, to, name, category: type.value, description, days: dates.length, event_id: eventId, replace_holiday: !!b.replace_holiday });
    if (type.is_holiday || b.replace_holiday) await logLockedCourses(env, user, year.id, null, "ฝ่ายวัดผลแก้ปฏิทินวันหยุด", `แก้ปฏิทิน "${name}" ${from}${to !== from ? ` ถึง ${to}` : ""} (${type.label}) — ร้อยละมาเรียน/มส อาจเปลี่ยน`);
    return json({ ok: true, added: dates.length, is_holiday: type.is_holiday });
  }
  if (method === "DELETE" && parts[2] === "events" && /^[1-9]\d*$/.test(parts[3] || "") && !parts[4]) {
    await env.DB.prepare("DELETE FROM gr_calendar_events WHERE academic_year_id = ? AND id = ?").bind(year.id, Number(parts[3])).run();
    await audit(env, user, "calendar.event.delete", { year: year.id, id: Number(parts[3]) });
    return json({ ok: true });
  }
  if (method === "DELETE" && validDate(parts[2]) && !parts[3]) {
    const d = parts[2];
    await env.DB.prepare("DELETE FROM gr_holidays WHERE academic_year_id = ? AND holiday_date = ?").bind(year.id, d).run();
    await audit(env, user, "calendar.delete", { year: year.id, date: d });
    await logLockedCourses(env, user, year.id, null, "ฝ่ายวัดผลแก้ปฏิทินวันหยุด", `ลบวันหยุด ${d} — ร้อยละมาเรียน/มส อาจเปลี่ยน`);
    return json({ ok: true });
  }
  fail(405, "ไม่รองรับ");
}
