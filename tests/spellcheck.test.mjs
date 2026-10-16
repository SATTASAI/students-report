// ตัวตรวจคำที่อาจสะกดผิดในความคิดเห็นครูประจำชั้น (public/js/spellcheck.js) + พจนานุกรมของฉัน (/api/homeroom/spell-words)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createChecker, MISSPELLINGS, segment } from "../public/js/spellcheck.js";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";

const WORDS = readFileSync(new URL("../public/assets/thai-words.txt", import.meta.url), "utf8").split("\n");
const checker = createChecker(WORDS);
const words = (text, ignore) => checker.check(text, ignore).map((x) => x.word);

test("ความคิดเห็นที่เขียนถูกต้อง ไม่ถูกเตือน", () => {
  const ok = [
    "เป็นเด็กดี มีความรับผิดชอบ ตั้งใจเรียน ส่งงานครบตรงเวลา",
    "ควรฝึกอ่านหนังสือเพิ่มเติมที่บ้านอย่างสม่ำเสมอ และทบทวนบทเรียนทุกวัน",
    "มีน้ำใจ ช่วยเหลือเพื่อนและครู มีมนุษยสัมพันธ์ดี กล้าแสดงออก",
    "ร่างกายแข็งแรง สุขภาพดี ควรดูแลความสะอาดของเล็บและฟัน",
    "นักเรียนมีพัฒนาการด้านการอ่านดีขึ้นมาก ผู้ปกครองควรส่งเสริมให้อ่านนิทานก่อนนอน",
    "ขาดเรียนบ่อย ควรมาโรงเรียนสม่ำเสมอ ผลการเรียนอยู่ในเกณฑ์พอใช้",
    "เป็นผู้นำ ชอบทำกิจกรรม มีความคิดสร้างสรรค์ ใฝ่รู้ใฝ่เรียน",
    "รับประทานอาหารครบ 5 หมู่ ดื่มนมทุกวัน น้ำหนักอยู่ในเกณฑ์",
    "นักเรียนเป็นเด็กร่าเริงแจ่มใส เอาใจใส่การเรียน มีวินัยในตนเอง เพื่อน ๆ รักใคร่",
  ];
  for (const s of ok) assert.deepEqual(words(s), [], s);
});

test("จับคำที่มักเขียนผิด พร้อมคำแนะนำที่ถูก", () => {
  const r = checker.check("ศรีษะ สังเกตุ อนุญาติ ไฝ่รู้ ซื่อสัตว์ รอบครอบ คำนวน");
  assert.deepEqual(r.map((x) => [x.word, x.suggest[0]]), [
    ["ศรีษะ", "ศีรษะ"], ["สังเกตุ", "สังเกต"], ["อนุญาติ", "อนุญาต"], ["ไฝ่", "ใฝ่"], ["ซื่อสัตว์", "ซื่อสัตย์"], ["รอบครอบ", "รอบคอบ"], ["คำนวน", "คำนวณ"],
  ]);
  // คำที่ถูกต้องในพจนานุกรมต้องไม่มีคำผิดซ่อนอยู่ (ไม่เช่นนั้นจะเตือนคำที่ถูก)
  const dict = new Set(WORDS);
  for (const [wrong, right] of Object.entries(MISSPELLINGS)) {
    assert.ok(dict.has(right), `คำถูก "${right}" ต้องอยู่ในพจนานุกรม`);
    assert.ok(!dict.has(wrong), `คำผิด "${wrong}" ต้องไม่อยู่ในพจนานุกรม`);
  }
});

test("จับการพิมพ์ผิดรูป: เ+เ, สระอำแยก, วรรณยุกต์หลังสระอำ, อักษรซ้ำ", () => {
  const r = checker.check("เเข็งแรง นํ้าใจ นำ้ใจ ดีมากกกก");
  assert.deepEqual(r.map((x) => [x.word, x.suggest[0]]), [["เเข็งแรง", "แข็งแรง"], ["นํ้าใจ", "น้ำใจ"], ["นำ้ใจ", "น้ำใจ"], ["ดีมากกกก", "ดีมาก"]]);
});

test("คำที่ไม่อยู่ในพจนานุกรม: เตือนพร้อมคำแนะนำ · ข้ามชื่อนักเรียน · เพิ่มคำของฉันได้", () => {
  const r = checker.check("ตั้งใจเรีนย");
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, "unknown");
  assert.equal(r[0].suggest[0], "เรียน");
  // ชื่อเล่น/ชื่อเฉพาะ
  assert.deepEqual(words("ด.ญ.ขวัญข้าวฟ่างตั้งใจเรียน", ["ขวัญข้าวฟ่าง"]), []);
  assert.deepEqual(words("ปุ๊กปิ๊กตั้งใจเรียน"), ["ปุ๊กปิ๊ก"]); // แสดงทั้งคำ ไม่ใช่เศษที่ถูกตัด
  const c2 = createChecker(WORDS, ["ปุ๊กปิ๊ก"]);
  assert.deepEqual(c2.check("ปุ๊กปิ๊กตั้งใจเรียน").map((x) => x.word), []);
});

