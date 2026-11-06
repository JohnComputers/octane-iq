import { readFile, stat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import jpeg from "jpeg-js";

const root = resolve(import.meta.dirname, "../dist");
const cars = JSON.parse(await readFile(resolve(root, "data/cars.json"), "utf8"));
assert.ok(cars.length >= 60, "Expected the expanded library of at least sixty photographed cars");
assert.equal(new Set(cars.map((car) => car.id)).size, cars.length, "Car ids must be unique");
assert.ok(cars.filter((car) => car.supercar === true).length >= 20, "Supercardle needs a substantial dedicated pool");
assert.ok(cars.filter((car) => car.region === "europe").length >= 30, "Eurocardle needs a substantial dedicated pool");
const imagePaths = new Set();
for (const car of cars) {
  for (const field of ["id", "make", "model", "displayName", "alt", "imageCredit", "license", "licenseUrl", "sourceUrl"]) assert.ok(typeof car[field] === "string" && car[field].trim(), `${car.id}: missing ${field}`);
  assert.ok(Number.isInteger(car.year) && car.year >= 1886 && car.year <= new Date().getUTCFullYear() + 1, `${car.id}: a documented model year is required for year guesses`);
  assert.ok(["europe", "japan", "usa", "other"].includes(car.region), `${car.id}: missing photo-pool region`);
  assert.equal(typeof car.supercar, "boolean", `${car.id}: missing Supercardle eligibility`);
  assert.equal(car.clueSteps.length, 5, `${car.id}: expected five progressive clues`);
  assert.ok(car.acceptedNames.length >= 2, `${car.id}: aliases missing`);
  assert.ok(car.image.startsWith("assets/cars/") && !car.image.includes(".."), `${car.id}: image must be bundled locally`);
  for (const link of [car.sourceUrl, car.licenseUrl]) assert.equal(new URL(link).protocol, "https:");
  const file = resolve(root, car.image);
  const bytes = await readFile(file);
  const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 128 });
  assert.ok(decoded.width >= 900 && decoded.height >= 500, `${car.id}: image too small`);
  assert.ok(decoded.data.some((byte) => byte !== 0), `${car.id}: image has no visible pixels`);
  assert.ok((await stat(file)).size < 1_000_000, `${car.id}: image needs compression`);
  imagePaths.add(car.image);
}

for (const name of ["index.html", "spotter.html", "cardle.html", "credits.html", "connections.html", "autoask.html", "account.html", "app.js", "spotter.js", "cardle.js", "credits.js", "connections.js", "autoask.js", "account.js"]) {
  const text = await readFile(resolve(root, name), "utf8");
  assert.ok(!/(?:src|href)=["']\/(?!\/)/.test(text), `${name}: origin-root URL will break project hosting`);
  for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const link = match[1];
    if (!link || link.startsWith("#") || /^[a-z]+:/i.test(link)) continue;
    const url = new URL(link, "https://johncomputers.github.io/octane-iq/" + name);
    assert.ok(url.pathname.startsWith("/octane-iq/"), `${name}: URL escaped project path`);
    const path = decodeURIComponent(url.pathname.slice("/octane-iq/".length)) || "index.html";
    assert.ok((await stat(resolve(root, path))).isFile(), `${name}: missing linked file ${link}`);
  }
}
const allImages = await readdir(resolve(root, "assets/cars"));
for (const name of allImages) assert.ok(imagePaths.has(`assets/cars/${name}`), `Uncredited image: ${name}`);
console.log(`Decoded all ${cars.length} JPEGs at full resolution; verified dimensions, file size, attribution, and project-relative links.`);
