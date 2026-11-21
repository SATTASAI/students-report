# AGENTS.md — ระบบรายงานผลการเรียน โรงเรียนบ้านป่าเด็ง (students-report)

บันทึกคะแนนและรายงานผลการเรียน ป.1–ป.6 (ปพ.5, ปพ.6, ปพ.1) ใช้บัญชีและข้อมูลนักเรียนจากระบบบริหารโรงเรียน · https://grades.banpadengschool.ac.th

## ข้อมูลระบบ

- Cloudflare Worker `students-report` + static assets `public/` (`not_found_handling: 404-page`)
- D1 `DB` = `banpadeng_school_db` (ฐานกลาง) · ไม่มี build step · passkey ด้วย `@simplewebauthn/server`
- อ่าน `HANDOFF.md` ก่อนเริ่มงานใหญ่ — มีบริบทการตัดสินใจล่าสุด

## วิธีทำงานในรีโปนี้ (สำหรับ agent)

1. อ่านไฟล์นี้, `README.md` และเอกสารใน `docs/` (ถ้ามี) ก่อนแก้ทุกครั้ง
2. ทำเฉพาะขอบเขตที่ได้รับมอบหมาย ไม่ refactor, ไม่เปลี่ยนชื่อไฟล์/ตาราง/endpoint และไม่อัปเกรด dependency ถ้าไม่ได้สั่ง
3. ถ้างานกระทบข้อมูลจริง สิทธิ์ผู้ใช้ เงิน หรือระบบอื่น ให้หยุดถามก่อนลงมือ
4. แก้ให้น้อยที่สุดที่ทำให้งานสำเร็จ และเขียน/ปรับ test ที่ครอบคลุมพฤติกรรมที่เปลี่ยน
5. รันคำสั่งตรวจในหัวข้อ "คำสั่ง" ให้ผ่านทั้งหมดก่อน commit
6. ตอบผู้ใช้เป็นภาษาไทย กระชับ ข้อความ UI ทั้งหมดเป็นภาษาไทย

## คำสั่ง

```sh
npm test                 # node --test tests/*.test.mjs
npm run dev              # dev/server.mjs พอร์ต 8787 ใช้ D1 shim (dev/d1-shim.mjs) ไม่แตะฐานจริง
bash dev/run-e2e.sh      # e2e ทั้งชุด (dev/e2e-*.mjs)
```

## โครงสร้างไฟล์

```
src/index.js     → router หลัก
src/routes/      → admin, auth, courses, homeroom, reports, roster, sso, backup ฯลฯ
src/lib/         → schema.js (สร้างตาราง gr_*), crypto, auth-sessions, standards, วันหยุดไทย
src/data/        → คลังตัวชี้วัด/หลักสูตร 2569 (ไฟล์ข้อมูลใหญ่ อย่าจัดรูปแบบใหม่)
public/          → หน้าเว็บ + print/ (แบบพิมพ์ ปพ.)
dev/             → dev server, seed, e2e, base-schema.sql
tests/           → node:test
```

## ฐานข้อมูลกลาง `banpadeng_school_db` (ใช้ร่วมหลายระบบ)

ฐาน D1 นี้ใช้ร่วมกับ banpadeng-school-db (system), students-report, publicservice, bpdactivity,
teaching-media, evaluatesystem และ school-cooperative ความผิดพลาดที่นี่กระทบทุกระบบ