test("บริบท: คำสะกดถูกทุกคำ แต่อ่านรวมแล้วควรเป็นวลีอื่น", () => {
  const r = (s) => checker.check(s).map((x) => [x.word, x.suggest[0]]);
  assert.deepEqual(r("ไม่ตั่งใจเลียน"), [["ไม่ตั่งใจเลียน", "ไม่ตั้งใจเรียน"]]);
  assert.deepEqual(r("ตั้งใจเลียน"), [["ตั้งใจเลียน", "ตั้งใจเรียน"]]);
  assert.deepEqual(r("ส่งงานคบ"), [["ส่งงานคบ", "ส่งงานครบ"]]);
  assert.deepEqual(r("ช่วยเหลื่อเพื่อน"), [["ช่วยเหลื่อเพื่อน", "ช่วยเหลือเพื่อน"]]);
  assert.deepEqual(r("แต่งกายเรียบล้อย"), [["เรียบล้อย", "เรียบร้อย"]]);
  assert.equal(checker.check("ไม่ตั่งใจเลียน")[0].kind, "context");
  // ผิดหลายคำในประโยคเดียว: ต้องจับครบทุกคำ แม้คำที่เหลือบังเอิญเป็นคำที่มีความหมาย (คบ, สวน, บ้าย, เลียน)
  const multi = "เด็กไม่ตั่งใจเลียน ส่งงานไม่คบ เขียนหนังสือไม่สวน ไม่ทำการบ้าย";
  assert.deepEqual(r(multi).map((x) => x[1]), ["ไม่ตั้งใจเรียน", "ส่งงานไม่ครบ", "ไม่สวย", "ไม่ทำการบ้าน"]);
  // แก้ทีละคำ: คำที่เหลือยังต้องถูกเตือน
  assert.deepEqual(r("เด็กไม่ตั้งใจเรียน ส่งงานไม่คบ เขียนหนังสือไม่สวน ไม่ทำการบ้าย").map((x) => x[1]), ["ส่งงานไม่ครบ", "ไม่สวย", "ไม่ทำการบ้าน"]);
  assert.deepEqual(r("เด็กไม่ตั้งใจเรียน ส่งงานไม่ครบ เขียนหนังสือไม่สวย ไม่ทำการบ้าย").map((x) => x[1]), ["ไม่ทำการบ้าน"]);
  assert.deepEqual(r("เด็กไม่ตั้งใจเรียน ส่งงานไม่ครบ เขียนหนังสือไม่สวย ไม่ทำการบ้าน"), []);
  assert.deepEqual(r("เด็กชอบเลียน มาเลียนทุกวัน").map((x) => x[1]), ["ชอบเรียน", "มาเรียน"]);
  // ประโยคที่ถูกต้องต้องไม่ถูกเตือนเรื่องบริบท
  for (const s of ["ชอบใส่เสื้อขาวมาโรงเรียน", "วิ่งเล่นตอนพักกลางวันจนเหงื่อออก", "ปิดไฟเมื่อออกจากห้อง", "เลียนแบบสิ่งที่ดี", "นั่งบนตั่งไม้หน้าบ้าน",
    "อาศัยอยู่กับตายาย พ่อแม่ไปทำงานต่างจังหวัด", "ไม่ค่อยพูด แต่ตั้งใจทำงาน", "ส่งงานเลยกำหนดบ่อย", "นั่งเรียนได้ไม่นาน", "ทำงานร่วมกับผู้อื่นได้ดี รับฟังความคิดเห็นของเพื่อน", "ชอบถามเมื่อไม่เข้าใจ"]) assert.deepEqual(words(s), [], s);
  // เพิ่มเข้าพจนานุกรมของฉันแล้วไม่เตือน
  const c2 = createChecker(WORDS, ["ส่งงานคบ"]);
  assert.deepEqual(c2.check("ส่งงานคบ"), []);
});

test("ตัดคำ: ไม่แยกสระ/วรรณยุกต์ออกจากพยัญชนะ", () => {
  const has = (w) => ["ตั้งใจ", "เรียน"].includes(w);
  const segs = segment("ตั้งใจเรียนดี", has);
  assert.deepEqual(segs.map((s) => [s.text, s.known]), [["ตั้งใจ", true], ["เรียน", true], ["ดี", false]]);
});

test("พจนานุกรมของฉัน: เพิ่ม/ลบได้ ของใครของมัน และส่งมากับข้อมูลห้อง", async () => {
  const env = await makeEnv();
  const ORIGIN = "http://school.test", cookies = {};
  const call = async (who, method, path, body) => {
    const headers = { "Content-Type": "application/json", Origin: ORIGIN };
    if (cookies[who]) headers.Cookie = cookies[who];
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json().catch(() => null), res };
  };
  for (const [who, email] of [["t1", "teacher1@test.local"], ["t2", "teacher2@test.local"]]) {
    const r = await call(null, "POST", "/api/auth/login", { email, password: PASSWORD });
    cookies[who] = r.res.headers.get("Set-Cookie").split(";")[0];
  }
  let r = await call("t1", "POST", "/api/homeroom/spell-words", { word: "กุ๊กไก๋" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.spell_words, ["กุ๊กไก๋"]);
  await call("t1", "POST", "/api/homeroom/spell-words", { word: "กุ๊กไก๋" }); // ซ้ำไม่เพิ่ม
  assert.equal((await call("t1", "POST", "/api/homeroom/spell-words", { word: "abc" })).status, 400);
  assert.equal((await call("t1", "POST", "/api/homeroom/spell-words", { word: "" })).status, 400);
  assert.deepEqual((await call("t2", "GET", "/api/homeroom/spell-words")).data.spell_words, []);
  r = await call("t1", "DELETE", "/api/homeroom/spell-words", { word: "กุ๊กไก๋" });
  assert.deepEqual(r.data.spell_words, []);
});
