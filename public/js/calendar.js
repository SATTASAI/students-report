// ปฏิทินวันหยุดสำหรับครูประจำชั้น — ดูอย่างเดียว (ฝ่ายวัดผลแก้ไขที่ admin.html#calendar)
import { shell, esc } from "/js/app.js";
import { renderHolidayCalendar } from "/js/holiday-calendar.js";

const me = await shell("calendar");
const view = document.getElementById("view");
document.getElementById("main").hidden = false;
document.getElementById("yearLine").textContent = `ปีการศึกษา ${me.year.year_be} · กำหนดโดยฝ่ายวัดผล`;
const render = () => renderHolidayCalendar(view, `year=${me.year.id}`, render)
  .catch((err) => { view.innerHTML = `<div class="panel empty"><strong>เปิดปฏิทินไม่ได้</strong>${esc(err.message)}</div>`; });
render();
