import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const basePath = process.env.BASE_PATH ? `/${process.env.BASE_PATH.replace(/^\/+|\/+$/g, "")}/` : "/";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (basePath !== "/" && url.pathname === basePath.slice(0, -1)) {
      response.writeHead(301, { Location: basePath }); response.end(); return;
    }
    if (!url.pathname.startsWith(basePath)) throw new Error("Outside base path");
    const relative = url.pathname.slice(basePath.length);
    const requested = decodeURIComponent(relative === "" ? "index.html" : relative);
    const filePath = resolve(join(root, normalize(requested).replace(/^[/\\]+/, "")));
    if (!filePath.startsWith(root + "/") && !filePath.startsWith(root + "\\")) throw new Error("Invalid path");
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Octane IQ preview: http://127.0.0.1:${port}${basePath}`);
});
