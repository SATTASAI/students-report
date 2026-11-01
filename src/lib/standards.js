// แนบสาระ/มาตรฐานให้ตัวชี้วัดในคลัง: "ท 1.1 ป.4/2" → { std: "ท 1.1", std_text, strand: "สาระที่ 1 การอ่าน" }
import STANDARDS from "../data/curriculum-standards-2569.js";

export function standardOf(learningArea, code) {
  const m = String(code || "").match(/^([ก-ฮ])\s*(\d+)\.(\d+)/);
  if (!m) return {};
  const std = `${m[1]} ${m[2]}.${m[3]}`, area = STANDARDS[learningArea];
  const strandName = area?.strands?.[m[2]];
  return { std, std_text: area?.standards?.[std] || "", strand: strandName ? `สาระที่ ${m[2]} ${strandName}` : "" };
}
export const withStandards = (learningArea, rows) => rows.map((r) => ({ ...r, ...standardOf(learningArea, r.code) }));
