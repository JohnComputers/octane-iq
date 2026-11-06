import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "dist/index.html"), "utf8");
const app = await readFile(resolve(root, "dist/app.js"), "utf8");
const css = await readFile(resolve(root, "dist/styles.css"), "utf8");
const errors = [];

for (const relative of ["dist/index.html", "dist/styles.css", "dist/app.js", "dist/spotter.html", "dist/spotter.css", "dist/spotter.js", "dist/credits.html", "dist/credits.js", "dist/data/questions.json", "dist/data/cars.json", "dist/sw.js", "dist/manifest.webmanifest", "dist/favicon.svg"]) {
  try { await access(resolve(root, relative)); }
  catch { errors.push(`Missing required asset: ${relative}`); }
}

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicateIds.length) errors.push(`Duplicate HTML ids: ${[...new Set(duplicateIds)].join(", ")}`);

const appIdReferences = [...app.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]);
const missingIds = [...new Set(appIdReferences.filter((id) => !ids.includes(id)))];
if (missingIds.length) errors.push(`App references missing HTML ids: ${missingIds.join(", ")}`);

for (const match of html.matchAll(/<button\b([^>]*)>/g)) {
  if (!/\btype="button"/.test(match[1])) errors.push(`Button missing type="button": ${match[0].slice(0, 100)}`);
}

if (!html.includes('id="live-region"') || !html.includes('aria-live="polite"')) errors.push("Missing polite live region.");
if (!html.includes('class="skip-link"')) errors.push("Missing skip link.");
if (!css.includes("prefers-reduced-motion")) errors.push("Missing reduced-motion styles.");
if (!app.includes("localStorage")) errors.push("Missing local progress persistence.");
if (!app.includes("navigator.share")) errors.push("Missing native share support.");
if (/lorem ipsum|dailycarquiz|\.example\b/i.test(`${html}\n${app}`)) errors.push("Found placeholder or copied reference-site text.");
if (/\b(?:href|src)="\/(?!\/)/.test(html)) errors.push("Root-relative HTML asset found; GitHub Pages assets must be project-relative.");

if (errors.length) {
  console.error(`Site validation failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Validated site shell: ${ids.length} unique ids, ${appIdReferences.length} DOM references, accessible controls present.`);
