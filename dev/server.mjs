// เซิร์ฟเวอร์ทดสอบบนเครื่อง: node --no-warnings dev/server.mjs [port]
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import worker from "../src/index.js";
import { createD1, loadBaseSchema } from "./d1-shim.mjs";
import { seed } from "./seed.mjs";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".json": "application/json", ".ico": "image/x-icon" };

export async function makeEnv() {
  const DB = createD1();
  loadBaseSchema(DB);
  await seed(DB);
  const ASSETS = {
    async fetch(request) {
      let p = decodeURIComponent(new URL(request.url).pathname);
      if (p.endsWith("/")) p += "index.html";
      let file = normalize(join(PUBLIC, p));
      if (!file.startsWith(PUBLIC)) return new Response("forbidden", { status: 403 });
      try { await stat(file); } catch {
        try { await stat(file + ".html"); file += ".html"; } catch {
          return new Response(await readFile(join(PUBLIC, "404.html")).catch(() => "not found"), { status: 404, headers: { "Content-Type": TYPES[".html"] } });
        }
      }
      return new Response(await readFile(file), { headers: { "Content-Type": TYPES[extname(file)] || "application/octet-stream" } });
    },
  };
  return { DB, ASSETS, JWT_SECRET: "dev-secret-for-local-testing-only" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = await makeEnv();
  const port = Number(process.argv[2] || 8787);
  http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    try {
      const r = await worker.fetch(request, env);
      const headers = {};
      r.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); }
  }).listen(port, () => console.log(`dev server http://localhost:${port}`));
}
