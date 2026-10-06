// ข้อมูลจำลองสำหรับทดสอบ — ชื่อสมมติทั้งหมด
import { generateSalt, hashPassword } from "../src/lib/crypto.js";

export const PASSWORD = "test-password-1";

export async function seed(d1) {
  const salt = generateSalt();
  const hash = await hashPassword(PASSWORD, salt);
  const users = [
    [1, "admin@test.local", "ผู้บริหาร ทดสอบ", "superadmin"],
    [2, "teacher1@test.local", "ครูสมใจ ใจดี", "teacher"],
    [3, "teacher2@test.local", "ครูมานะ ขยันสอน", "teacher"],
    [4, "pending@test.local", "ครูใหม่ รอสิทธิ์", null],
    [5, "teacher3@test.local", "ครูปิติ ยิ้มแย้ม", "teacher"],
  ];
  for (const [id, email, name, role] of users) {
    await d1.prepare("INSERT INTO users (id, email, password_hash, password_salt, full_name, role) VALUES (?,?,?,?,?,?)").bind(id, email, hash, salt, name, role).run();
  }
  d1.exec(`INSERT INTO academic_years (id, year_be, label, start_date, end_date, status) VALUES (1, 2569, 'ปีการศึกษา 2569', '2026-05-01', '2027-03-31', 'active');
    INSERT INTO academic_terms (id, academic_year_id, term_number, name, start_date, end_date, status) VALUES
      (1, 1, 1, 'ภาคเรียนที่ 1', '2026-05-01', '2026-10-10', 'active'), (2, 1, 2, 'ภาคเรียนที่ 2', '2026-11-01', '2027-03-31', 'planned');
    INSERT INTO system_settings (setting_key, setting_value) VALUES ('dummy', '1');`);
  const firsts = ["ก้องภพ", "ขวัญใจ", "จิราพร", "ชยพล", "ณัฐวุฒิ", "ดวงใจ", "ธนพร", "นภัส", "ปกรณ์", "พิมพ์ชนก", "ภูมิพัฒน์", "มณีรัตน์", "รัชนก", "วรเมธ", "ศศิธร", "สุรเชษฐ์", "อนันดา", "อรุณี", "กิตติพัฒน์", "ปภาวรินทร์"];
  const lasts = ["แสงทอง", "ศรีสุข", "บุญมา", "ทองดี", "ใจงาม", "พรหมมา", "สายบุญ", "คำแก้ว"];
  let sid = 1;
  const rooms = [["อ.3", "1", 6], ["ป.1", "1", 12], ["ป.1", "2", 10], ["ป.4", "1", 14], ["ป.6", "1", 8]];
  for (const [grade, room, n] of rooms) {
    for (let i = 0; i < n; i++) {
      const male = i % 2 === 0;
      const code = String(10000 + sid);
      await d1.prepare(`INSERT INTO students (id, student_code, full_name, classroom, grade_level, name_prefix, first_name, last_name, national_id, birth_date)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(sid, code, "x", room, grade, male ? "เด็กชาย" : "เด็กหญิง",
        firsts[(sid * 7) % firsts.length], lasts[sid % lasts.length], `1${String(500000000000 + sid)}`, "2017-06-15").run();
      await d1.prepare("UPDATE students SET full_name = name_prefix || first_name || ' ' || last_name WHERE id = ?").bind(sid).run();
      await d1.prepare(`INSERT INTO student_details (student_id, gender, guardian_prefix, guardian_first_name, guardian_last_name, guardian_relationship, house_number, village_no, subdistrict, district, province)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(sid, male ? "ช" : "ญ", "นาง", "ผู้ปกครอง", lasts[sid % lasts.length], "มารดา", "12", "3", "ตำบลทดสอบ", "อำเภอทดสอบ", "จังหวัดทดสอบ").run();
      await d1.prepare("INSERT INTO student_enrollments (student_id, academic_year_id, academic_term_id, grade_level, classroom) VALUES (?,?,?,?,?)").bind(sid, 1, 1, grade, room).run();
      sid++;
    }
  }
  // ย้ายห้อง 1 คน ในภาค 2: นักเรียนคนแรกของ ป.1/1 ไป ป.1/2
  await d1.prepare("INSERT INTO student_enrollments (student_id, academic_year_id, academic_term_id, grade_level, classroom) SELECT student_id, 1, 2, grade_level, classroom FROM student_enrollments WHERE academic_term_id = 1").run();
  await d1.prepare("UPDATE student_enrollments SET classroom = '2' WHERE academic_term_id = 2 AND student_id = 7").run();
  // ย้ายออก 1 คน
  await d1.prepare("UPDATE student_enrollments SET status = 'transferred' WHERE academic_term_id = 2 AND student_id = 8").run();
  await d1.prepare("INSERT INTO learner_class_assignments (academic_term_id, grade_level, classroom, teacher_user_id, assigned_by) VALUES (1, 'ป.1', '1', 2, 1)").run();
}
