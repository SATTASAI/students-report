// ตรวจคำที่อาจสะกดผิดในความคิดเห็นของครู (ภาษาไทย) — ทำงานในเบราว์เซอร์ทั้งหมด ไม่ส่งข้อความออกนอกระบบ
// 1) รูปแบบการพิมพ์ที่ผิดแน่นอน (เ+เ แทน แ, สระอำแยกตัว, วรรณยุกต์ซ้ำ, อักษรซ้ำ 3 ตัวขึ้นไป)
// 2) คำที่มักเขียนผิด (MISSPELLINGS) พร้อมคำที่ถูก
// 3) ตัดคำด้วยพจนานุกรม (/assets/thai-words.txt จาก PyThaiNLP, CC0) — ส่วนที่ไม่ตรงคำใดเลยถือว่า "อาจสะกดผิด"
// ภาษาไทยตรวจได้ไม่สมบูรณ์ (ชื่อเฉพาะ คำใหม่) ครูจึงเพิ่มคำเข้า "พจนานุกรมของฉัน" หรือยืนยันบันทึกทั้งที่มีคำเตือนได้

// คำผิด → คำที่ถูก (ตรวจแล้วว่าคำผิดไม่เป็นส่วนหนึ่งของคำที่ถูกต้องในพจนานุกรม)
export const MISSPELLINGS = {
  "อนุญาติ": "อนุญาต", "สังเกตุ": "สังเกต", "ศรีษะ": "ศีรษะ", "ประณีประนอม": "ประนีประนอม",
  "กระตือรือล้น": "กระตือรือร้น", "กระตือลือร้น": "กระตือรือร้น", "โอกาศ": "โอกาส", "ปรากฎ": "ปรากฏ",
  "ทนุถนอม": "ทะนุถนอม", "เกียรต์": "เกียรติ", "บรรยากาส": "บรรยากาศ", "ไอศครีม": "ไอศกรีม",
  "คลีนิก": "คลินิก", "คลีนิค": "คลินิก", "คลินิค": "คลินิก", "ลายเซ็นต์": "ลายเซ็น", "เซ็นต์ชื่อ": "เซ็นชื่อ",
  "ผาสุข": "ผาสุก", "อนุเสาวรีย์": "อนุสาวรีย์", "ศักดิ์สิทธ์": "ศักดิ์สิทธิ์", "ประสพการณ์": "ประสบการณ์",
  "ประสพ": "ประสบ", "ผูกพันธ์": "ผูกพัน", "พิธีพิถัน": "พิถีพิถัน", "ปฎิ": "ปฏิ", "กฏหมาย": "กฎหมาย",
  "กฏระเบียบ": "กฎระเบียบ", "กฏเกณฑ์": "กฎเกณฑ์", "หลงไหล": "หลงใหล", "ไฝ่": "ใฝ่", "ไส่": "ใส่",
  "ไหญ่": "ใหญ่", "ไหม่": "ใหม่", "มุ่งมั้น": "มุ่งมั่น", "สมำเสมอ": "สม่ำเสมอ", "บิณฑบาตร": "บิณฑบาต",
  "ฉนั้น": "ฉะนั้น", "อาจารณ์": "อาจารย์", "ประโยชย์": "ประโยชน์", "ภูมใจ": "ภูมิใจ", "ร่าเลิง": "ร่าเริง",
  "แจ่มไส": "แจ่มใส", "ขมักเขม้น": "ขะมักเขม้น", "จินตณาการ": "จินตนาการ", "จินตนาการณ์": "จินตนาการ",
  "สร้างสรรณ์": "สร้างสรรค์", "วิเคาระห์": "วิเคราะห์", "คณิตศาสต์": "คณิตศาสตร์", "คณิตสาตร์": "คณิตศาสตร์",
  "คณิตสาสตร์": "คณิตศาสตร์", "วิทยาศาสต์": "วิทยาศาสตร์", "วิทยาสาตร์": "วิทยาศาสตร์", "ภาษาอังกฤต": "ภาษาอังกฤษ",
  "นาฎ": "นาฏ", "ทัศนะคติ": "ทัศนคติ", "มารยาด": "มารยาท", "กะตัญญู": "กตัญญู", "ซื่อสัตว์": "ซื่อสัตย์",
  "ประหยัต": "ประหยัด", "เสียสะละ": "เสียสละ", "อนุลักษณ์": "อนุรักษ์", "คล่องแคล้ว": "คล่องแคล่ว",
  "ระเอียด": "ละเอียด", "รอบครอบ": "รอบคอบ", "สมาทิ": "สมาธิ", "ไหวพิบ": "ไหวพริบ", "ทะเยอะทะยาน": "ทะเยอทะยาน",
  "อุสาหะ": "อุตสาหะ", "บุคคลิก": "บุคลิก", "บุคลิค": "บุคลิก", "พัฒณา": "พัฒนา", "ส่งเสิม": "ส่งเสริม",
  "สอาด": "สะอาด", "โภชณาการ": "โภชนาการ", "เกียดคร้าน": "เกียจคร้าน", "คำนวน": "คำนวณ",
  "ผลสัมฤทธ์": "ผลสัมฤทธิ์", "รสชาด": "รสชาติ", "ปฤกษา": "ปรึกษา", "พึ่งประสงค์": "พึงประสงค์", "ประพึติ": "ประพฤติ",
  "สำอางค์": "สำอาง", "ผู้ปกคลอง": "ผู้ปกครอง", "อัธยาษัย": "อัธยาศัย", "อัทธยาศัย": "อัธยาศัย",
  "เอื้อเฟื่อ": "เอื้อเฟื้อ", "มนุษย์สัมพันธ์": "มนุษยสัมพันธ์", "อารมย์": "อารมณ์", "ธรรมชาด": "ธรรมชาติ",
  "กระฉับกระแฉง": "กระฉับกระเฉง", "สะเพล่า": "สะเพร่า", "เลินเหล่อ": "เลินเล่อ", "ขี้เกลียด": "ขี้เกียจ",
  "ขี้เกียด": "ขี้เกียจ", "เกลียดคร้าน": "เกียจคร้าน", "ปฏิบัตร": "ปฏิบัติ", "ระเบิยบ": "ระเบียบ", "ระเบียป": "ระเบียบ",
  "บันทัด": "บรรทัด", "บรรทัต": "บรรทัด", "ผลัดวันประกันพรุ่ง": "ผัดวันประกันพรุ่ง", "ทะเลาะวิวาธ": "ทะเลาะวิวาท",
  "พึติกรรม": "พฤติกรรม", "พรึติกรรม": "พฤติกรรม", "พฤติกรม": "พฤติกรรม", "ภฤติกรรม": "พฤติกรรม",
  "ผิดพลาท": "ผิดพลาด", "สนุกสนาณ": "สนุกสนาน", "ปรับปรุ้ง": "ปรับปรุง", "ปรับปรุ่ง": "ปรับปรุง",
  "คุณลักษณ์": "คุณลักษณะ", "ประสิทธภาพ": "ประสิทธิภาพ", "ประสิทธิ์ภาพ": "ประสิทธิภาพ", "สติปัญยา": "สติปัญญา",
  "ปัญยา": "ปัญญา", "หงุดหงิษ": "หงุดหงิด", "สุขภาภ": "สุขภาพ", "สุขพาพ": "สุขภาพ", "หมั่นเพียน": "หมั่นเพียร",
  "พยายม": "พยายาม", "พยาพยาม": "พยายาม", "พยายาย": "พยายาม",
};

