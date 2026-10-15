// สำเนาฟังก์ชัน fmt ของ public/js/app.js (ไฟล์นั้นต้องใช้ DOM จึง import ตรงไม่ได้) — ตรวจว่าตรงกันในเทสต์
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("export function fmt("), src.indexOf("\n}\n", src.indexOf("export function fmt(")) + 2).replace("export ", "");
export const fmt = new Function(`${body}; return fmt;`)();
