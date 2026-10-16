// ข้อมูล SAR มาตรฐานที่ 1 — ระบบคำนวณจากข้อมูลจริง ฝ่ายวัดผลตั้งค่าเป้าหมาย กรอกประเด็นที่ระบบไม่มีข้อมูล แล้วส่งออก Excel / Word ไปใส่เล่ม SAR
import { shell, api, esc, toast, showError, debounce } from "/js/app.js";
import { loadXlsx } from "/js/export.js";
import { SAR_STAGES, metricLabel, evaluateSar, pctOf } from "/js/sar.js";

const me = await shell("sar");
const view = document.getElementById("view");
document.getElementById("main").hidden = false;
const Y = me.year.id;
const CAN_EDIT = !!(me.user.can_import || me.user.role === "superadmin"); // ผู้บริหารดูอย่างเดียว
let d, ev, stage = sessionStorage.getItem("sr-sar-stage") || "basic";
const pending = new Map(); // item_key → {target, manual_value, note}
const fmt = (v) => (v == null ? "–" : String(Number((Math.trunc(Number((Number(v) * 100).toPrecision(12))) / 100).toPrecision(12)))); // ไม่ปัด
const LEVEL_CLASS = { "ยอดเยี่ยม": "lv5", "ดีเลิศ": "lv4", "ดี": "lv3", "ปานกลาง": "lv2", "กำลังพัฒนา": "lv1" };
const levelTag = (l) => (l ? `<span class="sar-lv ${LEVEL_CLASS[l] || ""}">${esc(l)}</span>` : '<span class="muted small">ยังไม่มีข้อมูล</span>');
const metTag = (m) => (m == null ? "" : m ? '<span class="tag ok">บรรลุ</span>' : '<span class="tag warn">ไม่บรรลุ</span>');
const metricText = (k, metrics) => { const m = metrics?.[k]; return m ? `${fmt(pctOf(m))}% <span class="muted small">(${m.num.toLocaleString("th-TH")}/${m.den.toLocaleString("th-TH")})</span>` : '<span class="muted small">ยังไม่มีข้อมูลในระบบ</span>'; };

async function load() {
  d = await api(`/api/sar?year=${Y}`);
  draw();
}

