import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const [spotterHtml, spotterSource, creditsHtml, creditsSource, cars] = await Promise.all([
  readFile(resolve(dist, "spotter.html"), "utf8"),
  readFile(resolve(dist, "spotter.js"), "utf8"),
  readFile(resolve(dist, "credits.html"), "utf8"),
  readFile(resolve(dist, "credits.js"), "utf8"),
  readFile(resolve(dist, "data/cars.json"), "utf8").then(JSON.parse)
]);

class MemoryStorage {
  constructor(seed = new Map()) { this.values = seed; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

function pageDocument(html, url) {
  const escaped = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const { window, document } = parseHTML(html.replace("<head>", `<head><base href="${escaped}" />`));
  assert.equal(document.baseURI, url);
  window.HTMLElement.prototype.focus ||= function focus() {};
  return { window, document };
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
  }
}

async function loadScriptPage({ html, source, url, storage, fetchImpl }) {
  const { window, document } = pageDocument(html, url);
  const location = new URL(url);
  location.reload = () => {};
  const navigator = { clipboard: { writeText: async () => {} } };
  const sandbox = {
    window,
    document,
    location,
    navigator,
    localStorage: storage,
    fetch: fetchImpl,
    URL,
    Date,
    Math,
    JSON,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
    ,requestAnimationFrame: (callback) => callback()
  };
  sandbox.globalThis = sandbox;
  vm.runInContext(source, vm.createContext(sandbox), { filename: new URL(url).pathname.split("/").at(-1).replace(".html", ".js") });
  await settle();
  return { window, document, location };
}

const carsFetch = async (input) => {
  assert.equal(new URL(input).pathname, "/octane-iq/data/cars.json");
  return { ok: true, json: async () => structuredClone(cars) };
};

async function loadSpotter(storage = new MemoryStorage()) {
  const page = await loadScriptPage({
    html: spotterHtml,
    source: spotterSource,
    url: "https://example.github.io/octane-iq/spotter.html",
    storage,
    fetchImpl: carsFetch
  });
  const photo = page.document.querySelector("#car-photo");
  assert.equal(typeof photo.onload, "function", "Spotter should attach a photo load handler");
  photo.onload();
  return { ...page, storage };
}

function submitGuess(page, value) {
  page.document.querySelector("#car-guess").value = value;
  page.document.querySelector("#guess-form").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
}

function activeCar(page) {
  const source = new URL(page.document.querySelector("#car-photo").src).pathname;
  const match = cars.find((item) => new URL(item.image, page.document.baseURI).pathname === source);
  assert.ok(match, `No metadata matched ${source}`);
  return match;
}

// Every bundled photo and every license record must be present before DOM behavior is tested.
for (const car of cars) {
  const bytes = await readFile(resolve(dist, car.image));
  assert.ok(bytes.length > 10_000, `${car.id} photo is unexpectedly small`);
  assert.equal(bytes[0], 0xff, `${car.id} is not a JPEG`);
  assert.equal(bytes[1], 0xd8, `${car.id} is not a JPEG`);
  assert.match(car.sourceUrl, /^https:\/\//);
  assert.match(car.licenseUrl, /^https:\/\//);
  assert.ok(car.imageCredit && car.license && car.alt);
}

// A failed image leaves attempts untouched; retry changes the URL and can recover.
const retryPage = await loadSpotter();
const retryPhoto = retryPage.document.querySelector("#car-photo");
retryPhoto.onerror();
assert.equal(retryPage.document.querySelectorAll("#guess-history li").length, 0);
assert.equal(retryPage.document.querySelector("#photo-error").hidden, false);
assert.equal(retryPage.document.querySelector("#submit-guess").disabled, true);
retryPage.document.querySelector("#retry-photo").click();
assert.match(retryPhoto.src, /[?&]retry=\d+/);
retryPhoto.onload();
assert.equal(retryPage.document.querySelector("#photo-error").hidden, true);
assert.equal(retryPage.document.querySelector("#submit-guess").disabled, false);

// Five skips consume exactly five attempts and reveal the full licensed photo.
const skipPage = await loadSpotter();
for (let index = 0; index < 5; index += 1) skipPage.document.querySelector("#skip-reveal").click();
assert.equal(skipPage.document.querySelectorAll("#guess-history li").length, 5);
assert.equal(skipPage.document.querySelector("#spotter-result").hidden, false);
assert.equal(skipPage.document.querySelector("#guess-form").hidden, true);
assert.equal(skipPage.document.querySelector("#car-photo").style.transform, "scale(1)");
assert.equal(skipPage.document.querySelector("#reveal-badge").textContent, activeCar(skipPage).yearLabel || "Full photo");

// An accepted alias wins, persists the Daily, and restores on a fresh page load.
const sharedStorage = new MemoryStorage();
const aliasPage = await loadSpotter(sharedStorage);
const dailyCar = activeCar(aliasPage);
const alias = dailyCar.acceptedNames?.[0] || `${dailyCar.make} ${dailyCar.model}`;
submitGuess(aliasPage, alias);
assert.match(aliasPage.document.querySelector("#spotter-message").textContent, /^Correct\./);
assert.equal(aliasPage.document.querySelector("#spotter-answer").textContent, dailyCar.displayName);
const saved = JSON.parse(sharedStorage.getItem("octane-iq:spotter:v1"));
const savedDaily = Object.values(saved.daily)[0];
assert.equal(savedDaily.carId, dailyCar.id);
assert.equal(savedDaily.done, true);
assert.equal(savedDaily.won, true);

const restoredPage = await loadSpotter(sharedStorage);
assert.equal(restoredPage.document.querySelector("#spotter-result").hidden, false);
assert.equal(restoredPage.document.querySelector("#spotter-answer").textContent, dailyCar.displayName);
assert.equal(restoredPage.document.querySelectorAll("#guess-history li").length, 1);

// Practice is unlimited, does not alter the saved Daily, and rotates away from the last car.
const dailySnapshot = sharedStorage.getItem("octane-iq:spotter:v1");
restoredPage.document.querySelector("#practice-spotter").click();
restoredPage.document.querySelector("#car-photo").onload();
assert.equal(restoredPage.document.querySelector("#practice-spotter").getAttribute("aria-pressed"), "true");
assert.equal(restoredPage.document.querySelector("#spotter-date").textContent, "Unlimited practice");
const firstPracticeCar = activeCar(restoredPage);
submitGuess(restoredPage, firstPracticeCar.acceptedNames?.[0] || `${firstPracticeCar.make} ${firstPracticeCar.model}`);
assert.equal(restoredPage.document.querySelector("#spotter-answer").textContent, firstPracticeCar.displayName);
assert.equal(sharedStorage.getItem("octane-iq:spotter:v1"), dailySnapshot);
restoredPage.document.querySelector("#next-car").click();
restoredPage.document.querySelector("#car-photo").onload();
assert.notEqual(activeCar(restoredPage).id, firstPracticeCar.id);

// Credits must render one complete licensed card per car and resolve every project-subpath image.
const creditsPage = await loadScriptPage({
  html: creditsHtml,
  source: creditsSource,
  url: "https://example.github.io/octane-iq/credits.html",
  storage: new MemoryStorage(),
  fetchImpl: carsFetch
});
const cards = [...creditsPage.document.querySelectorAll("#credits-grid .credit-card")];
assert.equal(cards.length, cars.length);
cards.forEach((card, index) => {
  assert.equal(card.querySelector("h2").textContent, cars[index].displayName);
  assert.equal(new URL(card.querySelector("img").src).pathname, `/octane-iq/${cars[index].image}`);
  const links = [...card.querySelectorAll("a")];
  // LinkeDOM's anchor.href getter double-encodes an already escaped percent sign
  // (for example, %26 becomes %2526); the stored href attribute matches browsers.
  assert.equal(links[0].getAttribute("href"), cars[index].sourceUrl);
  assert.equal(links[1].getAttribute("href"), cars[index].licenseUrl);
});

console.log(`Spotter DOM smoke passed: ${cars.length} photos, retry safety, five-skip reveal, alias win, Daily restore, Practice rotation, and ${cards.length} credit cards.`);
