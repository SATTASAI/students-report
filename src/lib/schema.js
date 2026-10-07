// ตารางของระบบรายงานผลการเรียน — ขึ้นต้นด้วย gr_ ทั้งหมด เพื่อไม่ชนกับตารางเดิมของ banpadeng-school-db
// สร้างอัตโนมัติครั้งแรกที่ Worker ทำงาน (CREATE ... IF NOT EXISTS ไม่แตะข้อมูลเดิม)
// ตั้งใจไม่ใส่ FOREIGN KEY ไปยังตารางของระบบบริหารโรงเรียน (users, students, academic_years)
// เพื่อไม่ให้การลบผู้ใช้/นักเรียนในระบบนั้นล้มเหลวเพราะติดข้อมูลของระบบนี้

export const SCHEMA_VERSION = "gr-8";

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS gr_settings (
    academic_year_id INTEGER PRIMARY KEY,
    collect_ratio INTEGER NOT NULL DEFAULT 70 CHECK (collect_ratio BETWEEN 0 AND 100),
    indicator_pass_pct INTEGER NOT NULL DEFAULT 50 CHECK (indicator_pass_pct BETWEEN 0 AND 100),
    attendance_pass_pct INTEGER NOT NULL DEFAULT 80 CHECK (attendance_pass_pct BETWEEN 0 AND 100),
    school_name TEXT, school_area TEXT, director_name TEXT, academic_head_name TEXT, measurement_head_name TEXT,
    entry_open INTEGER NOT NULL DEFAULT 1,
    roster_order TEXT NOT NULL DEFAULT 'gender' CHECK (roster_order IN ('gender','code')),
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS gr_staff_roles (
    user_id INTEGER PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('grade_admin')),
    granted_by INTEGER, granted_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS gr_subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL,
    grade_level TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    learning_area TEXT NOT NULL,
    subject_type TEXT NOT NULL DEFAULT 'basic' CHECK (subject_type IN ('basic','additional')),
    hours_per_year INTEGER NOT NULL DEFAULT 40 CHECK (hours_per_year BETWEEN 1 AND 400),
    collect_ratio INTEGER NOT NULL DEFAULT 70 CHECK (collect_ratio BETWEEN 0 AND 100),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (academic_year_id, grade_level, code))`,
  `CREATE TABLE IF NOT EXISTS gr_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES gr_subjects(id) ON DELETE CASCADE,
    classroom TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT, submitted_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (subject_id, classroom))`,
  `CREATE TABLE IF NOT EXISTS gr_course_teachers (
    course_id INTEGER NOT NULL REFERENCES gr_courses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (course_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS gr_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES gr_courses(id) ON DELETE CASCADE,
    term_number INTEGER NOT NULL CHECK (term_number IN (1,2)),
    kind TEXT NOT NULL CHECK (kind IN ('indicator','final')),
    code TEXT,
    title TEXT NOT NULL,
    max_score REAL NOT NULL CHECK (max_score > 0 AND max_score <= 1000),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  // หน่วยการเรียนรู้ของรายวิชา (ต่อภาค) — ตัวชี้วัดผูกกับหน่วยผ่าน gr_items.unit_id
  `CREATE TABLE IF NOT EXISTS gr_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES gr_courses(id) ON DELETE CASCADE,
    term_number INTEGER NOT NULL CHECK (term_number IN (1,2)),
    unit_no INTEGER NOT NULL CHECK (unit_no BETWEEN 1 AND 99),
    title TEXT NOT NULL,
    hours REAL CHECK (hours IS NULL OR (hours >= 0 AND hours <= 400)),
    task TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS gr_scores (
    item_id INTEGER NOT NULL REFERENCES gr_items(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL,
    score REAL,
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (item_id, student_id))`,
  `CREATE TABLE IF NOT EXISTS gr_results (
    course_id INTEGER NOT NULL REFERENCES gr_courses(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL,
    hours_attended REAL,
    special TEXT CHECK (special IN ('ร','มส') OR special IS NULL),
    special_note TEXT,
    remedial_type TEXT CHECK (remedial_type IN ('remedial','repeat') OR remedial_type IS NULL),
    remedial_grade TEXT, remedial_date TEXT, remedial_note TEXT,
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (course_id, student_id))`,
  `CREATE TABLE IF NOT EXISTS gr_indicator_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    learning_area TEXT NOT NULL,
    grade_level TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (grade_level, learning_area, code, title))`,
  `CREATE TABLE IF NOT EXISTS gr_homerooms (
    academic_year_id INTEGER NOT NULL,
    grade_level TEXT NOT NULL,
    classroom TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (academic_year_id, grade_level, classroom, user_id))`,
  `CREATE TABLE IF NOT EXISTS gr_assessments (
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, student_id, item_key))`,
  `CREATE TABLE IF NOT EXISTS gr_absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    absence_date TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'unknown' CHECK (reason IN ('sick','personal','unknown','other')),
    note TEXT,
    recorded_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (student_id, absence_date))`,
  // ความคิดเห็นครูประจำชั้นบน ปพ.6 (ต่อภาค, 4 ด้าน)
  `CREATE TABLE IF NOT EXISTS gr_comments (
    academic_year_id INTEGER NOT NULL,
    term_number INTEGER NOT NULL CHECK (term_number IN (1,2)),
    student_id INTEGER NOT NULL,
    field TEXT NOT NULL CHECK (field IN ('learn','habit','health','other')),
    body TEXT NOT NULL,
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, term_number, student_id, field))`,
  // คลังข้อความความคิดเห็นของครูแต่ละคน
  `CREATE TABLE IF NOT EXISTS gr_comment_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    field TEXT NOT NULL CHECK (field IN ('learn','habit','health','other')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, field, body))`,
  // น้ำหนัก/ส่วนสูง 4 ครั้งต่อปี
  `CREATE TABLE IF NOT EXISTS gr_body (
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
    weight REAL CHECK (weight IS NULL OR (weight > 0 AND weight < 200)),
    height REAL CHECK (height IS NULL OR (height > 30 AND height < 230)),
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, student_id, round))`,
  // gr-6: ประวัติย้ายเข้า/ย้ายออก/ออกกลางคัน (soft delete — ข้อมูลนักเรียนและคะแนนไม่ถูกลบ รับกลับด้วยเลขประจำตัวเดิม)
  `CREATE TABLE IF NOT EXISTS gr_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    reason TEXT NOT NULL CHECK (reason IN ('new','return','transfer','dropout')),
    term_number INTEGER NOT NULL CHECK (term_number IN (1,2)),
    move_date TEXT, school TEXT, note TEXT,
    grade_level TEXT, classroom TEXT,
    undone_at TEXT, undone_by INTEGER,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  // gr-6: คะแนนรายภาคที่ยกมาจาก ปพ.6 ของโรงเรียนเดิม (ครูประจำชั้นกรอก) — ใช้แทนช่องคะแนนของภาคนั้นทั้งภาค
  `CREATE TABLE IF NOT EXISTS gr_carryover (
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    subject_code TEXT NOT NULL,
    term_number INTEGER NOT NULL CHECK (term_number IN (1,2)),
    collect REAL, final REAL,
    total REAL NOT NULL CHECK (total >= 0 AND total <= 50),
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, student_id, subject_code, term_number))`,
  // gr-7: บันทึกการมาเรียนรายวัน (ครูประจำชั้น) — เก็บเฉพาะวันที่ไม่ได้มาเรียนปกติ: ข ขาด · ล ลากิจ · ป ลาป่วย · มส มาสาย
  `CREATE TABLE IF NOT EXISTS gr_attendance (
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    att_date TEXT NOT NULL,
    code TEXT NOT NULL CHECK (code IN ('ข','ล','ป','มส')),
    recorded_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (student_id, att_date))`,
  `CREATE INDEX IF NOT EXISTS idx_gr_attendance_year ON gr_attendance(academic_year_id, student_id, att_date)`,
  // ย้ายข้อมูลวันขาดเรียนแบบเดิม (gr_absences) มาเป็นรหัสใหม่ — ทำซ้ำได้ไม่ซ้ำข้อมูล
  `INSERT OR IGNORE INTO gr_attendance (academic_year_id, student_id, att_date, code, recorded_by)
     SELECT academic_year_id, student_id, absence_date, CASE reason WHEN 'sick' THEN 'ป' WHEN 'personal' THEN 'ล' ELSE 'ข' END, recorded_by FROM gr_absences`,
  // gr-8: วันหยุดของโรงเรียน (ฝ่ายวัดผลตั้ง) — ใช้ซ่อนวันในตารางมาเรียนและนับวันเรียนจริงเพื่อคิด มส
  `CREATE TABLE IF NOT EXISTS gr_holidays (
    academic_year_id INTEGER NOT NULL,
    holiday_date TEXT NOT NULL,
    name TEXT NOT NULL,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, holiday_date))`,
  // gr-8: เลขที่ที่ฝ่ายวัดผลกำหนดเอง (ว่าง = เรียงอัตโนมัติ)
  `CREATE TABLE IF NOT EXISTS gr_roster_numbers (
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 99),
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, student_id))`,
  // gr-8: ประวัติการแก้ไขรายวิชาที่ส่งผลแล้วโดยฝ่ายวัดผล (ครูผู้สอนเห็นในหน้ารายวิชา)
  `CREATE TABLE IF NOT EXISTS gr_course_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    what TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_gr_course_edits ON gr_course_edits(course_id, id)`,
  `CREATE TABLE IF NOT EXISTS gr_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, action TEXT NOT NULL, detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_gr_subjects_year ON gr_subjects(academic_year_id, grade_level)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_units_course ON gr_units(course_id, term_number, unit_no)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_items_course ON gr_items(course_id, term_number, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_scores_student ON gr_scores(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_results_student ON gr_results(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_course_teachers_user ON gr_course_teachers(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_homerooms_user ON gr_homerooms(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_absences_year ON gr_absences(academic_year_id, student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_transfers_year ON gr_transfers(academic_year_id, student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_bank_lookup ON gr_indicator_bank(grade_level, learning_area)`,
];

// คอลัมน์ที่เพิ่มหลังเวอร์ชันแรก — เพิ่มเฉพาะที่ยังไม่มี (ALTER TABLE ADD COLUMN ไม่แตะข้อมูลเดิม)
export const ADDED_COLUMNS = [
  ["gr_settings", "indicator_pass_pct_t2", "INTEGER CHECK (indicator_pass_pct_t2 IS NULL OR indicator_pass_pct_t2 BETWEEN 0 AND 100)"], // เกณฑ์ผ่านรายตัวชี้วัดภาค 2 (ว่าง = ใช้ค่าภาค 1)
  ["gr_settings", "deputy_director_name", "TEXT"],
  ["gr_settings", "affiliation", "TEXT"],
  ["gr_settings", "pilot_rooms", "TEXT"], // JSON ["ป.4/2"] = เปิดใช้เฉพาะห้องเหล่านี้, ว่าง = ทุกห้อง
  // gr-3
  ["gr_items", "unit_id", "INTEGER"], // หน่วยการเรียนรู้ (gr_units.id) ว่างได้
  ["gr_scores", "remedial", "REAL"], // คะแนนสอบแก้ตัวรายตัวชี้วัด (คะแนนจริง) — นับได้ไม่เกินเกณฑ์ผ่าน
  ["gr_subjects", "template", "TEXT"], // แม่แบบโครงสร้าง (JSON) ที่วิชาการตั้งให้ทุกห้องของวิชานี้
  ["gr_subjects", "template_updated_at", "TEXT"],
  // gr-4: ส่ง → ส่งคืน / อนุมัติ
  ["gr_courses", "approved_at", "TEXT"],
  ["gr_courses", "approved_by", "INTEGER"],
  ["gr_courses", "return_note", "TEXT"],
  ["gr_courses", "returned_at", "TEXT"],
  ["gr_courses", "returned_by", "INTEGER"],
  ["gr_settings", "school_address", "TEXT"],
  // gr-8: ครู → ฝ่ายวัดผลตรวจ → ผู้บริหารอนุมัติ
  ["gr_courses", "reviewed_at", "TEXT"],
  ["gr_courses", "reviewed_by", "INTEGER"], // บรรทัดที่อยู่บนปก ปพ.5 เช่น อำเภอแก่งกระจาน จังหวัดเพชรบุรี
];

async function addMissingColumns(env) {
  const tables = [...new Set(ADDED_COLUMNS.map((c) => c[0]))];
  for (const t of tables) {
    const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`).all();
    const have = new Set(results.map((r) => r.name));
    for (const [table, col, def] of ADDED_COLUMNS) {
      if (table === t && !have.has(col)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run();
    }
  }
}

const ensured = new WeakMap();

export async function ensureSchema(env) {
  if (ensured.has(env.DB)) return ensured.get(env.DB);
  const job = (async () => {
    const marker = await env.DB.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'students_report_schema'")
      .first().catch(() => null);
    if (marker?.setting_value === SCHEMA_VERSION) return;
    await env.DB.batch(SCHEMA_SQL.map((sql) => env.DB.prepare(sql)));
    await addMissingColumns(env);
    await env.DB.prepare(`INSERT INTO system_settings (setting_key, setting_value, updated_at)
      VALUES ('students_report_schema', ?, datetime('now'))
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')`)
      .bind(SCHEMA_VERSION).run();
  })().catch((err) => { ensured.delete(env.DB); throw err; });
  ensured.set(env.DB, job);
  return job;
}
