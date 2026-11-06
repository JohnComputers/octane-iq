import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const dist = new URL("../dist/", import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), "utf8");
const datasets = {
  "connections.json": JSON.parse(read("data/connections.json")),
  "autoask.json": JSON.parse(read("data/autoask.json")),
  "cars.json": JSON.parse(read("data/cars.json"))
};

class MemoryStorage {
  constructor(values = new Map()) { this.values = values; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
  }
}

async function loadPage(name, storage = new MemoryStorage()) {
  const url = `https://example.github.io/octane-iq/${name}.html`;
  const html = read(`${name}.html`).replace("<head>", `<head><base href="${url}" />`);
  const { window, document } = parseHTML(html);
  window.HTMLElement.prototype.focus ||= function focus() {};
  const controlledMath = Object.create(Math);
  controlledMath.random = () => 0;
  const fetch = async (input) => {
    const filename = new URL(input).pathname.split("/").at(-1);
    const value = datasets[filename];
    return value ? { ok: true, json: async () => structuredClone(value) } : { ok: false, status: 404 };
  };
  const sandbox = {
    window,
    document,
    location: new URL(url),
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: storage,
    fetch,
    URL,
    Date,
    Math: controlledMath,
    JSON,
    Promise,
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  sandbox.globalThis = sandbox;
  vm.runInContext(read(`${name}.js`), vm.createContext(sandbox), { filename: `${name}.js` });
  await settle();
  return { window, document, storage };
}

const hash = (value) => [...value].reduce((result, char) => (Math.imul(result, 31) + char.charCodeAt(0)) >>> 0, 0);
const today = new Date().toISOString().slice(0, 10);
const clickTerm = (page, term) => {
  const button = [...page.document.querySelectorAll(".term-button")].find((item) => item.textContent === term);
  assert.ok(button, `Expected term button ${term}`);
  button.click();
};
const submitGuess = (page, value) => {
  page.document.querySelector("#autoask-guess").value = value;
  page.document.querySelector("#car-guess-form").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
};

// Connections: deterministic Daily, selection tools, correct grouping, four-miss reveal, persistence, and Practice.
const firstDaily = await loadPage("connections");
const secondDaily = await loadPage("connections");
const firstOrder = [...firstDaily.document.querySelectorAll(".term-button")].map((item) => item.textContent);
const secondOrder = [...secondDaily.document.querySelectorAll(".term-button")].map((item) => item.textContent);
assert.deepEqual(firstOrder, secondOrder);
assert.equal(firstOrder.length, 16);

clickTerm(firstDaily, firstOrder[0]);
assert.equal(firstDaily.document.querySelector("#deselect-terms").disabled, false);
firstDaily.document.querySelector("#deselect-terms").click();
assert.equal(firstDaily.document.querySelectorAll(".term-button.is-selected").length, 0);
const beforeShuffle = new Set(firstOrder);
firstDaily.document.querySelector("#shuffle-terms").click();
assert.deepEqual(new Set([...firstDaily.document.querySelectorAll(".term-button")].map((item) => item.textContent)), beforeShuffle);

const puzzle = datasets["connections.json"][hash(today) % datasets["connections.json"].length];
for (const term of puzzle.groups[0].terms) clickTerm(firstDaily, term);
firstDaily.document.querySelector("#submit-group").click();
assert.equal(firstDaily.document.querySelectorAll(".solved-group").length, 1);

const wrongTerms = [...puzzle.groups.slice(1).map((group) => group.terms[0]), puzzle.groups[1].terms[1]];
for (let miss = 0; miss < 4; miss += 1) {
  for (const term of wrongTerms) clickTerm(firstDaily, term);
  firstDaily.document.querySelector("#submit-group").click();
}
assert.equal(firstDaily.document.querySelector("#connections-result").hidden, false);
assert.equal(firstDaily.document.querySelectorAll(".solved-group").length, 4);
const restoredConnections = await loadPage("connections", firstDaily.storage);
assert.equal(restoredConnections.document.querySelector("#connections-result").hidden, false);
restoredConnections.document.querySelector("#practice-connections").click();
assert.equal(restoredConnections.document.querySelector("#practice-connections").getAttribute("aria-pressed"), "true");
assert.equal(restoredConnections.document.querySelectorAll(".term-button").length, 16);

// AutoAsk: derived country/year/make questions, turns, alias solve, Daily restore, Practice, and 20-turn loss.
const autoStorage = new MemoryStorage();
const autoAsk = await loadPage("autoask", autoStorage);
const questionText = [...autoAsk.document.querySelectorAll(".fact-question")].map((item) => item.textContent);
assert.ok(questionText.length > datasets["autoask.json"].questions.length, "Expected metadata-derived make and decade questions");
assert.ok(questionText.some((text) => text.includes("made by Ford")));
assert.ok(questionText.some((text) => /introduced in the \d{4}s/.test(text)));

autoAsk.document.querySelector("#question-search").value = "headlights";
autoAsk.document.querySelector("#question-search").dispatchEvent(new autoAsk.window.Event("input", { bubbles: true }));
assert.ok([...autoAsk.document.querySelectorAll(".fact-question")].some((item) => item.textContent.includes("headlights")));
autoAsk.document.querySelector(".fact-question").click();
assert.equal(autoAsk.document.querySelector("#turn-track").getAttribute("aria-valuenow"), "1");

submitGuess(autoAsk, "");
assert.equal(autoAsk.document.querySelector("#turn-track").getAttribute("aria-valuenow"), "1");
const targetEntry = datasets["autoask.json"].cars[hash(today) % datasets["autoask.json"].cars.length];
const targetCar = datasets["cars.json"].find((item) => item.id === targetEntry.carId);
const wrongCar = datasets["cars.json"].find((item) => item.id !== targetCar.id);
submitGuess(autoAsk, wrongCar.acceptedNames[0]);
assert.equal(autoAsk.document.querySelector("#turn-track").getAttribute("aria-valuenow"), "2");
submitGuess(autoAsk, targetCar.acceptedNames[0]);
assert.equal(autoAsk.document.querySelector("#autoask-result").hidden, false);
assert.equal(autoAsk.document.querySelector("#autoask-answer").textContent, targetCar.displayName);

const restoredAutoAsk = await loadPage("autoask", autoStorage);
assert.equal(restoredAutoAsk.document.querySelector("#autoask-result").hidden, false);
restoredAutoAsk.document.querySelector("#practice-autoask").click();
assert.equal(restoredAutoAsk.document.querySelector("#practice-autoask").getAttribute("aria-pressed"), "true");
submitGuess(restoredAutoAsk, datasets["cars.json"][0].acceptedNames[0]);
assert.equal(restoredAutoAsk.document.querySelector("#autoask-result").hidden, false);

const exhausted = await loadPage("autoask");
for (let turn = 0; turn < 20; turn += 1) exhausted.document.querySelector(".fact-question").click();
assert.equal(exhausted.document.querySelector("#turn-track").getAttribute("aria-valuenow"), "20");
assert.equal(exhausted.document.querySelector("#autoask-result").hidden, false);
assert.equal(exhausted.document.querySelector("#autoask-result-label").textContent, "Twenty turns used");

const productCopy = `${read("autoask.html")}\n${read("autoask.js")}`;
assert.doesNotMatch(productCopy, /pretend ai|generative ai|not guesswork/i);
console.log("Connections + AutoAsk DOM smoke passed: Daily determinism/restore, grouping/four-miss reveal, fact search/turns/aliases, Practice, and 20-turn completion.");
