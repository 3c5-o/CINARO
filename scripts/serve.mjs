import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const port = Number(process.env.CINARO_PORT || 4173);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".vtt": "text/vtt; charset=utf-8"
};

const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const absolute = path.resolve(root, relative);

  if (!absolute.startsWith(root) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypes[path.extname(absolute)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(absolute).pipe(response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`CINARO is running at http://127.0.0.1:${port}`);
});