// คำที่พจนานุกรมไม่มี แต่ใช้ในโรงเรียน (เพิ่มได้ที่นี่ หรือครูเพิ่มเองใน "พจนานุกรมของฉัน")
export const EXTRA_WORDS = ["ป่าเด็ง", "บ้านป่าเด็ง", "แก่งกระจาน", "ปพ", "อนุบาล", "ฐานการเรียนรู้", "ออนไลน์", "แท็บเล็ต", "ยูทูบ", "เกม"];

const COMBINING = /[ัิ-ฺ็-๎]/; // สระบน/ล่าง วรรณยุกต์ การันต์
const FOLLOW = /[ะาำๅ]/;           // ะ า ำ ๅ ขึ้นต้นคำไม่ได้
const LEADING = /[เ-ไ]/;                     // เ แ โ ใ ไ ต้องอยู่หน้าพยัญชนะ
const THAI_RUN = /[ก-ฮะ-ฺเ-ๅ็-๎]+/g; // ไม่รวม ฯ ๆ เลขไทย
const MAX_WORD = 30;

// แบ่งคำได้ระหว่างตำแหน่ง i-1 กับ i หรือไม่ (ไม่ตัดกลางกลุ่มอักษรเดียวกัน)
function canBreak(s, i) {
  if (i <= 0 || i >= s.length) return true;
  return !COMBINING.test(s[i]) && !FOLLOW.test(s[i]) && !LEADING.test(s[i - 1]);
}

