import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// load .env.local without deps (before importing modules that read env at call time)
try {
  const env = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const { runSearch } = await import("../lib/search.ts");
const { handleRpc } = await import("../lib/mcp.ts");
const { thesisFromText } = await import("../lib/thesis.ts");

const PUB = new URL("../public/", import.meta.url).pathname;
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".woff2": "font/woff2", ".mjs": "text/javascript", ".md": "text/markdown", ".json": "application/json" };

http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/search") {
    let body = "";
    for await (const ch of req) body += ch;
    try {
      const { q, criteria } = JSON.parse(body || "{}");
      if (!q || typeof q !== "string") { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "q required" })); return; }
      const t = Date.now();
      const out = await runSearch(q, criteria);
      console.log(`search "${q}" -> ${out.candidates.length} candidates in ${Date.now() - t}ms`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e: any) {
      console.error(e);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e?.message ?? String(e) }));
    }
    return;
  }
  if (req.method === "POST" && req.url === "/api/thesis") {
    let body = "";
    for await (const ch of req) body += ch;
    try { const b = JSON.parse(body || "{}"); const out = await thesisFromText(b.text, b.filename); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out)); }
    catch (e: any) { res.writeHead(422, { "content-type": "application/json" }); res.end(JSON.stringify({ error: e?.message ?? String(e) })); }
    return;
  }
  if (req.method === "POST" && req.url === "/api/mcp") {
    let body = "";
    for await (const ch of req) body += ch;
    let msg: any;
    try { msg = JSON.parse(body || "null"); } catch { res.writeHead(400); res.end(); return; }
    const out = Array.isArray(msg) ? (await Promise.all(msg.map((m) => handleRpc(m, runSearch)))).filter(Boolean) : await handleRpc(msg, runSearch);
    if (!out || (Array.isArray(out) && !out.length)) { res.writeHead(202); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
    return;
  }
  if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/api/status") {
    const { getStatus } = await import("../lib/status.ts");
    const out = await getStatus(/[?&]fresh=1/.test(req.url ?? ""));
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(out));
    return;
  }
  const rel = req.url === "/" ? "index.html" : req.url === "/docs" ? "docs.html" : req.url === "/sponsors" ? "sponsors.html" : req.url === "/hackathon" ? "hackathon.html" : (req.url ?? "").split("?")[0];
  const f = path.join(PUB, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (f.startsWith(PUB) && existsSync(f)) {
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" });
    res.end(await readFile(f));
    return;
  }
  res.writeHead(404);
  res.end("not found");
}).listen(Number(process.env.PORT ?? 3000), () => console.log(`labscout dev on http://localhost:${process.env.PORT ?? 3000}`));
