// สร้าง public/assets/thai-words.txt สำหรับตัวตรวจคำผิด (public/js/spellcheck.js)
// ที่มา: words_th.txt ของ PyThaiNLP (CC0-1.0) https://github.com/PyThaiNLP/pythainlp/tree/dev/pythainlp/corpus
//       เรียงตามความถี่จาก tnc_freq.txt (Thai National Corpus, CC0-1.0) — ใช้จัดลำดับคำแนะนำ คำที่ใช้บ่อยมาก่อน
// ใช้: node dev/build-thai-words.mjs <path/to/words_th.txt> <path/to/tnc_freq.txt>
// - เก็บเฉพาะคำภาษาไทยล้วน (ไม่มีช่องว่าง/ตัวเลข/อักษรอื่น)
// - ตัดคำผิดใน MISSPELLINGS และคำที่มีคำผิดนั้นอยู่ข้างใน (เช่น ความผูกพันธ์, บุคคลิกภาพ) ออก
import { readFileSync, writeFileSync } from "node:fs";
import { MISSPELLINGS } from "../public/js/spellcheck.js";

const src = process.argv[2];
if (!src) { console.error("ใช้: node dev/build-thai-words.mjs <words_th.txt>"); process.exit(1); }
const wrongs = Object.keys(MISSPELLINGS);
const words = new Set();
for (const raw of readFileSync(src, "utf8").split("\n")) {
  const w = raw.trim().normalize("NFC");
  if (!/^[ก-ฮะ-ฺเ-ๅ็-๎]+$/.test(w)) continue;
  if (/เเ|ํา/.test(w)) continue; // พิมพ์ผิดรูป
  if (wrongs.some((x) => w.includes(x))) continue;
  words.add(w);
}
const freq = new Map();
if (process.argv[3]) for (const line of readFileSync(process.argv[3], "utf8").split("\n")) {
  const [w, n] = line.split("\t");
  if (w) freq.set(w.trim().normalize("NFC"), Number(n) || 0);
}
const out = [...words].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0) || (a < b ? -1 : a > b ? 1 : 0));
writeFileSync(new URL("../public/assets/thai-words.txt", import.meta.url), `${out.join("\n")}\n`);
console.log(`thai-words.txt: ${out.length} คำ`);