function draw() {
  ev = evaluateSar(d.metrics, d.values, d.levels);
  const st = SAR_STAGES.find((s) => s.key === stage) || SAR_STAGES[0];
  const metrics = d.metrics[st.key] || {};
  const cov = d.coverage[st.key];
  document.getElementById("yearLine").textContent = `ปีการศึกษา ${d.year.year_be} · ${d.school.name || ""} · คำนวณจากข้อมูลจริงในระบบ ณ วันที่เปิดหน้านี้`;
  view.innerHTML = `
    <div class="log-forms" role="tablist" aria-label="ระดับ">${SAR_STAGES.map((s) => `<button role="tab" data-stage="${s.key}" aria-selected="${s.key === st.key}">${s.title}</button>`).join("")}</div>
    <div class="cal-summary">
      <div class="cal-stat total"><span>${esc(st.standard)}</span><strong>${fmt(ev.stages[st.key].value)}${ev.stages[st.key].value == null ? "" : "%"}</strong><small>${ev.stages[st.key].level || "ยังไม่มีข้อมูล"}</small></div>
      ${st.groups.map((g) => `<div class="cal-stat"><span>${esc(g.key.replace(/^k/, ""))} ${esc(g.title)}</span><strong>${fmt(ev.groups[g.key].value)}${ev.groups[g.key].value == null ? "" : "%"}</strong>
        <small>${ev.groups[g.key].level || "ยังไม่มีข้อมูล"} · มีผล ${ev.groups[g.key].filled}/${ev.groups[g.key].total} ประเด็น</small></div>`).join("")}
    </div>
    <p class="muted small" style="margin:-6px 0 14px">คำนวณจาก ${cov.rooms} ห้อง ${cov.students.toLocaleString("th-TH")} คน · ผลของประเด็น = ค่าที่กรอกเอง (ถ้ามี) ไม่งั้นใช้ค่าจากระบบ · ระดับคุณภาพตามเกณฑ์ด้านล่าง · ${CAN_EDIT ? "บันทึกอัตโนมัติ" : "ดูอย่างเดียว"}
      <span class="save-state" id="saveState" style="margin-left:8px">บันทึกแล้ว</span></p>
    ${st.groups.map((g) => `<div class="panel">
      <div class="panel-head"><h2>${esc(g.key.replace(/^k/, ""))} ${esc(g.title)}</h2>${levelTag(ev.groups[g.key].level)}</div>
      <div class="table-wrap"><table class="list sar-table"><thead><tr><th>ประเด็นพิจารณา</th><th class="num">ผลจากระบบ</th><th class="num">กรอกเอง (%)</th><th class="num">ค่าเป้าหมาย (%)</th><th class="num">ผล</th><th>ระดับ</th><th>เป้าหมาย</th></tr></thead>
      <tbody>${g.items.map((it) => { const r = ev.items[it.key]; return `<tr data-item="${it.key}">
        <td><b>${esc(it.key.replace(/^k/, ""))}</b> ${esc(it.title)}
          <details class="sar-more"><summary class="small">ที่มาของข้อมูล${r.note ? " · มีหมายเหตุ" : ""}</summary>
            <ul class="small">${it.main && !it.main.startsWith("avg:") ? `<li><b>หลัก:</b> ${esc(metricLabel(it.main))} — ${metricText(it.main, metrics)}</li>` : it.main ? `<li><b>หลัก:</b> ค่าเฉลี่ยของตัวชี้วัดด้านล่างที่มีข้อมูล</li>` : "<li>ระบบยังไม่มีข้อมูลสำหรับประเด็นนี้ — กรอกผลเองในช่อง \"กรอกเอง\"</li>"}
              ${it.subs.map((k) => `<li>${esc(metricLabel(k))} — ${metricText(k, metrics)}${it.main?.startsWith("avg:") && !it.main.slice(4).split(",").includes(k) ? ' <span class="muted">(ข้อมูลประกอบ ไม่นำมาเฉลี่ย)</span>' : ""}</li>`).join("")}</ul>
            <label class="field small">หมายเหตุ / หลักฐานอ้างอิง (ไปใน Word)<textarea data-f="note" rows="2" maxlength="2000" ${CAN_EDIT ? "" : "disabled"}>${esc(r.note)}</textarea></label>
          </details></td>
        <td class="num">${r.auto == null ? '<span class="muted small">–</span>' : `${fmt(r.auto)}%`}</td>
        <td class="num"><input class="sar-in" data-f="manual_value" inputmode="decimal" value="${r.manual ?? ""}" placeholder="${it.main ? "ใช้ค่าระบบ" : "กรอก"}" ${CAN_EDIT ? "" : "disabled"} aria-label="ผลที่กรอกเอง ${esc(it.key)}"></td>
        <td class="num"><input class="sar-in" data-f="target" inputmode="decimal" value="${r.target ?? ""}" ${CAN_EDIT ? "" : "disabled"} aria-label="ค่าเป้าหมาย ${esc(it.key)}"></td>
        <td class="num" data-cell="value"><b>${fmt(r.value)}${r.value == null ? "" : "%"}</b></td>
        <td data-cell="level">${levelTag(r.level)}</td><td data-cell="met">${metTag(r.met)}</td></tr>`; }).join("")}</tbody></table></div></div>`).join("")}
    ${st.key === "basic" ? gradeAreaPanel() : ""}
    <details class="panel"><summary><b>เกณฑ์ระดับคุณภาพ</b> <span class="muted small">${d.levels.map((l) => `${esc(l.label)} ≥ ${fmt(l.min)}`).join(" · ")}</span></summary>
      <div style="display:grid;gap:8px;margin-top:12px;max-width:420px">${d.levels.map((l, i) => `<div style="display:grid;grid-template-columns:1fr 110px;gap:8px;align-items:center">
        <input data-lvl-label="${i}" value="${esc(l.label)}" ${CAN_EDIT ? "" : "disabled"}><input data-lvl-min="${i}" inputmode="decimal" value="${l.min}" ${CAN_EDIT ? "" : "disabled"} aria-label="ร้อยละขั้นต่ำ"></div>`).join("")}</div>
      ${CAN_EDIT ? `<div class="actions" style="margin-top:12px"><button class="btn small primary" id="lvlSave">บันทึกเกณฑ์</button><button class="btn small" id="lvlReset">ใช้ค่าเริ่มต้น</button></div>` : ""}
      <p class="muted small">ร้อยละขั้นต่ำของแต่ละระดับ — ปรับให้ตรงเกณฑ์ที่โรงเรียนประกาศ</p></details>`;

  for (const b of view.querySelectorAll("[data-stage]")) b.onclick = async () => { await flush(); stage = b.dataset.stage; sessionStorage.setItem("sr-sar-stage", stage); draw(); };
  if (!CAN_EDIT) return;
  view.querySelectorAll("tr[data-item]").forEach((tr) => {
    const key = tr.dataset.item;
    tr.addEventListener("input", (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      const v = e.target.value.trim().replace(",", ".");
      if (f !== "note" && v !== "" && !(Number(v) >= 0 && Number(v) <= 100)) { e.target.classList.add("bad"); return; }
      e.target.classList.remove("bad");
      const cur = d.values[key] || {};
      d.values[key] = { ...cur, [f]: f === "note" ? v : v === "" ? null : Number(v) };
      pending.set(key, d.values[key]);
      refreshRow(tr, key);
      state("pending"); save();
    });
  });
  document.getElementById("lvlSave").onclick = async () => {
    const levels = d.levels.map((_, i) => ({ label: view.querySelector(`[data-lvl-label="${i}"]`).value.trim(), min: Number(view.querySelector(`[data-lvl-min="${i}"]`).value) }));
    try { d = await api(`/api/sar?year=${Y}`, { method: "PUT", body: { values: [], levels } }); toast("บันทึกเกณฑ์แล้ว"); draw(); } catch (err) { showError(err); }
  };
  document.getElementById("lvlReset").onclick = async () => { try { d = await api(`/api/sar?year=${Y}`, { method: "PUT", body: { values: [], levels: null } }); toast("ใช้เกณฑ์ค่าเริ่มต้นแล้ว"); draw(); } catch (err) { showError(err); } };
}