- เขียนได้เฉพาะตารางของรีโปนี้: ตาราง `gr_*` เท่านั้น + `system_settings` แถว `students_report_schema` + `auth_login_throttles` (ใช้ร่วมกับ system)
- ตารางของระบบอื่นอ่านอย่างเดียว: `users`, `students`, `student_details`, `student_enrollments`, `academic_years`, `academic_terms`, `personnel_records` และตารางอื่นของ system, `learner_class_assignments`
- ตาราง passkey กลาง (`auth_passkeys`, `auth_passkey_users`, `auth_passkey_challenges`, `auth_passkey_rates`) ใช้ร่วมทุกระบบ ห้ามเปลี่ยนโครงสร้าง
- schema สร้างอัตโนมัติด้วย `CREATE TABLE IF NOT EXISTS`/เพิ่มคอลัมน์แบบตรวจก่อน ห้าม `DROP`, `RENAME`, ลบคอลัมน์ หรือเปลี่ยนชนิดข้อมูล
- ห้ามรันคำสั่งเขียน/ลบบนฐานจริง (`--remote`) เพื่อทดสอบ; ใช้ฐาน local/shim หรือ fixture
- ระวังโควต้า D1: query ต้องใช้ index, จำกัดจำนวนแถว, ไม่ scan ทั้งตารางใน cron

## กติกาเฉพาะของระบบ (business rules)

- ตัดเกรด 8 ระดับ คะแนนรวมไม่ปัดเศษ (79.99 = 3.5) · เวลาเรียน < 80% = มส · คะแนนไม่ครบ = ร · สอบแก้ตัวได้สูงสุด 1
- ตัวชี้วัดไม่ผ่าน: เตือนแต่ไม่บล็อกการให้เกรด · ยืนยันผลแล้วรายวิชาถูกล็อก ผู้ดูแลปลดได้
- กิจกรรมเพื่อสังคมฯ ใน ปพ.6 คำนวณสดจาก `ps_behavior_records` ของ publicservice (< 50 คะแนน = มผ) ไม่เขียนลง `gr_assessments`
- แบบพิมพ์ ปพ.5/ปพ.6/ปพ.1 ต้องตรงรูปแบบทางราชการ รองรับเลขไทย — ตรวจภาพพิมพ์ทุกครั้งที่แก้ `public/print/`
- watbot-db ถูก clone จากรีโปนี้: ถ้าแก้บั๊กตรรกะเกรด ให้แจ้งผู้ใช้ว่าอาจต้องแก้ watbot-db ด้วย

## ข้อตกลงการเขียนโค้ด

- เวลาและวันที่อิงเวลาไทย `Asia/Bangkok` (UTC+7) ทุกจุด ทั้งการคำนวณวัน ตัดรอบ และ cron; แสดงปีเป็น พ.ศ. แต่เก็บเป็น ISO/ค.ศ.
- SQL ใช้ prepared statement + `.bind()` เท่านั้น ห้ามต่อสตริงจากค่าที่ผู้ใช้ส่งมา
- ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ทุก endpoint (role/status/session ปัจจุบันจากฐาน) อย่าเชื่อค่าจากหน้าเว็บ
- งานที่เขียนหลายแถวต้องเป็น atomic (`db.batch()`) และกันกดซ้ำ (idempotency key) เมื่อเป็นรายการเงินหรือรายการสำคัญ
- การลบข้อมูลสำคัญใช้ soft delete/ยกเลิกพร้อมเหตุผล และบันทึก audit แทนการลบแถว
- หน้าเว็บต้องใช้ได้บนมือถือ (iPhone Safari/PWA) และจอกว้าง ใช้ฟอนต์และสไตล์เดิมของรีโป
- escape ข้อความก่อนใส่ลง HTML เสมอ (กัน XSS) และอย่าเพิ่ม CDN/สคริปต์ภายนอกใหม่ถ้าไม่จำเป็น

## ความปลอดภัยและ secrets

- `JWT_SECRET` ต้องตรงกับ Worker `banpadeng-school-db` ทุกตัวอักษร (ใช้ session/บัญชีร่วม) ห้ามหมุนค่าในรีโปเดียว
- ห้าม commit secret, token, รหัสผ่าน, `.env`, `.dev.vars`, ไฟล์สำรองฐานข้อมูล หรือข้อมูลนักเรียน/บุคลากรจริงลง Git
- secret ตั้งผ่าน Cloudflare dashboard หรือ `wrangler secret put` เท่านั้น (`keep_vars: true` ทำให้ค่าที่ตั้งใน dashboard ไม่ถูกทับ)
- ข้อมูลนักเรียนเป็นข้อมูลส่วนบุคคลของผู้เยาว์: ห้าม log ชื่อ เลขประจำตัว ที่อยู่ หรือข้อมูลผู้ปกครองลง console/observability
- ห้ามปิดหรือผ่อนการตรวจสิทธิ์ การจำกัดความถี่ล็อกอิน Turnstile หรือ passkey เพื่อให้ทดสอบง่าย

