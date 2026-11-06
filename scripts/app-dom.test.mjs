import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";

const dist = resolve(import.meta.dirname, "../dist");
const html = await readFile(resolve(dist, "index.html"), "utf8");
const app = await readFile(resolve(dist, "app.js"), "utf8");
const questions = JSON.parse(await readFile(resolve(dist, "data/questions.json"), "utf8"));
const byId = new Map(questions.map((question) => [question.id, question]));
const base = "https://johncomputers.github.io/octane-iq/";

const delay = (milliseconds = 0) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
async function waitFor(predicate, label, timeout = 1500) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await delay(5);
  }
}

function memoryStorage(seed = new Map()) {
  return {
    getItem: (key) => seed.has(key) ? seed.get(key) : null,
    setItem: (key, value) => seed.set(key, String(value)),
    removeItem: (key) => seed.delete(key),
    clear: () => seed.clear(),
    key: (index) => [...seed.keys()][index] ?? null,
    get length() { return seed.size; },
    seed
  };
}

async function createApp({ failQuestions = false } = {}) {
  const { window, document } = parseHTML(html);
  const storage = memoryStorage();
  const controls = { failQuestions };
  const shared = [];
  const copied = [];
  const registrations = [];
  const downloads = [];
  let currentUrl = new URL(`${base}#home`);
  const entries = [currentUrl.href];
  let entryIndex = 0;
  const location = {
    get href() { return currentUrl.href; },
    set href(value) { currentUrl = new URL(value, currentUrl); },
    get hash() { return currentUrl.hash; },
    set hash(value) { currentUrl.hash = value; },
    get origin() { return currentUrl.origin; },
    get protocol() { return currentUrl.protocol; },
    get pathname() { return currentUrl.pathname; },
    reload() {}
  };
  const setUrl = (value) => { currentUrl = new URL(value, currentUrl); };
  const history = {
    pushState(_state, _title, value) {
      setUrl(value);
      entries.splice(entryIndex + 1, Infinity, currentUrl.href);
      entryIndex = entries.length - 1;
    },
    replaceState(_state, _title, value) {
      setUrl(value);
      entries[entryIndex] = currentUrl.href;
    },
    back() {
      if (!entryIndex) return;
      entryIndex -= 1;
      currentUrl = new URL(entries[entryIndex]);
      queueMicrotask(() => window.dispatchEvent(new window.Event("hashchange")));
    }
  };
  const navigator = {
    share: async (payload) => { shared.push(payload); },
    clipboard: { writeText: async (text) => { copied.push(text); } },
    serviceWorker: { register: async (...args) => { registrations.push(args); } }
  };
  const fetch = async (input) => {
    const url = new URL(String(input), base);
    if (url.pathname.endsWith("/data/questions.json")) {
      if (controls.failQuestions) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => structuredClone(questions) };
    }
    throw new Error(`Unexpected fetch in app smoke test: ${url.href}`);
  };
  class TestURL extends URL {}
  TestURL.createObjectURL = (blob) => {
    downloads.push(blob);
    return `blob:octane-iq-test-${downloads.length}`;
  };
  TestURL.revokeObjectURL = () => {};

  Object.defineProperty(document, "baseURI", { configurable: true, value: base });
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.setInterval = setInterval;
  window.clearInterval = clearInterval;
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.Element.prototype.scrollIntoView = () => {};
  window.Element.prototype.focus = function focus() { document.__focused = this; };

  const context = vm.createContext({
    window, document, navigator, location, history, localStorage: storage,
    fetch, crypto: webcrypto, console, URL: TestURL, Blob, Date, Math, JSON, Map, Set,
    Element: window.Element, Event: window.Event,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: window.requestAnimationFrame,
    structuredClone
  });
  vm.runInContext(app, context, { filename: "dist/app.js" });
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await waitFor(() => document.querySelector("#year").textContent.length === 4, "app initialization");
  await delay(0);

  return { window, document, storage, controls, shared, copied, registrations, downloads, location, history };
}

function click(document, selector) {
  const element = document.querySelector(selector);
  assert.ok(element, `Missing control: ${selector}`);
  element.click();
  return element;
}

function answerCurrent(document, correct) {
  const id = document.querySelector("#question-id").textContent.replace(/^Question\s+/, "");
  const question = byId.get(id);
  assert.ok(question, `Unknown rendered question ${id}`);
  const answers = [...document.querySelectorAll(".answer-button")];
  const choice = answers.find((button) => (button.querySelector(".answer-text").textContent === question.answer) === correct);
  assert.ok(choice, `Could not find ${correct ? "correct" : "incorrect"} answer for ${id}`);
  choice.click();
  return { id, question, choice };
}

async function finishQuick(appState) {
  const { document } = appState;
  click(document, 'button[data-mode="quick"]');
  for (let index = 0; index < 5; index += 1) {
    answerCurrent(document, true);
    assert.equal(document.querySelector("#feedback-panel").hidden, false);
    click(document, "#next-question");
  }
  await waitFor(() => !document.querySelector("#results-view").hidden, "quick-lap results");
}

test("load failure is visible, disables play, and retry recovers", async () => {
  const appState = await createApp({ failQuestions: true });
  const { document, controls } = appState;
  assert.equal(document.querySelector("#load-error").hidden, false);
  assert.ok([...document.querySelectorAll("[data-mode]")].every((button) => button.disabled));
  controls.failQuestions = false;
  click(document, "#retry-questions");
  await waitFor(() => document.querySelector("#load-error").hidden, "question-bank retry");
  assert.ok([...document.querySelectorAll("[data-mode]")].every((button) => !button.disabled));
});

