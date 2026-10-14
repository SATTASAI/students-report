// สำรองข้อมูล / กู้คืนข้อมูล เป็นไฟล์ JSON (เฉพาะผู้ดูแลระบบ) — หน้า admin.html#backup
import { api, esc, toast, showError, dialog } from "/js/app.js";

const pad = (n) => String(n).padStart(2, "0");
const stamp = () => { const d = new Date(); return `${d.getFullYear() + 543}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

// ดึงทุกตารางทีละหน้าแล้วรวมเป็นไฟล์เดียว
export async function buildBackup(onProgress = () => {}) {
  const meta = await api("/api/backup/tables");
  const total = meta.tables.reduce((a, t) => a + t.count, 0) || 1;
  let done = 0;
  const tables = {};
  for (const t of meta.tables) {
    const rows = [];
    let after = 0, columns = t.columns;
    for (;;) {
      const r = await api(`/api/backup/rows?table=${encodeURIComponent(t.name)}&after=${after}`);
      rows.push(...r.rows); columns = r.columns; done += r.rows.length;
      onProgress(Math.min(99, Math.round((done / total) * 100)), t.name);
      if (r.next == null) break;
      after = r.next;
    }
    tables[t.name] = { columns, count: rows.length, rows };
  }
  return { format: meta.format, schema: meta.schema, system: "ระบบรายงานผลการเรียน โรงเรียนบ้านป่าเด็ง", created_at: new Date().toISOString(), tables };
}
function download(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  return blob.size;
}

export async function renderBackup(view) {
  const meta = await api("/api/backup/tables");
  const rows = meta.tables.reduce((a, t) => a + t.count, 0);
  view.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>สำรองข้อมูล</h2><span class="muted small">${meta.tables.length} ตาราง · ${rows.toLocaleString("th-TH")} แถว · โครงสร้าง ${esc(meta.schema)}</span></div>
      <p class="muted" style="margin-top:0">ดาวน์โหลดข้อมูลทั้งหมดของระบบรายงานผลการเรียน (ทุกปีการศึกษา) เป็นไฟล์ JSON ไฟล์เดียว — รายวิชา โครงสร้างคะแนน คะแนน ผลการเรียน การประเมิน การมาเรียน แบบบันทึกประจำวัน ปฏิทินวันหยุด SAR ฯลฯ
        <br>ไม่รวมบัญชีผู้ใช้ ทะเบียนนักเรียน และปี/ภาคเรียน ซึ่งอยู่ในระบบบริหารโรงเรียน (สำรองที่ระบบนั้น)</p>
      <button class="btn primary" id="bkBtn">ดาวน์โหลดไฟล์สำรอง (.json)</button>
      <div class="meter" id="bkMeter" hidden style="margin-top:12px"><i style="width:0%"></i></div><p class="muted small" id="bkMsg"></p>
      <details style="margin-top:8px"><summary class="small">รายการตาราง</summary>
        <div class="table-wrap"><table class="list"><thead><tr><th>ตาราง</th><th class="num">แถว</th><th>กู้คืน</th></tr></thead>
        <tbody>${meta.tables.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.count.toLocaleString("th-TH")}</td><td>${t.restorable ? "✓" : '<span class="muted small">เก็บของเดิม</span>'}</td></tr>`).join("")}</tbody></table></div></details>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>กู้คืนข้อมูลจากไฟล์</h2></div>
      <p class="note warn" style="margin-top:0"><b>ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ด้วยข้อมูลในไฟล์</b> (ทุกปีการศึกษา) — ก่อนกู้คืน ระบบจะดาวน์โหลดไฟล์สำรองของข้อมูลปัจจุบันให้อัตโนมัติ
        ถ้าการอัปโหลดล้มกลางทาง ข้อมูลเดิมจะไม่ถูกเปลี่ยน (สลับข้อมูลครั้งเดียวตอนอัปโหลดครบ) · ประวัติการใช้งานคงของเดิมไว้</p>
      <label class="btn">เลือกไฟล์สำรอง (.json)<input type="file" id="rsFile" accept=".json,application/json" hidden></label>
      <div id="rsInfo" style="margin-top:12px"></div>
    </div>`;

  const meter = view.querySelector("#bkMeter"), msg = view.querySelector("#bkMsg");
  const progress = (pct, text) => { meter.hidden = false; meter.firstElementChild.style.width = `${pct}%`; msg.textContent = text; };
  view.querySelector("#bkBtn").onclick = async (e) => {
    e.target.disabled = true;
    try {
      const file = await buildBackup((p, t) => progress(p, `กำลังดึง ${t}… ${p}%`));
      const size = download(file, `สำรองข้อมูลระบบผลการเรียน-${stamp()}.json`);
      progress(100, `ดาวน์โหลดแล้ว ${sizeText(size)} — เก็บไฟล์ไว้ในที่ปลอดภัย (เช่น Google Drive ของโรงเรียน)`);
    } catch (err) { showError(err); msg.textContent = ""; }
    finally { e.target.disabled = false; }
  };

  view.querySelector("#rsFile").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    const info = view.querySelector("#rsInfo");
    if (!f) return;
    let file;
    try { file = JSON.parse(await f.text()); } catch { info.innerHTML = '<p class="note bad">อ่านไฟล์ไม่ได้ — ไม่ใช่ไฟล์ JSON</p>'; return; }
    if (file?.format !== meta.format || !file.tables) { info.innerHTML = '<p class="note bad">ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบรายงานผลการเรียน</p>'; return; }
    const list = Object.entries(file.tables);
    const n = list.reduce((a, [, t]) => a + (t.rows?.length || 0), 0);
    const bad = list.filter(([, t]) => !Array.isArray(t.rows) || t.rows.length !== t.count).map(([k]) => k);
    if (bad.length) { info.innerHTML = `<p class="note bad">ไฟล์ไม่สมบูรณ์ (ตาราง ${esc(bad.join(", "))} จำนวนแถวไม่ตรง)</p>`; return; }
    const when = file.created_at ? new Date(file.created_at).toLocaleString("th-TH", { dateStyle: "long", timeStyle: "short" }) : "ไม่ทราบ";
    info.innerHTML = `<div class="note"><b>${esc(f.name)}</b><br>สำรองเมื่อ ${esc(when)} · ${list.length} ตาราง · ${n.toLocaleString("th-TH")} แถว · โครงสร้าง ${esc(file.schema || "?")}${file.schema !== meta.schema ? ` (ระบบปัจจุบัน ${esc(meta.schema)} — คอลัมน์ที่เพิ่มภายหลังจะใช้ค่าเริ่มต้น)` : ""}</div>
      <button class="btn danger" id="rsGo" style="margin-top:10px">กู้คืนจากไฟล์นี้</button><div class="meter" id="rsMeter" hidden style="margin-top:12px"><i style="width:0%"></i></div><p class="muted small" id="rsMsg"></p>`;
    view.querySelector("#rsGo").onclick = async (ev) => {
      const ok = await dialog({
        title: "ยืนยันการกู้คืนข้อมูล", okText: "กู้คืน", okClass: "danger",
        body: `<p>ข้อมูลปัจจุบันของระบบรายงานผลการเรียน<b>ทั้งหมด</b>จะถูกแทนที่ด้วยข้อมูลในไฟล์ที่สำรองเมื่อ ${esc(when)}</p>
          <p class="muted small">ระบบจะดาวน์โหลดไฟล์สำรองของข้อมูลปัจจุบันให้ก่อน · ควรทำนอกเวลาที่ครูกำลังกรอกคะแนน</p>
          <label class="field">พิมพ์คำว่า <b>กู้คืน</b> เพื่อยืนยัน<input name="confirm" required autocomplete="off"></label>`,
      });
      if (!ok.ok || ok.data.confirm.trim() !== "กู้คืน") { if (ok.ok) toast("พิมพ์คำยืนยันไม่ถูกต้อง", "bad"); return; }
      ev.target.disabled = true;
      const m = view.querySelector("#rsMeter"), t = view.querySelector("#rsMsg");
      const step = (pct, text) => { m.hidden = false; m.firstElementChild.style.width = `${pct}%`; t.textContent = text; };
      try {
        step(2, "กำลังสำรองข้อมูลปัจจุบันก่อนกู้คืน…");
        const safety = await buildBackup((p) => step(Math.round(p * 0.3), `กำลังสำรองข้อมูลปัจจุบัน… ${p}%`));
        download(safety, `สำรองก่อนกู้คืน-${stamp()}.json`);
        const head = { format: file.format, schema: file.schema, tables: Object.fromEntries(list.map(([k, v]) => [k, { columns: v.columns, count: v.count }])) };
        const st = await api("/api/backup/restore/start", { method: "POST", body: head });
        const total = st.tables.reduce((a, x) => a + x.count, 0) || 1;
        let sent = 0;
        for (const x of st.tables) {
          const { columns, rows } = file.tables[x.name];
          for (let i = 0; i < rows.length; i += 500) {
            await api("/api/backup/restore/rows", { method: "POST", body: { table: x.name, columns, rows: rows.slice(i, i + 500) } });
            sent += Math.min(500, rows.length - i);
            step(30 + Math.round((sent / total) * 65), `กำลังอัปโหลด ${x.name}… ${sent.toLocaleString("th-TH")}/${total.toLocaleString("th-TH")} แถว`);
          }
        }
        step(97, "กำลังสลับข้อมูล…");
        await api("/api/backup/restore/finish", { method: "POST", body: {} });
        step(100, `กู้คืนสำเร็จ ${total.toLocaleString("th-TH")} แถว${st.warnings?.length ? ` · ${st.warnings.join(" · ")}` : ""}`);
        toast("กู้คืนข้อมูลแล้ว");
      } catch (err) {
        showError(err);
        t.textContent = `กู้คืนไม่สำเร็จ — ข้อมูลเดิมยังอยู่ครบ (${err.message})`;
        api("/api/backup/restore/cancel", { method: "POST", body: {} }).catch(() => {});
      } finally { ev.target.disabled = false; }
    };
  };
}
