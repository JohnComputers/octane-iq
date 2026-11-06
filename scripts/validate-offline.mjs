import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../dist");
const base = "https://johncomputers.github.io/octane-iq/";
const handlers = {};
const cacheData = new Map();
let offline = false;
const key = (request, ignoreSearch = false) => {
  const url = new URL(typeof request === "string" ? request : request.url);
  if (ignoreSearch) url.search = "";
  return url.href;
};
const fetchAsset = async (request) => {
  if (offline) throw new Error("Offline");
  const url = key(request);
  assert.ok(url.startsWith(base), `Asset escapes project path: ${url}`);
  const relative = new URL(url).pathname.slice(new URL(base).pathname.length) || "index.html";
  return new Response(await readFile(resolve(root, relative)), { status: 200 });
};
const cache = {
  addAll: async (urls) => { for (const url of urls) cacheData.set(key(url), await fetchAsset(url)); },
  match: async (request, options) => cacheData.get(key(request, options?.ignoreSearch))?.clone(),
  put: async (request, response) => cacheData.set(key(request), response.clone())
};
const caches = {
  open: async () => cache,
  keys: async () => ["unrelated-project-cache", "octane-iq-old"],
  delete: async (name) => { assert.notEqual(name, "unrelated-project-cache"); return true; },
  match: cache.match
};
const context = vm.createContext({
  URL, Response, Set, caches, fetch: fetchAsset,
  self: { location: { href: `${base}sw.js`, origin: new URL(base).origin }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener: (type, handler) => { handlers[type] = handler; } }
});
vm.runInContext(await readFile(resolve(root, "sw.js"), "utf8"), context);
let install;
handlers.install({ waitUntil: (promise) => { install = promise; } });
await install;
const cars = JSON.parse(await readFile(resolve(root, "data/cars.json"), "utf8"));
for (const car of cars) {
  let pending;
  handlers.fetch({ request: { url: new URL(car.image, base).href, method: "GET", mode: "cors" }, respondWith: (promise) => { pending = promise; } });
  await pending;
  assert.ok(cacheData.has(new URL(car.image, base).href), `Viewed photo not cached: ${car.id}`);
}
offline = true;
for (const path of ["index.html", "spotter.html", "spotter.js", "data/cars.json", ...cars.map((car) => car.image)]) {
  let pending;
  handlers.fetch({ request: { url: new URL(path, base).href, method: "GET", mode: path.endsWith("html") ? "navigate" : "cors" }, respondWith: (promise) => { pending = promise; } });
  const response = await pending;
  assert.equal(response.status, 200, `Offline asset failed: ${path}`);
  assert.ok((await response.arrayBuffer()).byteLength > 0, `Empty offline asset: ${path}`);
}
let intercepted = false;
handlers.fetch({ request: { url: "https://johncomputers.github.io/another-project/photo.jpg", method: "GET" }, respondWith: () => { intercepted = true; } });
assert.equal(intercepted, false, "Service worker must not intercept another project");
console.log(`Verified project-scoped offline installation and retrieval, including all ${cars.length} car photos.`);