test("history navigation and a Daily Drive resume preserve answered state", async () => {
  const appState = await createApp();
  const { document, history, location, storage } = appState;
  click(document, 'button[data-nav="stats"]');
  assert.equal(location.hash, "#stats");
  assert.equal(document.querySelector("#stats-view").hidden, false);
  history.back();
  await waitFor(() => location.hash === "#home" && !document.querySelector("#home-view").hidden, "history back to home");

  click(document, 'button[data-mode="daily"]');
  const answered = answerCurrent(document, true);
  click(document, "#quit-game");
  assert.ok(JSON.parse(storage.getItem("octane-iq:v1")).current, "Daily run was not persisted");
  assert.equal(document.querySelector("#resume-banner").hidden, false);
  click(document, "#resume-run");
  assert.match(document.querySelector("#question-id").textContent, new RegExp(answered.id));
  assert.equal(document.querySelector("#feedback-panel").hidden, false);
  assert.ok([...document.querySelectorAll(".answer-button")].every((button) => button.disabled));
  click(document, "#quit-game");
  click(document, "#discard-run");
});

test("Time Attack auto-advances and Endurance ends after three misses", async () => {
  const timed = await createApp();
  click(timed.document, 'button[data-mode="time"]');
  const firstId = answerCurrent(timed.document, true).id;
  assert.equal(timed.document.querySelector("#next-question").hidden, true);
  assert.notEqual(timed.document.querySelector("#score-value").textContent, "0");
  await waitFor(() => !timed.document.querySelector("#question-id").textContent.includes(firstId), "Time Attack auto-advance");
  click(timed.document, "#quit-game");

  const endurance = await createApp();
  click(endurance.document, 'button[data-mode="endurance"]');
  for (let lives = 2; lives >= 0; lives -= 1) {
    answerCurrent(endurance.document, false);
    assert.match(endurance.document.querySelector("#lives-display").getAttribute("aria-label"), new RegExp(`^${lives} `));
    click(endurance.document, "#next-question");
  }
  await waitFor(() => !endurance.document.querySelector("#results-view").hidden, "Endurance results");
  assert.match(endurance.document.querySelector("#result-score-label").textContent, /Endurance/);
});

test("result review and native sharing are complete and GitHub Pages-safe", async () => {
  const appState = await createApp();
  await finishQuick(appState);
  const { document, shared } = appState;
  click(document, "#review-misses");
  assert.equal(document.querySelector("#review-misses").getAttribute("aria-expanded"), "true");
  assert.equal(document.querySelectorAll("#review-list .review-item").length, 5);
  click(document, "#share-result");
  await waitFor(() => shared.length === 1, "native share payload");
  assert.match(shared[0].text, /🟩🟩🟩🟩🟩/);
  assert.match(shared[0].text, /https:\/\/johncomputers\.github\.io\/octane-iq\//);
});

test("progress export is game-only and reset preserves auth and unrelated storage", async () => {
  const appState = await createApp();
  const { document, storage, downloads } = appState;
  const gameProgress = {
    "octane-iq:spotter:v1": { daily: { "2026-11-06": { done: true } } },
    "octane-iq:cardle:v2": { streak: 4 },
    "octane-iq:connections:v1": { solved: ["engine"] },
    "octane-iq:autoask:v1": { wins: 2 }
  };
  Object.entries(gameProgress).forEach(([key, value]) => storage.setItem(key, JSON.stringify(value)));
  storage.setItem("octane-iq:supabase-session:v1", JSON.stringify({ access_token: "never-export-this-token" }));
  storage.setItem("unrelated-app:preferences", JSON.stringify({ private: true }));

  click(document, "#export-data");
  await waitFor(() => downloads.length === 1, "progress backup download");
  const backupText = await downloads[0].text();
  const backup = JSON.parse(backupText);
  assert.equal(backup.schema, "octane-iq/game-progress");
  assert.equal(backup.version, 1);
  assert.match(backup.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(backup.games), ["trivia", "spotter", "cardle", "connections", "autoask"]);
  assert.equal(backup.games.trivia.storageKey, "octane-iq:v1");
  assert.deepEqual(backup.games.spotter.data, gameProgress["octane-iq:spotter:v1"]);
  assert.deepEqual(backup.games.cardle.data, gameProgress["octane-iq:cardle:v2"]);
  assert.deepEqual(backup.games.connections.data, gameProgress["octane-iq:connections:v1"]);
  assert.deepEqual(backup.games.autoask.data, gameProgress["octane-iq:autoask:v1"]);
  assert.doesNotMatch(backupText, /supabase-session|never-export-this-token|unrelated-app/);

  click(document, "#reset-data");
  const resetTrivia = JSON.parse(storage.getItem("octane-iq:v1"));
  assert.deepEqual(resetTrivia.daily, {});
  assert.equal(resetTrivia.stats.answered, 0);
  assert.equal(resetTrivia.stats.runs, 0);
  assert.equal(storage.getItem("octane-iq:spotter:v1"), null);
  assert.equal(storage.getItem("octane-iq:cardle:v2"), null);
  assert.equal(storage.getItem("octane-iq:connections:v1"), null);
  assert.equal(storage.getItem("octane-iq:autoask:v1"), null);
  assert.equal(JSON.parse(storage.getItem("octane-iq:v1")).stats.answered, 0);
  assert.equal(JSON.parse(storage.getItem("octane-iq:supabase-session:v1")).access_token, "never-export-this-token");
  assert.deepEqual(JSON.parse(storage.getItem("unrelated-app:preferences")), { private: true });
});