function refreshRow(tr, key) {
  ev = evaluateSar(d.metrics, d.values, d.levels);
  const r = ev.items[key];
  tr.querySelector('[data-cell="value"]').innerHTML = `<b>${fmt(r.value)}${r.value == null ? "" : "%"}</b>`;
  tr.querySelector('[data-cell="level"]').innerHTML = levelTag(r.level);
  tr.querySelector('[data-cell="met"]').innerHTML = metTag(r.met);
}

function gradeAreaPanel() {
  const grades = [...new Set(d.grade_area.map((g) => g.grade_level))];
  const areas = [...new Set(d.grade_area.map((g) => g.learning_area))];
  if (!grades.length) return `<div class="panel"><div class="panel-head"><h2>ผลสัมฤทธิ์รายชั้น × กลุ่มสาระ</h2></div><p class="empty">ยังไม่มีผลการเรียนที่ตัดเกรดแล้ว</p></div>`;
  const cell = (g, a) => { const x = d.grade_area.find((r) => r.grade_level === g && r.learning_area === a); return x ? `${fmt(pctOf(x))}` : "–"; };
  return `<div class="panel"><div class="panel-head"><h2>ผลสัมฤทธิ์รายชั้น × กลุ่มสาระ</h2><span class="muted small">ร้อยละของผลการเรียนระดับ 3 ขึ้นไป</span></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>กลุ่มสาระ</th>${grades.map((g) => `<th class="num">${esc(g)}</th>`).join("")}</tr></thead>
    <tbody>${areas.map((a) => `<tr><td>${esc(a)}</td>${grades.map((g) => `<td class="num">${cell(g, a)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}

let saving = false;
function state(s, err) {
  const el = document.getElementById("saveState");
  if (!el) return;
  el.className = "save-state";
  if (s === "error") { el.classList.add("error"); el.textContent = `บันทึกไม่สำเร็จ — ${err}`; }
  else if (s === "pending") { el.classList.add("pending"); el.textContent = "กำลังบันทึก…"; }
  else el.textContent = "บันทึกแล้ว";
}
async function flush() {
  if (saving || !pending.size) return;
  saving = true;
  const list = [...pending.entries()].map(([item_key, v]) => ({ item_key, target: v.target ?? "", manual_value: v.manual_value ?? "", note: v.note ?? "" }));
  pending.clear();
  try { await api(`/api/sar?year=${Y}`, { method: "PUT", body: { values: list } }); state("ok"); }
  catch (err) { for (const v of list) if (!pending.has(v.item_key)) pending.set(v.item_key, d.values[v.item_key]); state("error", err.message); }
  finally { saving = false; if (pending.size) save(); }
}
const save = debounce(flush, 800);
window.addEventListener("beforeunload", (e) => { if (pending.size || saving) { e.preventDefault(); e.returnValue = ""; } });

// ---------- ส่งออก ----------
function rowsFor(st) {
  const metrics = d.metrics[st.key] || {};
  const out = [];
  for (const g of st.groups) {
    out.push({ kind: "group", key: g.key.replace(/^k/, ""), title: g.title, value: ev.groups[g.key].value, level: ev.groups[g.key].level });
    for (const it of g.items) {
      const r = ev.items[it.key];
      const evidence = [it.main && !it.main.startsWith("avg:") ? it.main : null, ...it.subs].filter(Boolean).map((k) => metrics[k] ? `${metricLabel(k)} ${fmt(pctOf(metrics[k]))}% (${metrics[k].num}/${metrics[k].den})` : null).filter(Boolean);
      out.push({ kind: "item", key: it.key.replace(/^k/, ""), title: it.title, target: r.target, value: r.value, level: r.level, met: r.met, source: r.manual != null ? "กรอกเอง" : r.auto != null ? "ระบบ" : "", evidence, note: r.note });
    }
  }
  return out;
}

document.getElementById("xlsxBtn").onclick = async () => {
  try {
    await flush();
    const X = await loadXlsx();
    const wb = X.utils.book_new();
    for (const st of SAR_STAGES) {
      const head = [[`ข้อมูลประกอบ SAR ${st.standard} ${st.title}`], [`${d.school.name || ""} ปีการศึกษา ${d.year.year_be} · ผลรวมมาตรฐาน ${fmt(ev.stages[st.key].value)}% ระดับ ${ev.stages[st.key].level || "-"}`], [],
        ["ประเด็น", "ประเด็นพิจารณา", "ค่าเป้าหมาย (%)", "ผล (%)", "ระดับคุณภาพ", "บรรลุเป้าหมาย", "ที่มาของผล", "ข้อมูลสนับสนุนจากระบบ", "หมายเหตุ/หลักฐาน"]];
      const body = rowsFor(st).map((r) => r.kind === "group" ? [r.key, r.title, "", r.value ?? "", r.level || "", "", "", "", ""]
        : [r.key, r.title, r.target ?? "", r.value ?? "", r.level || "", r.met == null ? "" : r.met ? "บรรลุ" : "ไม่บรรลุ", r.source, r.evidence.join("\n"), r.note]);
      const ws = X.utils.aoa_to_sheet([...head, ...body]);
      ws["!cols"] = [{ wch: 8 }, { wch: 60 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 70 }, { wch: 40 }];
      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }];
      X.utils.book_append_sheet(wb, ws, st.key === "basic" ? "ขั้นพื้นฐาน" : "ปฐมวัย");
    }
    const grades = [...new Set(d.grade_area.map((g) => g.grade_level))], areas = [...new Set(d.grade_area.map((g) => g.learning_area))];
    const ga = [["ร้อยละของผลการเรียนระดับ 3 ขึ้นไป รายชั้น × กลุ่มสาระ"], [], ["กลุ่มสาระ", ...grades],
      ...areas.map((a) => [a, ...grades.map((g) => { const x = d.grade_area.find((r) => r.grade_level === g && r.learning_area === a); return x ? pctOf(x) : ""; })])];
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(ga), "ผลสัมฤทธิ์รายชั้น");
    X.writeFile(wb, `ข้อมูล SAR มาตรฐานที่ 1 ปี ${d.year.year_be}.xlsx`);
  } catch (err) { showError(err); }
};

document.getElementById("docBtn").onclick = async () => {
  await flush();
  const td = (v, cls = "") => `<td class="${cls}">${v ?? ""}</td>`;
  const sections = SAR_STAGES.map((st) => `<h2>${esc(st.standard)} (${esc(st.title)})</h2>
    <p>ผลการประเมินภาพรวม ร้อยละ ${fmt(ev.stages[st.key].value)} ระดับคุณภาพ <b>${esc(ev.stages[st.key].level || "-")}</b></p>
    <table><tr><th style="width:9%">ประเด็น</th><th>ประเด็นพิจารณา</th><th style="width:11%">ค่าเป้าหมาย</th><th style="width:9%">ผล</th><th style="width:12%">ระดับ</th><th style="width:11%">เป้าหมาย</th></tr>
    ${rowsFor(st).map((r) => r.kind === "group" ? `<tr class="g">${td(r.key)}${td(esc(r.title))}${td("")}${td(fmt(r.value), "c")}${td(esc(r.level || ""), "c")}${td("")}</tr>`
      : `<tr>${td(r.key, "c")}<td>${esc(r.title)}${r.evidence.length || r.note ? `<div class="ev">${r.evidence.map(esc).join("<br>")}${r.note ? `${r.evidence.length ? "<br>" : ""}หลักฐาน: ${esc(r.note)}` : ""}</div>` : ""}</td>${td(fmt(r.target), "c")}${td(fmt(r.value), "c")}${td(esc(r.level || ""), "c")}${td(r.met == null ? "" : r.met ? "บรรลุ" : "ไม่บรรลุ", "c")}</tr>`).join("")}</table>`).join("");
  const grades = [...new Set(d.grade_area.map((g) => g.grade_level))], areas = [...new Set(d.grade_area.map((g) => g.learning_area))];
  const ga = grades.length ? `<h2>ร้อยละของผลการเรียนระดับ 3 ขึ้นไป รายชั้น × กลุ่มสาระการเรียนรู้</h2><table><tr><th>กลุ่มสาระการเรียนรู้</th>${grades.map((g) => `<th>${esc(g)}</th>`).join("")}</tr>
    ${areas.map((a) => `<tr><td>${esc(a)}</td>${grades.map((g) => { const x = d.grade_area.find((r) => r.grade_level === g && r.learning_area === a); return td(x ? fmt(pctOf(x)) : "–", "c"); }).join("")}</tr>`).join("")}</table>` : "";
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>ข้อมูล SAR</title>
    <style>@page{size:A4;margin:2cm 2cm 2cm 2.5cm}body{font-family:"TH SarabunPSK","TH Sarabun New","Sarabun";font-size:16pt}h1{font-size:20pt;text-align:center}h2{font-size:18pt;margin-top:18pt}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:2pt 4pt;vertical-align:top;font-size:15pt}th{background:#e8ecf7}td.c{text-align:center}tr.g td{font-weight:bold;background:#f3f5fb}.ev{font-size:13pt;color:#333;margin-top:2pt}</style></head>
    <body><h1>ข้อมูลประกอบรายงานการประเมินตนเองของสถานศึกษา (SAR)<br>ปีการศึกษา ${d.year.year_be}</h1><p style="text-align:center">${esc(d.school.name || "")}${d.school.affiliation ? ` ${esc(d.school.affiliation)}` : ""}</p>
    ${sections}${ga}<p style="margin-top:14pt;font-size:13pt">เกณฑ์ระดับคุณภาพ: ${d.levels.map((l) => `${esc(l.label)} ร้อยละ ${fmt(l.min)} ขึ้นไป`).join(" · ")} · ข้อมูลจากระบบรายงานผลการเรียน ณ วันที่ ${new Date().toLocaleDateString("th-TH", { dateStyle: "long" })}</p></body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `ข้อมูล SAR มาตรฐานที่ 1 ปี ${d.year.year_be}.doc` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

load().catch((err) => { view.innerHTML = `<div class="panel empty"><strong>โหลดไม่สำเร็จ</strong>${esc(err.message)}</div>`; });
