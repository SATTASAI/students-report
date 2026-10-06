// แยกบรรทัดที่คัดลอกจากเอกสารหลักสูตร: "ท 1.1 ป.1/1 อ่านออกเสียงคำ..." → รหัส + ข้อความ
export function parseIndicatorLines(textBlock) {
  return textBlock.split(/\r?\n/).map((l) => l.replace(/^\s*[\d๐-๙]+[.)]\s+/, "").trim()).filter(Boolean).map((line) => {
    const m = line.match(/^([ก-ฮ]\s*[\d๐-๙]+(?:\.[\d๐-๙]+)?\s*ป\.?\s*[\d๐-๙]+\s*\/\s*[\d๐-๙]+)\s*(.*)$/);
    return m ? { code: m[1].replace(/\s+/g, " ").replace(/\s*\/\s*/, "/"), title: m[2] || m[1] } : { code: "", title: line };
  });
}