// ตัดคำแบบให้ส่วนที่ไม่รู้จักน้อยที่สุด แล้วจำนวนคำน้อยที่สุด → [{text, known, start}]
export function segment(s, has) {
  const n = s.length, best = new Array(n + 1).fill(null);
  best[0] = { unk: 0, words: 0, prev: -1, known: true };
  const better = (a, b) => !b || a.unk < b.unk || (a.unk === b.unk && a.words < b.words);
  for (let i = 0; i < n; i++) {
    const cur = best[i];
    if (!cur) continue;
    for (let j = i + 1; j <= Math.min(n, i + MAX_WORD); j++) {
      if (!canBreak(s, j) || !has(s.slice(i, j))) continue;
      const c = { unk: cur.unk, words: cur.words + 1, prev: i, known: true };
      if (better(c, best[j])) best[j] = c;
    }
    // ไม่รู้จัก: ข้ามไปหนึ่งกลุ่มอักษร
    let j = i + 1;
    while (j < n && !canBreak(s, j)) j++;
    const c = { unk: cur.unk + (j - i), words: cur.words + 1, prev: i, known: false };
    if (better(c, best[j])) best[j] = c;
  }
  const out = [];
  for (let j = n; j > 0;) { const b = best[j]; out.push({ text: s.slice(b.prev, j), known: b.known, start: b.prev }); j = b.prev; }
  out.reverse();
  // รวมส่วนที่ไม่รู้จักที่อยู่ติดกัน
  const mergeUnknown = (list) => {
    const merged = [];
    for (const t of list) {
      const last = merged[merged.length - 1];
      if (last && !last.known && !t.known) last.text += t.text;
      else if (t.text) merged.push({ ...t });
    }
    return merged;
  };
  const segs = mergeUnknown(out);
  // ซ่อมรอยต่อ: การหาส่วนไม่รู้จักให้สั้นที่สุดมักขโมยอักษรจากคำถัดไป (ปุ๊ก|ปิ๊ก|ชอบ → ปุ๊|กปิ๊|กช|อบ)
  // ถ้าย้ายอักษรต้นของคำสั้นที่ติดส่วนไม่รู้จักไปรวมกับส่วนไม่รู้จัก แล้วเศษที่เหลือ+คำถัดไปเป็นคำ → ใช้แบบนั้น
  for (let i = 0; i < segs.length; i++) {
    const u = segs[i], k1 = segs[i + 1], k2 = segs[i + 2];
    if (u.known || !k1?.known || !k2?.known || k1.text.length > 3) continue;
    for (let p = 1; p < k1.text.length; p++) {
      const rest = k1.text.slice(p) + k2.text;
      if (canBreak(k1.text, p) && has(rest)) {
        u.text += k1.text.slice(0, p);
        k1.text = rest; k1.start = u.start + u.text.length;
        segs.splice(i + 2, 1);
        break;
      }
    }
  }
  return mergeUnknown(segs);
}

// ระยะแก้ไข (Damerau–Levenshtein: สลับอักษรติดกันนับ 1) แบบหยุดเมื่อเกิน max
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    pp = prev; prev = cur;
  }
  return prev[b.length];
}

