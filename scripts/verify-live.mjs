import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";

const dist = resolve(import.meta.dirname, "../dist");
const base = new URL(process.argv[2] || "http://127.0.0.1:4173/octane-iq/");
if (!base.pathname.endsWith("/")) base.pathname += "/";
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.filter((item) => !item.name.startsWith(".")).map((entry) => entry.isDirectory() ? filesIn(resolve(directory, entry.name)) : resolve(directory, entry.name)))).flat();
}

const files = await filesIn(dist);
const errors = [];
let photos = 0;
for (let start = 0; start < files.length; start += 5) {
  await Promise.all(files.slice(start, start + 5).map(async (file) => {
    const local = await readFile(file);
    const name = relative(dist, file).split(sep).join("/");
    const url = new URL(name, base);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const remote = Buffer.from(await response.arrayBuffer());
      const isText = /\.(?:html|css|js|json|svg|webmanifest)$/.test(name);
      const canonical = (bytes) => isText ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes;
      if (sha(canonical(local)) !== sha(canonical(remote))) throw new Error("deployed content differs from local asset");
      if (/\.jpe?g$/.test(name)) {
        if (!response.headers.get("content-type")?.includes("image/jpeg")) throw new Error("wrong JPEG content type");
        photos += 1;
      }
    } catch (error) { errors.push(`${name}: ${error.message}`); }
  }));
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Verified ${files.length} published assets at ${base.href}. All ${photos} car photos return HTTP 200, image/jpeg, and the exact expected SHA-256 checksum.`);