## ห้ามแตะ / ต้องระวังเป็นพิเศษ

- สูตรคำนวณเกรด/มส/ร ใน `src/routes/reports.js`, `courses.js` (กระทบผลการเรียนจริง)
- `src/lib/schema.js` (เวอร์ชัน schema ใน `system_settings`)
- `src/lib/crypto.js`, `auth-sessions.js` — publicservice คัดลอกไปใช้ แก้ที่นี่ต้องแก้ที่นั่นด้วย
- `src/routes/roster.js` — publicservice คัดลอกตรรกะรายชื่อ/เลขที่ไป

## ระบบที่เชื่อมกัน

- banpadeng-school-db: บัญชี นักเรียน ปีการศึกษา (อ่านอย่างเดียว)
- publicservice: อ่าน `gr_homerooms` และเขียน `ps_*` ที่รีโปนี้อ่านกลับ
- school-notify: ลิงก์สมัครแจ้งเตือนผู้ปกครอง (`?role=parent&ref=<รหัสนักเรียน>`)

## Deploy

- Worker เชื่อม repo ผ่าน Cloudflare Workers Builds: merge เข้า `main` = ขึ้นจริง
- ช่วงครูกรอกคะแนน/ออกผลปลายภาค หลีกเลี่ยงการเปลี่ยนแปลงใหญ่ ถ้าไม่แน่ใจให้ถามก่อน

## เลขเวอร์ชันกลาง (แพทช์ข้ามรีโป)

รีโปนี้เชื่อมกับระบบบริหารโรงเรียน (D1 `banpadeng_school_db` และ `JWT_SECRET` ร่วม) จึงอยู่ในขอบเขตแพทช์กลาง:

- ทุกชุดการแก้ไขที่ merge/push เข้า `main` ต้องออกเลขแพทช์ใหม่ใน
  [`SATTASAI/banpadeng-school-db/CHANGELOG.md`](https://github.com/SATTASAI/banpadeng-school-db/blob/main/CHANGELOG.md) รวมงานเอกสาร
- อ่านเลขล่าสุดจาก CHANGELOG นั้นก่อนเสมอ ห้ามนับเลขแยกในรีโปนี้
- งานเล็ก/กลางเพิ่มเลขส่วนที่สาม งานใหญ่เพิ่มเลขส่วนที่สอง งานหลายรีโปในชุดเดียวใช้เลขเดียวและลิงก์ PR ทุกรีโป
- รายละเอียดกติกาอยู่ใน `README.md` ของ banpadeng-school-db หัวข้อ "เวอร์ชันและบันทึก Patch Update"

## Checklist ก่อนเปิด PR / merge

- [ ] test และ syntax check ทั้งหมดผ่าน
- [ ] ไม่มี secret/ข้อมูลจริงใน diff (`git diff --cached` ตรวจก่อน commit)
- [ ] ไม่แก้ `database_id`, `routes`, `services` และชื่อ Worker ใน wrangler config โดยไม่ได้สั่ง
- [ ] schema เปลี่ยนแบบเพิ่มเท่านั้น (add table/column) และรันซ้ำได้ ไม่ทำให้ข้อมูลเดิมหรือระบบอื่นพัง
- [ ] อัปเดต `README.md`/`docs/` เมื่อพฤติกรรมหรือขั้นตอนติดตั้งเปลี่ยน และบันทึกการตัดสินใจถาวรของผู้ใช้ลงไฟล์นี้
- [ ] commit/PR อธิบายเป็นภาษาไทยว่าเปลี่ยนอะไร เพราะอะไร และทดสอบอย่างไร
