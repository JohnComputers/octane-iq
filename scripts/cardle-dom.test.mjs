import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const root = resolve(import.meta.dirname, "../dist");
const [html, source, cars, catalogue, dailyAssignments] = await Promise.all([
  readFile(resolve(root, "cardle.html"), "utf8"), readFile(resolve(root, "cardle.js"), "utf8"),
  readFile(resolve(root, "data/cars.json"), "utf8").then(JSON.parse), readFile(resolve(root, "data/vehicle-catalog.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "data/daily-cars.json"), "utf8").then(JSON.parse)
]);
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
async function load(variant = "cardle", { memory = new Map(), collection = cars, assignments = dailyAssignments } = {}) {
  const href = `https://johncomputers.github.io/octane-iq/cardle.html?game=${variant}`;
  const { window, document } = parseHTML(html.replace("<head>", `<head><base href="${href}" />`));
  const frames = [];
  const storage = { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const sandbox = { document, window, URL, URLSearchParams, Date, Math, console, localStorage: storage, location: new URL(href), navigator: {}, requestAnimationFrame: (callback) => frames.push(callback), fetch: async (url) => ({ ok: true, json: async () => structuredClone(String(url).includes("vehicle-catalog") ? catalogue : String(url).includes("daily-cars") ? assignments : collection) }) };
  vm.runInNewContext(source, sandbox);
  await settle();
  const $ = (selector) => document.querySelector(selector);
  const photo = $("#cardle-photo");
  assert.equal(photo.style.visibility, "hidden", "A new photo must be hidden until its crop is ready");
  assert.equal(photo.style.transition, "none", "Initial crop must never animate from the full photo");
  const attempts = document.querySelectorAll("#cardle-rows tr").length;
  const expectedScale = $("#cardle-result").hidden ? [3.2, 2.6, 2, 1.5, 1][Math.min(attempts, 4)] : 1;
  assert.equal(photo.style.transform, `scale(${expectedScale})`);
  assert.equal(typeof photo.onload, "function", `${variant} did not select a photo`);
  photo.onload();
  assert.equal(photo.style.visibility, "hidden", "Load event must not show an uncropped frame");
  while (frames.length) frames.shift()();
  assert.equal(photo.style.visibility, "visible");
  const target = collection.find((car) => new URL(car.image, href).href === photo.src);
  assert.ok(target, "Selected photo must map to a known car");
  return { $, window, target, memory, photo, document };
}
function enter(page, make, model, year) {
  page.$("#guess-make").value = make;
  page.$("#guess-make").dispatchEvent(new page.window.Event("input"));
  page.$("#guess-model").value = model;
  page.$("#guess-year").value = String(year);
  page.$("#cardle-form").dispatchEvent(new page.window.Event("submit", { cancelable: true, bubbles: true }));
}
const europe = ["Germany", "United Kingdom", "Italy", "France", "Sweden", "Spain", "Czech Republic"];
const poolFor = (variant, collection = cars) => collection.filter((car) => (Number.isInteger(car.year) || /^\d{4}$/.test(car.yearLabel)) && (variant === "supercardle" ? car.supercar === true : variant === "eurocardle" ? car.region === "europe" || europe.includes(car.country) : true));
const today = new Date().toISOString().slice(0, 10);
for (const variant of ["cardle", "supercardle", "eurocardle"]) {
  const memory = new Map();
  const page = await load(variant, { memory });
  if (variant === "supercardle") assert.equal(page.target.supercar, true);
  if (variant === "eurocardle") assert.equal(page.target.region, "europe");
  const assigned = poolFor(variant).find((car) => car.id === dailyAssignments[today]?.[variant]);
  if (assigned) assert.equal(page.target.id, assigned.id, `${variant} should honor the published Daily assignment`);
  assert.equal(page.photo.alt, "Cropped detail of the mystery car", "Pre-solve alt text must not reveal identifying clues");
  if (variant === "cardle") {
    const makes = [...page.document.querySelectorAll("#make-list option")].map((option) => option.value);
    for (const alias of ["VW", "Chevy", "Mercedes"]) assert.ok(makes.includes(alias), `${alias} should be a searchable make alias`);
    page.$("#guess-make").value = "VW";
    page.$("#guess-make").dispatchEvent(new page.window.Event("input"));
    const vwModels = [...page.document.querySelectorAll("#model-list option")].map((option) => option.value);
    assert.ok(vwModels.includes("Golf"));
    assert.ok(!vwModels.includes("VW Golf"), "The make prefix should be stripped from model aliases");
    page.$("#guess-make").value = "Chevy";
    page.$("#guess-make").dispatchEvent(new page.window.Event("input"));
    const chevyModels = [...page.document.querySelectorAll("#model-list option")].map((option) => option.value);
    assert.ok(chevyModels.includes("Bel Air"));
    assert.ok(!chevyModels.includes("Chevy Bel Air"), "Chevy should be treated as a make, not part of the model");
  }
  const year = page.target.year || Number(page.target.yearLabel);
  const model = page.target.familyModel || page.target.model;
  enter(page, page.target.make, model, year + 3);
  assert.equal(page.document.querySelectorAll("#cardle-rows .hit").length, 2, "Make and model should be individually correct");
  assert.match(page.$("#cardle-rows").textContent, /Older/);
  assert.equal(page.$("#cardle-result").hidden, true, "A year three years off must not win");
  assert.ok(memory.has("octane-iq:cardle:v2"));

  const changedAssignments = structuredClone(dailyAssignments);
  changedAssignments[today] ||= {};
  const alternate = poolFor(variant).find((car) => car.id !== page.target.id);
  if (alternate) changedAssignments[today][variant] = alternate.id;
  const restoredAttempt = await load(variant, { memory, collection: [...cars].reverse(), assignments: changedAssignments });
  assert.equal(restoredAttempt.target.id, page.target.id, "A saved Daily must survive pool reordering or a later assignment change");
  assert.equal(restoredAttempt.document.querySelectorAll("#cardle-rows tr").length, 1, "Reload should restore the attempted guess");
  assert.equal(restoredAttempt.$("#cardle-result").hidden, true);

  enter(restoredAttempt, restoredAttempt.target.make, model, year + 2);
  assert.equal(restoredAttempt.$("#cardle-result").hidden, false, "A year within two must win");
  assert.match(restoredAttempt.$("#cardle-outcome").textContent, /All three correct/);
  assert.equal(restoredAttempt.photo.style.transform, "scale(1)");

  const restoredResult = await load(variant, { memory, collection: [...cars].reverse(), assignments: changedAssignments });
  assert.equal(restoredResult.target.id, page.target.id);
  assert.equal(restoredResult.document.querySelectorAll("#cardle-rows tr").length, 2, "Reload should restore the completed result");
  assert.equal(restoredResult.$("#cardle-result").hidden, false, "Reload should restore the result panel");
  assert.equal(restoredResult.photo.style.transform, "scale(1)");
  assert.equal(restoredResult.photo.alt, restoredResult.target.displayName, "Solved photo alt text should identify the car");
  restoredResult.$("#cardle-next").click();
  assert.equal(restoredResult.photo.style.visibility, "hidden", "Next practice photo must not flash its full image");
}
for (const invalidVariant of ["unknown", "toString", "__proto__"]) {
  const fallback = await load(invalidVariant);
  assert.equal(fallback.$("#cardle-title").textContent, "Cardle", "Unknown variant links should fall back to the standard game");
}
const mercedesFixture = { ...cars[0], id: "test-mercedes-alias", make: "Mercedes-Benz", model: "300 SL Gullwing", familyModel: "300 SL", acceptedNames: ["Mercedes Benz 300 SL", "Mercedes-Benz 300 SL", "Mercedes 300 SL"] };
const aliasPage = await load("cardle", { collection: [...cars, mercedesFixture] });
aliasPage.$("#guess-make").value = "Mercedes";
aliasPage.$("#guess-make").dispatchEvent(new aliasPage.window.Event("input"));
const mercedesModels = [...aliasPage.document.querySelectorAll("#model-list option")].map((option) => option.value);
assert.ok(mercedesModels.includes("300 SL"), "Mercedes punctuation variants should resolve to the same make and clean model name");
assert.ok(!mercedesModels.includes("Benz 300 SL"), "A space-for-hyphen make alias must be stripped in full");
console.log("Cardle DOM checks passed: pinned variants, make aliases, neutral mystery alt, ±2-year feedback, real Daily reload/restore, and no full-photo flash.");