export function createChecker(wordList, extra = []) {
  // wordList เรียงตามความถี่ (คำที่ใช้บ่อยมาก่อน) → ใช้ลำดับจัดคำแนะนำ
  const dict = new Map();
  for (const w of [...wordList, ...EXTRA_WORDS]) if (w && !(w in MISSPELLINGS) && !dict.has(w)) dict.set(w, dict.size);
  const custom = new Set();
  const has = (w) => dict.has(w) || custom.has(w);
  const byLen = new Map();
  for (const w of dict.keys()) { const l = w.length; if (!byLen.has(l)) byLen.set(l, []); byLen.get(l).push(w); }
  const sugCache = new Map();

  function suggest(word) {
    if (sugCache.has(word)) return sugCache.get(word);
    const max = word.length <= 4 ? 1 : 2, found = [];
    for (let l = word.length - max; l <= word.length + max; l++) {
      for (const w of byLen.get(l) || []) {
        const d = editDistance(word, w, max);
        if (d <= max) found.push([d, dict.get(w), w]);
      }
    }
    found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const r = found.slice(0, 3).map((x) => x[2]);
    sugCache.set(word, r);
    return r;
  }

  const api = {
    has,
    setCustom(words) { custom.clear(); for (const w of words) custom.add(w); },
    addCustom(w) { custom.add(w); },
    // ตรวจข้อความ → [{start, end, word, suggest:[...], kind: "pattern"|"known"|"unknown", note}]
    // ignore: ข้อความที่ไม่ต้องตรวจ เช่น ชื่อนักเรียนในห้อง
    check(text, ignore = []) {
      const issues = [];
      const covered = new Array(text.length).fill(false);
      const add = (start, end, word, suggestList, kind, note) => {
        for (let i = start; i < end; i++) if (covered[i]) return;
        for (let i = start; i < end; i++) covered[i] = true;
        issues.push({ start, end, word, suggest: suggestList, kind, note });
      };
      // ข้อความที่ไม่ต้องตรวจ (ชื่อนักเรียน)
      let masked = text;
      for (const name of ignore) {
        if (!name || name.length < 2) continue;
        let k = masked.indexOf(name);
        while (k >= 0) { masked = masked.slice(0, k) + " ".repeat(name.length) + masked.slice(k + name.length); k = masked.indexOf(name, k + name.length); }
      }
      // 1) รูปแบบการพิมพ์ที่ผิดแน่นอน
      const patterns = [
        [/เเ/g, () => "แ", "พิมพ์ เ สองตัวแทน แ"],
        [/ํ[่-๋]?า|[่-๋]ํา/g, (m) => `${m.replace(/[ํา]/g, "")}ำ`, "สระอำพิมพ์แยกเป็น ํ + า"],
        [/ำ([่-๋])/g, (m) => `${m[1]}ำ`, "พิมพ์วรรณยุกต์หลังสระอำ (ต้องพิมพ์ก่อน)"],
        [/([่-์])([ัิ-ู])/g, (m) => `${m[1]}${m[0]}`, "พิมพ์วรรณยุกต์ก่อนสระ (ต้องพิมพ์สระก่อน)"],
        [/([ัิ-ฺ็-๎])\1+/g, (m) => m[0], "พิมพ์สระ/วรรณยุกต์ซ้ำ"],
        [/([่-๋])[่-๋]+/g, (m) => m[0], "มีวรรณยุกต์มากกว่าหนึ่งตัว"],
        [/([ก-ฮ])\1\1+/g, (m) => m[0], "พิมพ์ตัวอักษรซ้ำหลายตัว"],
      ];
      for (const [re, fix, note] of patterns) {
        for (const m of masked.matchAll(re)) {
          const start = m.index, end = start + m[0].length;
          // ขยายให้เห็นทั้งคำ (ถึงช่องว่าง/เครื่องหมาย)
          let a = start, b = end;
          while (a > 0 && /[ก-๎]/.test(masked[a - 1]) && start - a < 12) a--;
          while (b < masked.length && /[ก-๎]/.test(masked[b]) && b - end < 12) b++;
          const word = text.slice(a, b);
          add(a, b, word, [text.slice(a, start) + fix(m[0]) + text.slice(end, b)], "pattern", note);
        }
      }
      // 2) คำที่มักเขียนผิด
      for (const [wrong, right] of Object.entries(MISSPELLINGS)) {
        let k = masked.indexOf(wrong);
        while (k >= 0) { add(k, k + wrong.length, wrong, [right], "known", "คำที่มักเขียนผิด"); k = masked.indexOf(wrong, k + 1); }
      }
      // 3) ตัดคำด้วยพจนานุกรม
      for (const m of masked.matchAll(THAI_RUN)) {
        const run = m[0], base = m.index;
        const segs = segment(run, has);
        for (let i = 0; i < segs.length; i++) {
          const t = segs[i];
          if (t.known) continue;
          // ส่วนที่ไม่รู้จักมักเป็นคำที่ถูกตัดแยก: รวมคำสั้น ๆ ข้างเคียงเข้ามา เพื่อแสดงทั้งคำและหาคำแนะนำ
          const prev = segs[i - 1], next = segs[i + 1];
          const left = prev && prev.known && prev.text.length <= 3 ? prev.text : "";
          const right = next && next.known && next.text.length <= 2 ? next.text : "";
          const word = left + t.text + right;
          const start = base + t.start - left.length, end = start + word.length;
          let sug = suggest(word);
          if (!sug.length && (left || right)) sug = suggest(t.text).map((x) => left + x + right);
          if (word.length === 1 && /[ก-ฮ]/.test(word)) continue; // อักษรตัวเดียว เช่น อักษรย่อ
          add(start, end, text.slice(start, end), sug, "unknown", "ไม่พบในพจนานุกรม");
        }
      }
      return issues.sort((a, b) => a.start - b.start);
    },
  };
  api.setCustom(extra);
  return api;
}
