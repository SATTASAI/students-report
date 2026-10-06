// จำลอง Cloudflare D1 ด้วย node:sqlite สำหรับทดสอบบนเครื่อง
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function createD1(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  const wrap = (sql, values = []) => ({
    sql, values,
    bind(...args) { return wrap(sql, args); },
    async first(col) { const r = db.prepare(sql).get(...norm(values)); return r ? (col ? r[col] : { ...r }) : null; },
    async all() { return { results: db.prepare(sql).all(...norm(values)).map((r) => ({ ...r })), success: true }; },
    async run() { const r = db.prepare(sql).run(...norm(values)); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    raw: db,
    prepare: (sql) => wrap(sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) {
          const st = db.prepare(s.sql);
          if (/^\s*(select|with)/i.test(s.sql)) out.push({ results: st.all(...norm(s.values)) });
          else { const r = st.run(...norm(s.values)); out.push({ meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }); }
        }
        db.exec("COMMIT");
        return out;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    exec: (sql) => db.exec(sql),
  };
}

function norm(values) {
  return values.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v));
}

export function loadBaseSchema(d1) {
  d1.exec(readFileSync(new URL("./base-schema.sql", import.meta.url), "utf8"));
}
