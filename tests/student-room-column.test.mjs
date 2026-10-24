import test from "node:test";
import assert from "node:assert/strict";
import { gridToRows, parseGrid } from "../public/js/paste.js";

test("นำเข้านักเรียน: หัวคอลัมน์ห้องที่สะกดไม่ตรงแม่แบบ ยังอ่านห้องได้", () => {
  const a = gridToRows("students", parseGrid("เลขประจำตัว\tชื่อ\tนามสกุล\tชั้นเรียน\n1\tก\tข\tป.1/1")).rows;
  assert.equal(a[0].room, "ป.1/1");
  const b = gridToRows("students", parseGrid("เลขประจำตัว\tชื่อ\tนามสกุล\tวันเกิด\tชั้น ห้อง (เช่น ป.1/1)\tสัญชาติ\n3149\tภาคภูมิ\tสิงหพี\t28/08/2563\tอ.3/1\tไทย\n3150\tก\tข\t\tป.1/2\tไทย")).rows;
  assert.deepEqual(b.map((r) => r.room), ["อ.3/1", "ป.1/2"]);
});
