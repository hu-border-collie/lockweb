/**
 * 构建产物静态服务（验收与截图用，不参与应用运行）。
 * 用法：SERVE_DIR=dist SERVE_PORT=4174 node scripts/serve.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.SERVE_DIR || "dist");
const port = Number(process.env.SERVE_PORT || 4174);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (stat.isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
      "service-worker-allowed": "/",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`serving ${root} at http://127.0.0.1:${port}`);
  });
