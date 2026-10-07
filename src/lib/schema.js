// ตารางของระบบรายงานผลการเรียน — ขึ้นต้นด้วย gr_ ทั้งหมด เพื่อไม่ชนกับตารางเดิมของ banpadeng-school-db
// สร้างอัตโนมัติครั้งแรกที่ Worker ทำงาน (CREATE ... IF NOT EXISTS ไม่แตะข้อมูลเดิม)
// ตั้งใจไม่ใส่ FOREIGN KEY ไปยังตารางของระบบบริหารโรงเรียน (users, students, academic_years)
// เพื่อไม่ให้การลบผู้ใช้/นักเรียนในระบบนั้นล้มเหลวเพราะติดข้อมูลของระบบนี้

export const SCHEMA_VERSION = "gr-2";

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
  `CREATE TABLE IF NOT EXISTS gr_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, action TEXT NOT NULL, detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_gr_subjects_year ON gr_subjects(academic_year_id, grade_level)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_items_course ON gr_items(course_id, term_number, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_scores_student ON gr_scores(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_results_student ON gr_results(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_course_teachers_user ON gr_course_teachers(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_homerooms_user ON gr_homerooms(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_absences_year ON gr_absences(academic_year_id, student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_bank_lookup ON gr_indicator_bank(grade_level, learning_area)`,
];

// คอลัมน์ที่เพิ่มหลังเวอร์ชันแรก — เพิ่มเฉพาะที่ยังไม่มี (ALTER TABLE ADD COLUMN ไม่แตะข้อมูลเดิม)
export const ADDED_COLUMNS = [
  ["gr_settings", "indicator_pass_pct_t2", "INTEGER CHECK (indicator_pass_pct_t2 IS NULL OR indicator_pass_pct_t2 BETWEEN 0 AND 100)"], // เกณฑ์ผ่านรายตัวชี้วัดภาค 2 (ว่าง = ใช้ค่าภาค 1)
  ["gr_settings", "deputy_director_name", "TEXT"],
  ["gr_settings", "affiliation", "TEXT"],
  ["gr_settings", "pilot_rooms", "TEXT"], // JSON ["ป.4/2"] = เปิดใช้เฉพาะห้องเหล่านี้, ว่าง = ทุกห้อง
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
