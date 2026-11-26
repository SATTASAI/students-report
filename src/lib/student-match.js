// จับคู่แถวในไฟล์ (เช่น DMC) กับนักเรียนในทะเบียน — ตรวจหลายช่อง ไม่จับคู่จากช่องเดียว
// อัตโนมัติได้เมื่อ "ตรงกัน ≥ 3 ช่อง และไม่มีช่องไหนขัดกัน" (คำสั่งผู้ใช้ 26 พ.ย. 2569) นอกนั้นให้ผู้ดูแลตรวจ
// และต้องมีช่องระบุตัวตนอย่างน้อย 1 ช่อง (เลขประจำตัว/เลขบัตร/ชื่อ) — เพศ+ชั้น+วันเกิดอย่างเดียวซ้ำกันได้หลายคน
// ช่องที่ตรวจ: เลขประจำตัว, เลขประจำตัวประชาชน, ชื่อ–นามสกุล, วันเกิด, เพศ, ชั้นที่เป็นไปได้

export const MATCH_FIELDS = { code: "เลขประจำตัว", nid: "เลขประจำตัวประชาชน", name: "ชื่อ–นามสกุล", birth: "วันเกิด", gender: "เพศ", grade: "ชั้น" };
export const MIN_MATCHED = 3;

const GRADE_ORDER = ["อ.1", "อ.2", "อ.3", "ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];
export function gradeIndex(value) {
  const m = String(value ?? "").replace(/\s+/g, "").match(/^(อ|ป)\.?(\d)/);
  return m ? GRADE_ORDER.indexOf(`${m[1]}.${m[2]}`) : -1;
}
const PREFIX_RE = /^(เด็กชาย|เด็กหญิง|ด\.\s?ช\.|ด\.\s?ญ\.|นางสาว|น\.ส\.|นาย|นาง)\s*/;
export const nameKey = (first, last) => `${String(first ?? "").trim().replace(PREFIX_RE, "")}${String(last ?? "").trim()}`.replace(/[\s.]+/g, "").toLowerCase();
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const genderOf = (v) => { const t = String(v ?? "").trim(); return /^(ช|ชาย|m|เด็กชาย|ด\.ช)/i.test(t) ? "ช" : /^(ญ|หญิง|f|เด็กหญิง|ด\.ญ)/i.test(t) ? "ญ" : ""; };

export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = [...a], y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

// file: {code, nid, first, last, birth, gender, grade} · cand: แถวจาก students (+ gender จาก student_details)
// gradeShifts: ผลต่างชั้น (ไฟล์ − ทะเบียน) ที่ถือว่าเป็นไปได้ เช่น [0, 1] = ชั้นเดิมหรือเลื่อนชั้น
export function compareStudent(file, cand, { gradeShifts = [0, 1] } = {}) {
  const matched = [], conflicts = [];
  const check = (key, a, b, same = (p, q) => p === q) => {
    if (!a || !b) return;
    (same(a, b) ? matched : conflicts).push(key);
  };
  check("code", String(file.code ?? "").trim(), String(cand.student_code ?? "").trim());
  check("nid", digits(file.nid).length === 13 ? digits(file.nid) : "", digits(cand.national_id).length === 13 ? digits(cand.national_id) : "");
  const fn = nameKey(file.first, file.last), cn = nameKey(cand.first_name ?? cand.full_name, cand.first_name ? cand.last_name : "");
  if (fn && cn) {
    const s = similarity(fn, cn);
    if (s === 1) matched.push("name");
    else if (s < 0.85) conflicts.push("name"); // สะกดต่างเล็กน้อย = ไม่นับทั้งตรงและขัด
  }
  check("birth", String(file.birth ?? "").trim().slice(0, 10), String(cand.birth_date ?? "").trim().slice(0, 10));
  check("gender", genderOf(file.gender), genderOf(cand.gender));
  const fg = gradeIndex(file.grade), cg = gradeIndex(cand.grade_level);
  if (fg >= 0 && cg >= 0) (gradeShifts.includes(fg - cg) ? matched : conflicts).push("grade");
  const strong = matched.some((f) => ["code", "nid", "name"].includes(f));
  return { matched, conflicts, auto: matched.length >= MIN_MATCHED && !conflicts.length && strong };
}

// หา candidate ทั้งหมดของแถว (เลขประจำตัว / เลขบัตร / ชื่อตรงกัน) แล้วตัดสิน
// คืน { decision: 'existing'|'new'|'review', student?, candidates:[{...cand, matched, conflicts}] }
export function decideStudent(file, students, opts) {
  const code = String(file.code ?? "").trim(), nid = digits(file.nid), key = nameKey(file.first, file.last);
  const cands = students.filter((s) => (code && String(s.student_code ?? "").trim() === code)
    || (nid.length === 13 && digits(s.national_id) === nid)
    || (key && nameKey(s.first_name ?? s.full_name, s.first_name ? s.last_name : "") === key));
  if (!cands.length) return { decision: "new", candidates: [] };
  const scored = cands.map((s) => ({ ...s, ...compareStudent(file, s, opts) }));
  const auto = scored.filter((s) => s.auto);
  if (auto.length === 1) return { decision: "existing", student: auto[0], candidates: scored };
  return { decision: "review", candidates: scored };
}

// รายการรอผู้ดูแลตรวจ (ตารางของระบบเกรด)
const ready = new WeakSet();
export async function ensureMatchReviews(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS gr_student_match_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, academic_year_id INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'roster_import',
    row_key TEXT NOT NULL, payload TEXT NOT NULL, candidates TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','created','dismissed')),
    resolved_student_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_by INTEGER, resolved_at TEXT)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_gr_student_match_reviews_status ON gr_student_match_reviews(status, academic_year_id)").run();
  ready.add(env.DB);
}
