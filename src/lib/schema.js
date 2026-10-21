import BANK_2569 from "../data/indicator-bank-2569.js";
import BANK_2569_P13 from "../data/indicator-bank-2569-p13.js";
import BANK_2569_KINDER from "../data/indicator-bank-2569-kinder.js";
// ตารางของระบบรายงานผลการเรียน — ขึ้นต้นด้วย gr_ ทั้งหมด เพื่อไม่ชนกับตารางเดิมของ banpadeng-school-db
// สร้างอัตโนมัติครั้งแรกที่ Worker ทำงาน (CREATE ... IF NOT EXISTS ไม่แตะข้อมูลเดิม)
// ตั้งใจไม่ใส่ FOREIGN KEY ไปยังตารางของระบบบริหารโรงเรียน (users, students, academic_years)
// เพื่อไม่ให้การลบผู้ใช้/นักเรียนในระบบนั้นล้มเหลวเพราะติดข้อมูลของระบบนี้

export const SCHEMA_VERSION = "gr-20";

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
  // gr-20: พจนานุกรมของครูแต่ละคน (ตัวตรวจคำผิดในความคิดเห็น — คำที่ระบบไม่รู้จักแต่ถูกต้อง เช่น ชื่อเฉพาะ)
  `CREATE TABLE IF NOT EXISTS gr_spell_words (
    user_id INTEGER NOT NULL,
    word TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, word))`,
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
  // gr-7: บันทึกการมาเรียนรายวัน (ครูประจำชั้น) — เก็บเฉพาะวันที่ไม่ได้มาเรียนปกติ: ข ขาด · ล ลากิจ · ป ลาป่วย · ส มาสาย (gr-18: เดิมใช้ มส — มส สงวนไว้ให้ หมดสิทธิ์สอบ)
  `CREATE TABLE IF NOT EXISTS gr_attendance (
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    att_date TEXT NOT NULL,
    code TEXT NOT NULL CHECK (code IN ('ข','ล','ป','ส')),
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
  // gr-19: คำขอแก้ไขหลังปิดการกรอก/ส่งผลแล้ว — ครูขอ → ฝ่ายวัดผลอนุมัติ/ไม่อนุมัติ
  // scope 'course' = รายวิชา (course_id) · 'homeroom' = ข้อมูลครูประจำชั้นของห้อง (grade_level, classroom) เปิดให้แก้ถึง open_until
  `CREATE TABLE IF NOT EXISTS gr_edit_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('course','homeroom')),
    course_id INTEGER,
    grade_level TEXT, classroom TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','closed')),
    requested_by INTEGER NOT NULL, requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_by INTEGER, decided_at TEXT, decision_note TEXT,
    open_until TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_gr_edit_requests ON gr_edit_requests(academic_year_id, status, id)`,
  // gr-9: แบบบันทึกประจำวันของครูประจำชั้น — ดื่มนม แปรงฟัน อาหารกลางวัน เขตรับผิดชอบ (ติ๊กรายวัน, เก็บเฉพาะวันที่ติ๊ก value '1')
  // และตรวจสุขภาพ เล็บ/ฟัน/ผม/มือ สัปดาห์ละครั้ง 4 สัปดาห์ต่อเดือน (log_date = 'YYYY-MM-w1'..'w4', value 'ok' สะอาด / 'no' ไม่สะอาด)
  `CREATE TABLE IF NOT EXISTS gr_daily_logs (
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    log_type TEXT NOT NULL,
    log_date TEXT NOT NULL,
    value TEXT NOT NULL,
    recorded_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (student_id, log_type, log_date))`,
  `CREATE INDEX IF NOT EXISTS idx_gr_daily_logs ON gr_daily_logs(academic_year_id, log_type, log_date)`,
  // gr-10: วันหยุดราชการที่ระบบใส่ให้อัตโนมัติต่อปีการศึกษา (จำไว้ว่าเคยใส่แล้ว — ฝ่ายวัดผลลบวันไหนออก ระบบจะไม่ใส่กลับเอง)
  `CREATE TABLE IF NOT EXISTS gr_holiday_seeds (
    academic_year_id INTEGER NOT NULL,
    holiday_date TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, holiday_date))`,
  // gr-11: SAR มาตรฐานที่ 1 — ค่าเป้าหมาย / ผลที่ครูกรอกเอง (ประเด็นที่ระบบไม่มีข้อมูล) / หมายเหตุ ต่อประเด็น ต่อปี · item_key '_levels' = เกณฑ์ระดับคุณภาพ (JSON ใน note)
  `CREATE TABLE IF NOT EXISTS gr_sar_values (
    academic_year_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    target REAL, manual_value REAL, note TEXT,
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, item_key))`,
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
  // gr-17: ประเมินพัฒนาการอนุบาล — รายข้อความสามารถผู้เรียน × ภาคเรียน × ครั้งที่ (1–3: ควรส่งเสริม/พอใช้/ดี)
  `CREATE TABLE IF NOT EXISTS gr_kinder_scores (
    academic_year_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    item_code TEXT NOT NULL,
    term_number INTEGER NOT NULL CHECK (term_number IN (1,2)),
    round INTEGER NOT NULL CHECK (round IN (1,2)),
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 3),
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, student_id, item_code, term_number, round))`,
  `CREATE TABLE IF NOT EXISTS gr_kinder_comments (
    academic_year_id INTEGER NOT NULL,
    term_number INTEGER NOT NULL CHECK (term_number IN (1,2)),
    student_id INTEGER NOT NULL,
    field TEXT NOT NULL CHECK (field IN ('d1','d2','d3','d4','other')),
    body TEXT NOT NULL,
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (academic_year_id, term_number, student_id, field))`,
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
  // gr-12: คลังตัวชี้วัดผูกกับรายวิชา (ว่าง = ใช้ได้ทุกวิชาของกลุ่มสาระ) + ประเภท ระหว่างทาง/ปลายทาง/ผลการเรียนรู้
  ["gr_indicator_bank", "subject_code", "TEXT"],
  ["gr_indicator_bank", "kind", "TEXT"],
  // gr-15: สอบปลายภาควัดตัวชี้วัดปลายทางข้อใดบ้าง (JSON [{code, title}])
  ["gr_items", "indicators", "TEXT"],
  // gr-19: ฝ่ายวัดผลอนุมัติคำขอแก้ไข → ครูแก้รายวิชานี้ได้แม้ปิดการกรอกแล้ว จนกว่าจะส่งผลใหม่
  ["gr_courses", "edit_granted_at", "TEXT"],
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

// gr-13: ตัวชี้วัด ป.4–6 จากหลักสูตรสถานศึกษา 2569 ใส่คลังครั้งเดียว (มีตัวบอกแยก — ถ้าฝ่ายวัดผลลบบางข้อทีหลัง จะไม่กลับมาอีก)
// gr-14: ผลลัพธ์การเรียนรู้ ป.1–3 (หลักสูตรประถมศึกษาตอนต้น 2569) — ตัวบอกแยกจากชุด ป.4–6
// gr-16: ความสามารถผู้เรียนเมื่อจบชั้นปี อ.1–อ.3 (หลักสูตรปฐมวัย 2569)
const SEEDS = [["students_report_seed_bank_2569", BANK_2569], ["students_report_seed_bank_2569_p13", BANK_2569_P13], ["students_report_seed_bank_2569_kinder", BANK_2569_KINDER]];
export async function seedIndicatorBank(env) {
  for (const [key, data] of SEEDS) await seedOne(env, key, data);
}
async function seedOne(env, KEY, BANK) {
  const done = await env.DB.prepare("SELECT 1 AS ok FROM system_settings WHERE setting_key = ?").bind(KEY).first().catch(() => null);
  if (done) return;
  const stmts = BANK.rows.map(([grade, area, code, title, subject, kind]) => env.DB.prepare(
    "INSERT OR IGNORE INTO gr_indicator_bank (learning_area, grade_level, code, title, subject_code, kind) VALUES (?,?,?,?,?,?)").bind(area, grade, code, title, subject, kind));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  await env.DB.prepare("INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(setting_key) DO NOTHING")
    .bind(KEY, String(BANK.rows.length)).run();
}

// gr-18: รหัสมาสายเปลี่ยนจาก "มส" เป็น "ส" (มส ใช้เฉพาะ หมดสิทธิ์สอบ) — SQLite แก้ CHECK ไม่ได้ จึงสร้างตารางใหม่แล้วย้ายข้อมูล
// ทำครั้งเดียว (ดูจาก CHECK ของตารางเดิม) ทั้งหมดใน batch เดียว ผิดพลาดข้อมูลเดิมยังอยู่ครบ
export async function migrateLateCode(env) {
  const row = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'gr_attendance'").first();
  if (!row?.sql || !row.sql.includes("'มส'")) return;
  await env.DB.batch([
    `DROP TABLE IF EXISTS gr_attendance_v18`,
    `CREATE TABLE gr_attendance_v18 (
      academic_year_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      att_date TEXT NOT NULL,
      code TEXT NOT NULL CHECK (code IN ('ข','ล','ป','ส')),
      recorded_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (student_id, att_date))`,
    `INSERT INTO gr_attendance_v18 (academic_year_id, student_id, att_date, code, recorded_by, updated_at)
       SELECT academic_year_id, student_id, att_date, CASE code WHEN 'มส' THEN 'ส' ELSE code END, recorded_by, updated_at FROM gr_attendance`,
    `DROP TABLE gr_attendance`,
    `ALTER TABLE gr_attendance_v18 RENAME TO gr_attendance`,
    `CREATE INDEX IF NOT EXISTS idx_gr_attendance_year ON gr_attendance(academic_year_id, student_id, att_date)`,
  ].map((sql) => env.DB.prepare(sql)));
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
    await migrateLateCode(env);
    await seedIndicatorBank(env);
    await env.DB.prepare(`INSERT INTO system_settings (setting_key, setting_value, updated_at)
      VALUES ('students_report_schema', ?, datetime('now'))
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')`)
      .bind(SCHEMA_VERSION).run();
  })().catch((err) => { ensured.delete(env.DB); throw err; });
  ensured.set(env.DB, job);
  return job;
}
