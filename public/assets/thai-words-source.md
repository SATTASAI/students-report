# thai-words.txt

พจนานุกรมคำภาษาไทยสำหรับตัวตรวจคำผิดในความคิดเห็นครูประจำชั้น (`public/js/spellcheck.js`)

- รายการคำ: `words_th.txt` จาก [PyThaiNLP corpus](https://github.com/PyThaiNLP/pythainlp/tree/dev/pythainlp/corpus) — CC0-1.0
- ลำดับคำ (คำที่ใช้บ่อยมาก่อน): `tnc_freq.txt` (Thai National Corpus) จาก PyThaiNLP — CC0-1.0
- ตัดคำที่มักเขียนผิด (`MISSPELLINGS`) ออก และเก็บเฉพาะคำภาษาไทยล้วน — สร้างใหม่ด้วย `node dev/build-thai-words.mjs <words_th.txt> <tnc_freq.txt>`
