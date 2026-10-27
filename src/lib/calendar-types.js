// The server owns the category list and whether a date closes school.
export const CALENDAR_TYPES = [
  { value: "government", label: "วันหยุดราชการ", is_holiday: true },
  { value: "public", label: "วันหยุดนักขัตฤกษ์", is_holiday: true },
  { value: "cabinet", label: "วันหยุดตามมติ ครม.", is_holiday: true },
  { value: "holiday", label: "วันหยุด", is_holiday: true },
  { value: "festival", label: "วันเทศกาล", is_holiday: false },
  { value: "school_activity", label: "วันกิจกรรมโรงเรียน", is_holiday: false },
  { value: "school_activity_holiday", label: "วันหยุดกิจกรรมโรงเรียน", is_holiday: true },
];
export const calendarType = (value) => CALENDAR_TYPES.find((t) => t.value === value);
