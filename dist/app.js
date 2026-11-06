"use strict";

const STORAGE_KEY = "octane-iq:v1";
const STORAGE_VERSION = 1;
const PROGRESS_EXPORT_SCHEMA = "octane-iq/game-progress";
const PROGRESS_EXPORT_VERSION = 1;
const GAME_PROGRESS_KEYS = Object.freeze({
  spotter: "octane-iq:spotter:v1",
  cardle: "octane-iq:cardle:v2",
  connections: "octane-iq:connections:v1",
  autoask: "octane-iq:autoask:v1"
});
const BANK_VERSION = "2026-11-05a";
const DAILY_LENGTH = 7;
const CATEGORY_NAMES = {
  history: "History",
  engineering: "Engineering",
  evs: "EVs & hybrids",
  motorsport: "Motorsport",
  design: "Icons & design",
  safety: "Safety",
  culture: "Car culture",
  brands: "Brands"
};
const CATEGORY_ORDER = Object.keys(CATEGORY_NAMES);
const DIFFICULTY_POINTS = { easy: 100, medium: 150, hard: 200 };
const MODE_META = {
  daily: { name: "Daily Drive", subtitle: "Today’s shared challenge", length: DAILY_LENGTH },
  quick: { name: "Quick Lap", subtitle: "Five-question practice", length: 5 },
  time: { name: "Time Attack", subtitle: "Ninety seconds. Full send.", length: Infinity },
  endurance: { name: "Endurance", subtitle: "Three lives. Keep moving.", length: Infinity },
  category: { name: "Category Run", subtitle: "Focused practice", length: 10 }
};
const ACHIEVEMENTS = [
  { id: "first-run", icon: "✓", name: "Ignition", description: "Finish your first run", test: (s) => s.stats.runs >= 1 },
  { id: "perfect-run", icon: "★", name: "Clean Sweep", description: "Score 100% in a 5+ question run", manual: true },
  { id: "streak-3", icon: "↗", name: "Three in a Row", description: "Complete three Daily Drives in a row", test: (s) => getStreak(s).current >= 3 },
  { id: "fifty", icon: "50", name: "Road Tested", description: "Answer 50 questions", test: (s) => s.stats.answered >= 50 },
  { id: "endurance-10", icon: "∞", name: "Long Haul", description: "Answer 10 in one Endurance run", manual: true },
  { id: "category-ace", icon: "◎", name: "Specialist", description: "Reach 80% in a category after 8 answers", test: (s) => Object.values(s.stats.categories).some((c) => c.answered >= 8 && c.correct / c.answered >= 0.8) }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let questions = [];
let questionMap = new Map();
const dailySelectionCache = new Map();
let store = loadStore();
let game = null;
let lastResult = null;
let timerInterval = null;
let autoAdvanceTimeout = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  applyTheme(store.preferences.theme);
  bindEvents();
  $("#year").textContent = new Date().getFullYear();
  updateDailyLabels();

  await loadQuestionBank();

  cleanStaleRun();
  refreshHome();
  renderStats();
  routeFromHash(false);

  window.addEventListener("hashchange", () => routeFromHash(false));
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || game) return;
    store = loadStore();
    refreshHome();
    renderStats();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  }
}

async function loadQuestionBank() {
  const controls = $$('[data-mode], [data-category]');
  try {
    const response = await fetch("./data/questions.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Question bank returned ${response.status}`);
    const loaded = await response.json();
    if (!Array.isArray(loaded) || loaded.length < 20) throw new Error("Question bank is unexpectedly small");
    questions = loaded;
    questionMap = new Map(questions.map((question) => [question.id, question]));
    dailySelectionCache.clear();
    controls.forEach((button) => { button.disabled = false; });
    $("#load-error").hidden = true;
    return true;
  } catch (error) {
    console.error(error);
    controls.forEach((button) => { button.disabled = true; });
    $("#load-error").hidden = false;
    showToast("Couldn’t load the question bank.", 4200);
    return false;
  }
}

function bindEvents() {
  $$('[data-mode]').forEach((button) => {
    button.addEventListener("click", () => startGame(button.dataset.mode));
  });

  $$('[data-category]').forEach((button) => {
    button.addEventListener("click", () => startGame("category", button.dataset.category));
  });

  $$('[data-nav]').forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(button.dataset.nav);
    });
  });

  $$('[data-scroll]').forEach((button) => {
    button.addEventListener("click", () => scrollToSection(button.dataset.scroll));
  });

  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#retry-questions").addEventListener("click", loadQuestionBank);
  $("#quit-game").addEventListener("click", quitGame);
  $("#next-question").addEventListener("click", nextQuestion);
  $("#resume-run").addEventListener("click", resumeRun);
  $("#discard-run").addEventListener("click", discardRun);
  $("#share-result").addEventListener("click", shareResult);
  $("#review-misses").addEventListener("click", toggleReview);
  $("#export-data").addEventListener("click", exportData);
  $("#reset-data").addEventListener("click", resetData);
  $("#report-link").addEventListener("click", copyQuestionReference);

  document.addEventListener("keydown", handleKeyboard);
}

function defaultStore() {
  return {
    version: STORAGE_VERSION,
    preferences: { theme: "light" },
    daily: {},
    stats: {
      answered: 0,
      correct: 0,
      runs: 0,
      bestStreak: 0,
      categories: Object.fromEntries(CATEGORY_ORDER.map((category) => [category, { answered: 0, correct: 0 }])),
      modes: {}
    },
    achievements: [],
    current: null
  };
}

function loadStore() {
  const fallback = defaultStore();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || parsed.version !== STORAGE_VERSION) return fallback;
    return {
      ...fallback,
      ...parsed,
      preferences: { ...fallback.preferences, ...parsed.preferences },
      stats: {
        ...fallback.stats,
        ...parsed.stats,
        categories: Object.fromEntries(CATEGORY_ORDER.map((category) => [
          category,
          { ...fallback.stats.categories[category], ...(parsed.stats?.categories?.[category] || {}) }
        ])),
        modes: { ...fallback.stats.modes, ...(parsed.stats?.modes || {}) }
      },
      daily: parsed.daily || {},
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
      current: parsed.current || null
    };
  } catch {
    return fallback;
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    showToast("Progress could not be saved in this browser.", 3500);
  }
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function getStreak(source = store) {
  const dates = new Set(Object.keys(source.daily).filter((date) => source.daily[date]?.completed));
  let cursor = dates.has(todayUTC()) ? todayUTC() : addDays(todayUTC(), -1);
  let current = 0;
  while (dates.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, best: Math.max(source.stats.bestStreak || 0, current) };
}

function updateDailyLabels() {
  const dayZero = Date.UTC(2026, 0, 1);
  const number = Math.max(1, Math.floor((Date.parse(`${todayUTC()}T00:00:00Z`) - dayZero) / 86400000) + 1);
  $("#daily-number").textContent = `#${String(number).padStart(3, "0")}`;
}

function refreshHome() {
  const streak = getStreak();
  $("#hero-streak").textContent = streak.current;
  const complete = Boolean(store.daily[todayUTC()]?.completed);
  $("#daily-cta span:first-child").textContent = complete ? "Replay today’s drive" : "Start today’s drive";
  $("#daily-card-action").textContent = complete ? "Run it again" : "Ignition on";

  const banner = $("#resume-banner");
  if (store.current) {
    banner.hidden = false;
    const meta = MODE_META[store.current.mode] || MODE_META.quick;
    const total = Number.isFinite(meta.length) ? store.current.questionIds.length : "∞";
    $("#resume-detail").textContent = `${meta.name} • question ${Math.min(store.current.index + 1, store.current.questionIds.length)} of ${total}`;
  } else {
    banner.hidden = true;
  }
}

function cleanStaleRun() {
  if (!store.current) return;
  const invalid = !Array.isArray(store.current.questionIds) || !store.current.questionIds.length;
  const expiredDaily = store.current.mode === "daily" && store.current.date !== todayUTC();
  if (invalid || expiredDaily || store.current.mode === "time") {
    store.current = null;
    saveStore();
  }
}

function applyTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  const toggle = $("#theme-toggle");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(selected === "dark"));
    toggle.setAttribute("aria-label", selected === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = selected === "dark" ? "#111310" : "#f3efe6";
}

function toggleTheme() {
  store.preferences.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(store.preferences.theme);
  saveStore();
}

function navigate(view, updateHash = true) {
  const target = document.querySelector(`[data-view="${view}"]`);
  if (!target) return;
  if (view !== "game" && game) {
    clearGameTimers();
    persistCurrentGame();
    game = null;
  }
  $$(".view").forEach((element) => {
    const active = element === target;
    element.hidden = !active;
    element.classList.toggle("is-active", active);
  });
  $$(".nav-link").forEach((link) => {
    const active = link.dataset.nav === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $(".site-footer").hidden = view === "game";
  window.scrollTo({ top: 0, behavior: "auto" });
  if (updateHash && location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  if (view === "stats") renderStats();
  if (view === "home") refreshHome();
  setTimeout(() => $("#main-content").focus({ preventScroll: true }), 0);
}

function routeFromHash(updateHash = false) {
  const requested = location.hash.replace("#", "");
  if (["games", "modes", "garage", "about"].includes(requested)) {
    navigate("home", false);
    setTimeout(() => document.getElementById(requested)?.scrollIntoView({ behavior: "auto", block: "start" }), 80);
    return;
  }
  if (["home", "stats"].includes(requested)) {
    navigate(requested, updateHash);
    return;
  }
  if (requested === "game" && game) {
    navigate("game", false);
    return;
  }
  if (requested === "results" && lastResult) {
    navigate("results", false);
    return;
  }
  history.replaceState(null, "", "#home");
  navigate("home", false);
}

function scrollToSection(id) {
  const perform = () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if ($("#home-view").hidden) {
    navigate("home");
    setTimeout(perform, 80);
  } else {
    perform();
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const output = [...items];
  const random = mulberry32(typeof seed === "number" ? seed : hashString(String(seed)));
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function randomSeed() {
  if (crypto?.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0];
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function selectBalanced(length, seed, category = null, sourcePool = questions) {
  const pool = category ? sourcePool.filter((question) => question.category === category) : sourcePool;
  const randomized = shuffled(pool, seed);
  if (category) return randomized.slice(0, Math.min(length, randomized.length));

  const categoryCycle = shuffled(CATEGORY_ORDER, `${seed}:categories`);
  const difficultyCycle = shuffled(["easy", "easy", "medium", "medium", "medium", "hard", "hard", "medium"], `${seed}:difficulty`);
  const selected = [];
  for (let index = 0; index < length; index += 1) {
    const desiredCategory = categoryCycle[index % categoryCycle.length];
    const desiredDifficulty = difficultyCycle[index % difficultyCycle.length];
    let choice = randomized.find((question) =>
      !selected.includes(question) && question.category === desiredCategory && question.difficulty === desiredDifficulty
    );
    if (!choice) choice = randomized.find((question) => !selected.includes(question) && question.category === desiredCategory);
    if (!choice) choice = randomized.find((question) => !selected.includes(question));
    if (choice) selected.push(choice);
  }
  return selected;
}

function selectDailyQuestions(date) {
  if (dailySelectionCache.has(date)) return dailySelectionCache.get(date);
  const anchor = "2026-01-01";
  if (date < anchor) return selectBalanced(DAILY_LENGTH, `daily:${date}:${BANK_VERSION}`);

  const recentSets = [];
  let cursor = anchor;
  let selected = [];
  while (cursor <= date) {
    const recentIds = new Set(recentSets.flat());
    let available = questions.filter((question) => !recentIds.has(question.id));
    if (available.length < DAILY_LENGTH) available = questions;
    selected = selectBalanced(DAILY_LENGTH, `daily:${cursor}:${BANK_VERSION}`, null, available);
    dailySelectionCache.set(cursor, selected);
    recentSets.push(selected.map((question) => question.id));
    if (recentSets.length > 7) recentSets.shift();
    cursor = addDays(cursor, 1);
  }
  return selected;
}

function prepareQuestion(question, seed) {
  const choices = shuffled([question.answer, ...question.distractors], `${seed}:${question.id}:choices`);
  return { ...question, choices, correctIndex: choices.indexOf(question.answer) };
}

function prepareQuestionSequence(sequence, seed, priorSequence = []) {
  const occurrences = new Map();
  priorSequence.forEach((question) => occurrences.set(question.id, (occurrences.get(question.id) || 0) + 1));
  return sequence.map((question) => {
    const occurrence = occurrences.get(question.id) || 0;
    occurrences.set(question.id, occurrence + 1);
    return prepareQuestion(question, occurrence === 0 ? seed : `${seed}:repeat:${occurrence}`);
  });
}

function startGame(mode, category = null) {
  if (!questions.length) {
    showToast("The question bank is still loading.");
    return;
  }

  if (store.current) {
    const sameRun = store.current.mode === mode && store.current.category === category && (mode !== "daily" || store.current.date === todayUTC());
    if (sameRun) {
      resumeRun();
      return;
    }
    const replace = window.confirm("Starting a new run will discard your saved run. Continue?");
    if (!replace) return;
  }

  clearGameTimers();
  store.current = null;
  saveStore();
  const meta = MODE_META[mode] || MODE_META.quick;
  const seed = mode === "daily" ? `daily:${todayUTC()}:${BANK_VERSION}` : randomSeed();
  const length = Number.isFinite(meta.length) ? meta.length : questions.length;
  const selected = mode === "daily"
    ? selectDailyQuestions(todayUTC())
    : mode === "endurance"
      ? shuffled(questions.filter((question) => question.difficulty !== "easy"), seed)
      : selectBalanced(length, seed, category);

  game = {
    version: 1,
    bankVersion: BANK_VERSION,
    runId: `${seed}:${Date.now()}`,
    mode,
    category,
    seed,
    date: mode === "daily" ? todayUTC() : null,
    isReplay: mode === "daily" && Boolean(store.daily[todayUTC()]?.completed),
    questions: prepareQuestionSequence(selected, seed),
    index: 0,
    answers: [],
    score: 0,
    lives: mode === "endurance" ? 3 : null,
    remainingMs: mode === "time" ? 90000 : null,
    deadline: mode === "time" ? Date.now() + 90000 : null,
    completed: false
  };

  if (mode !== "time") persistCurrentGame();
  navigate("game");
  setupGameChrome();
  renderQuestion();
  if (mode === "time") startTimer();
}

function setupGameChrome() {
  const meta = MODE_META[game.mode];
  $("#game-mode-kicker").textContent = game.mode === "category" ? CATEGORY_NAMES[game.category] : meta.name;
  $("#game-mode-subtitle").textContent = game.mode === "category" ? "Focused category practice" : meta.subtitle;
  $("#lives-display").hidden = game.mode !== "endurance";
  $("#timer-display").hidden = game.mode !== "time";
  updateGameMetrics();
}

function serializeGame() {
  return {
    version: game.version,
    bankVersion: BANK_VERSION,
    mode: game.mode,
    category: game.category,
    seed: game.seed,
    date: game.date,
    isReplay: game.isReplay,
    questionIds: game.questions.map((question) => question.id),
    index: game.index,
    answers: game.answers,
    score: game.score,
    lives: game.lives
  };
}

function persistCurrentGame() {
  if (!game || game.mode === "time" || game.completed) return;
  store.current = serializeGame();
  saveStore();
  refreshHome();
}

function resumeRun() {
  const saved = store.current;
  if (!saved || !questions.length) return;
  const resolved = saved.questionIds.map((id) => questionMap.get(id)).filter(Boolean);
  const rebuilt = prepareQuestionSequence(resolved, saved.seed);
  if (saved.bankVersion !== BANK_VERSION || rebuilt.length !== saved.questionIds.length) {
    discardRun();
    showToast("That saved run used an older question bank, so it was safely cleared.", 4200);
    return;
  }
  game = {
    ...saved,
    bankVersion: BANK_VERSION,
    runId: `${saved.seed}:${Date.now()}`,
    questions: rebuilt,
    answers: (Array.isArray(saved.answers) ? saved.answers : []).map((answer, index) => ({
      ...answer,
      questionIndex: Number.isInteger(answer.questionIndex) ? answer.questionIndex : index
    })),
    completed: false,
    remainingMs: null,
    deadline: null
  };
  navigate("game");
  setupGameChrome();
  renderQuestion();
}

function discardRun() {
  store.current = null;
  saveStore();
  refreshHome();
  showToast("Saved run discarded");
}

function quitGame() {
  clearGameTimers();
  persistCurrentGame();
  game = null;
  navigate("home");
}

function currentQuestion() {
  return game?.questions[game.index] || null;
}

function renderQuestion() {
  const question = currentQuestion();
  if (!question) {
    finishGame();
    return;
  }

  const finiteLength = Number.isFinite(MODE_META[game.mode].length);
  const total = finiteLength ? game.questions.length : Math.max(game.index + 1, game.answers.length + 1);
  const progress = finiteLength ? Math.round(((game.index + 1) / total) * 100) : Math.min(96, 8 + game.index * 4);
  $("#question-count").textContent = finiteLength ? `Question ${game.index + 1} of ${total}` : `Question ${game.index + 1}`;
  $("#progress-percent").textContent = finiteLength ? `${progress}%` : game.mode === "time" ? "Keep moving" : `${game.lives} lives`;
  $(".progress-track").setAttribute("aria-valuenow", progress);
  $("#progress-fill").style.width = `${progress}%`;
  $("#question-category").textContent = CATEGORY_NAMES[question.category];
  $("#question-difficulty").textContent = question.difficulty;
  $("#question-era").textContent = question.era === "evergreen" ? "Fundamentals" : question.era;
  $("#question-id").textContent = `Question ${question.id}`;
  $("#question-title").textContent = question.prompt;
  $("#question-context").hidden = true;
  $("#feedback-panel").hidden = true;
  $("#feedback-panel").classList.remove("is-wrong");
  $("#next-question").hidden = true;

  const answers = $("#answers");
  answers.replaceChildren(...question.choices.map((choice, index) => {
    const button = document.createElement("button");
    button.className = "answer-button";
    button.type = "button";
    button.dataset.index = index;
    button.innerHTML = `<span class="answer-key">${index + 1}</span><span class="answer-text"></span><span class="answer-state" aria-hidden="true"></span>`;
    $(".answer-text", button).textContent = choice;
    button.setAttribute("aria-label", `${index + 1}. ${choice}`);
    button.setAttribute("aria-keyshortcuts", String(index + 1));
    button.addEventListener("click", () => answerQuestion(index));
    return button;
  }));

  const existing = game.answers.find((answer) => answer.questionIndex === game.index);
  if (existing) {
    showAnsweredState(existing, false);
    setTimeout(() => $("#feedback-panel").focus({ preventScroll: true }), 80);
  } else {
    $("#live-region").textContent = `Question ${game.index + 1}. ${question.prompt}`;
    setTimeout(() => $("#question-title").focus({ preventScroll: true }), 80);
  }
}

function answerQuestion(selectedIndex) {
  const question = currentQuestion();
  if (!question || game.answers.some((answer) => answer.questionIndex === game.index)) return;
  if (game.mode === "time" && Date.now() >= game.deadline) {
    finishGame();
    return;
  }

  const correct = selectedIndex === question.correctIndex;
  const answer = {
    questionId: question.id,
    questionIndex: game.index,
    selectedIndex,
    selectedAnswer: question.choices[selectedIndex],
    correct,
    category: question.category,
    difficulty: question.difficulty
  };
  game.answers.push(answer);

  if (correct) {
    if (["time", "endurance"].includes(game.mode)) game.score += DIFFICULTY_POINTS[question.difficulty];
    else game.score += 1;
  } else if (game.mode === "endurance") {
    game.lives -= 1;
  }

  if (game.mode === "endurance" && game.answers.length === 10) unlockAchievement("endurance-10");
  if (!(game.mode === "daily" && game.isReplay)) updateLifetimeStats(answer);
  else saveStore();
  updateGameMetrics();
  showAnsweredState(answer, true);
  persistCurrentGame();

  if (game.mode === "time") {
    const runId = game.runId;
    autoAdvanceTimeout = window.setTimeout(() => {
      if (game?.mode === "time" && game.runId === runId && !game.completed) nextQuestion();
    }, 700);
  }
}

function showAnsweredState(answer, announce = true) {
  const question = currentQuestion();
  const buttons = $$(".answer-button");
  buttons.forEach((button, index) => {
    button.disabled = true;
    if (index === question.correctIndex) {
      button.classList.add("is-correct");
      $(".answer-state", button).textContent = "✓";
    } else if (index === answer.selectedIndex) {
      button.classList.add("is-wrong");
      $(".answer-state", button).textContent = "×";
    } else {
      button.classList.add("is-dimmed");
    }
  });

  const feedback = $("#feedback-panel");
  feedback.hidden = false;
  feedback.classList.toggle("is-wrong", !answer.correct);
  $("#feedback-icon").textContent = answer.correct ? "✓" : "×";
  $("#feedback-status").textContent = answer.correct ? "Correct" : "Not quite";
  $("#feedback-answer").textContent = question.answer;
  $("#feedback-explanation").textContent = question.explanation;
  $("#source-link").href = question.sourceUrl;
  $("#source-link").textContent = `${question.sourceLabel} ↗`;
  $("#report-link").dataset.questionId = question.id;
  $("#report-link").textContent = `Copy ${question.id} for feedback`;

  const shouldFinish = (Number.isFinite(MODE_META[game.mode].length) && game.index >= game.questions.length - 1) || (game.mode === "endurance" && game.lives <= 0);
  const next = $("#next-question");
  next.hidden = game.mode === "time";
  next.innerHTML = shouldFinish ? `See results <span aria-hidden="true">→</span>` : `Next question <span aria-hidden="true">→</span>`;
  if (announce) {
    $("#live-region").textContent = game.mode === "time"
      ? `${answer.correct ? "Correct." : "Incorrect."} ${question.answer}.`
      : `${answer.correct ? "Correct." : "Incorrect."} The answer is ${question.answer}. ${question.explanation}`;
    if (game.mode !== "time") setTimeout(() => feedback.focus({ preventScroll: true }), 50);
  }
}

function nextQuestion() {
  if (!game || game.completed) return;
  const question = currentQuestion();
  if (question && !game.answers.some((answer) => answer.questionIndex === game.index)) return;

  if (game.index >= game.questions.length - 1 && ["time", "endurance"].includes(game.mode) && (game.mode !== "endurance" || game.lives > 0)) {
    extendQuestionQueue();
  }
  const atEnd = game.index >= game.questions.length - 1;
  const noLives = game.mode === "endurance" && game.lives <= 0;
  if (atEnd || noLives) {
    finishGame();
    return;
  }

  game.index += 1;
  persistCurrentGame();
  renderQuestion();
}

function extendQuestionQueue() {
  const lastId = game.questions.at(-1)?.id;
  const cycle = Math.floor(game.questions.length / Math.max(1, questions.length)) + 1;
  const cycleSeed = `${game.seed}:cycle:${cycle}`;
  const pool = game.mode === "endurance" ? questions.filter((question) => question.difficulty !== "easy") : questions;
  const nextBatch = shuffled(pool, cycleSeed);
  if (nextBatch[0]?.id === lastId && nextBatch.length > 1) [nextBatch[0], nextBatch[1]] = [nextBatch[1], nextBatch[0]];
  game.questions.push(...prepareQuestionSequence(nextBatch, game.seed, game.questions));
}

function updateLifetimeStats(answer) {
  store.stats.answered += 1;
  if (answer.correct) store.stats.correct += 1;
  const category = store.stats.categories[answer.category] || { answered: 0, correct: 0 };
  category.answered += 1;
  if (answer.correct) category.correct += 1;
  store.stats.categories[answer.category] = category;
  unlockAutomaticAchievements();
  saveStore();
}

function updateGameMetrics() {
  $("#score-value").textContent = ["time", "endurance"].includes(game.mode) ? game.score.toLocaleString() : game.score;
  if (game.mode === "endurance") {
    $("#lives-value").textContent = `${"● ".repeat(game.lives).trim()}${game.lives < 3 ? ` ${"○ ".repeat(3 - game.lives).trim()}` : ""}`;
    $("#lives-display").setAttribute("aria-label", `${game.lives} ${game.lives === 1 ? "life" : "lives"} remaining`);
  }
}

function startTimer() {
  updateTimer();
  timerInterval = window.setInterval(updateTimer, 200);
}

function updateTimer() {
  if (!game || game.mode !== "time" || game.completed) return;
  game.remainingMs = Math.max(0, game.deadline - Date.now());
  const seconds = Math.ceil(game.remainingMs / 1000);
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  $("#timer-value").textContent = label;
  $("#timer-value").classList.toggle("is-urgent", seconds <= 10);
  $("#timer-display").setAttribute("aria-label", `${seconds} seconds remaining`);
  if (game.remainingMs <= 0) finishGame();
}

function clearGameTimers() {
  if (timerInterval) window.clearInterval(timerInterval);
  if (autoAdvanceTimeout) window.clearTimeout(autoAdvanceTimeout);
  timerInterval = null;
  autoAdvanceTimeout = null;
}

function finishGame() {
  if (!game || game.completed) return;
  game.completed = true;
  clearGameTimers();
  store.current = null;

  const total = game.answers.length;
  const correct = game.answers.filter((answer) => answer.correct).length;
  const accuracy = total ? correct / total : 0;
  const result = {
    mode: game.mode,
    category: game.category,
    date: game.date,
    score: game.score,
    total,
    correct,
    accuracy,
    answers: [...game.answers],
    questions: game.answers.map((answer) => game.questions[answer.questionIndex] || questionMap.get(answer.questionId)).filter(Boolean),
    isReplay: game.isReplay
  };

  if (!game.isReplay) {
    store.stats.runs += 1;
    store.stats.modes[game.mode] = (store.stats.modes[game.mode] || 0) + 1;
  }

  if (game.mode === "daily" && !game.isReplay) {
    store.daily[game.date] = {
      completed: true,
      correct,
      total,
      score: game.score,
      pattern: game.answers.map((answer) => answer.correct),
      completedAt: new Date().toISOString()
    };
    const streak = getStreak();
    store.stats.bestStreak = Math.max(store.stats.bestStreak, streak.current);
  }

  if (!game.isReplay && total >= 5 && accuracy === 1) unlockAchievement("perfect-run");
  if (game.mode === "endurance" && total >= 10) unlockAchievement("endurance-10");
  unlockAutomaticAchievements();
  saveStore();

  lastResult = result;
  game = null;
  renderResults(result);
  navigate("results");
  refreshHome();
}

function renderResults(result) {
  const meta = MODE_META[result.mode];
  const percent = Math.round(result.accuracy * 100);
  $("#result-score").textContent = result.total ? `${result.correct}/${result.total}` : "0/0";
  $("#result-score-label").textContent = ["time", "endurance"].includes(result.mode) ? `${result.score.toLocaleString()} points • ${meta.name}` : meta.name;
  $("#result-accuracy").textContent = `${percent}%`;
  $("#result-streak").textContent = `${getStreak().current} ${getStreak().current === 1 ? "day" : "days"}`;
  $("#result-best").textContent = bestCategory(result.answers);

  const title = percent === 100
    ? "A clean sweep. No notes."
    : percent >= 80
      ? "That was a properly quick run."
      : percent >= 60
        ? "You know your way around a garage."
        : percent >= 40
          ? "Good bones. Plenty of pace to find."
          : "Every expert starts in the slow lane.";
  const summary = percent >= 80
    ? "Strong recall across the board—and the explanations are there for the details worth keeping."
    : percent >= 50
      ? "A solid result, with a few new facts now parked in your memory."
      : "Review the answers below, then take a focused category run to turn misses into mileage.";
  $("#result-title").textContent = title;
  $("#result-summary").textContent = summary;

  const grid = $("#share-grid");
  grid.replaceChildren(...result.answers.map((answer) => {
    const tile = document.createElement("i");
    if (answer.correct) tile.classList.add("correct");
    tile.setAttribute("aria-label", answer.correct ? "Correct" : "Incorrect");
    return tile;
  }));

  const review = $("#review-list");
  review.replaceChildren(...result.questions.map((question, index) => {
    const answer = result.answers[index];
    const item = document.createElement("article");
    item.className = "review-item";
    const status = answer?.correct ? "Correct" : `Missed • ${answer?.selectedAnswer || "No answer"}`;
    item.innerHTML = `<span></span><h3></h3><p></p><a target="_blank" rel="noopener noreferrer"></a>`;
    $("span", item).textContent = `${status} • ${CATEGORY_NAMES[question.category]}`;
    $("h3", item).textContent = question.prompt;
    $("p", item).textContent = `${question.answer} — ${question.explanation}`;
    $("a", item).href = question.sourceUrl;
    $("a", item).textContent = `${question.sourceLabel} ↗`;
    return item;
  }));
  $("#review-panel").hidden = true;
  $("#review-misses").textContent = "Review answers";
  $("#review-misses").setAttribute("aria-expanded", "false");

  requestAnimationFrame(() => {
    $("#result-gauge-fill").style.strokeDashoffset = String(283 * (1 - result.accuracy));
  });
}

function bestCategory(answers) {
  if (!answers.length) return "—";
  const grouped = {};
  answers.forEach((answer) => {
    grouped[answer.category] ||= { correct: 0, total: 0 };
    grouped[answer.category].total += 1;
    if (answer.correct) grouped[answer.category].correct += 1;
  });
  const [winner] = Object.entries(grouped).sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total));
  return winner ? CATEGORY_NAMES[winner[0]] : "—";
}

function shareText(result) {
  const mode = result.mode === "category" ? CATEGORY_NAMES[result.category] : MODE_META[result.mode].name;
  const pattern = result.answers.map((answer) => answer.correct ? "🟩" : "🟥").join("");
  const streak = getStreak().current;
  const date = result.mode === "daily" ? ` ${result.date}` : "";
  const points = ["time", "endurance"].includes(result.mode) ? ` • ${result.score.toLocaleString()} pts` : "";
  const appUrl = location.protocol === "file:" ? "" : new URL("./", location.href).href;
  return `Octane IQ — ${mode}${date}\n${result.correct}/${result.total} • ${Math.round(result.accuracy * 100)}%${points}${result.mode === "daily" ? ` • ${streak}-day streak` : ""}\n${pattern}\n${appUrl}`.trim();
}

async function shareResult() {
  if (!lastResult) return;
  const text = shareText(lastResult);
  try {
    if (navigator.share) {
      await navigator.share({ title: "Octane IQ result", text });
    } else {
      await navigator.clipboard.writeText(text);
      showToast("Result copied to clipboard");
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Result copied to clipboard");
      } catch {
        showToast("Couldn’t copy the result");
      }
    }
  }
}

function toggleReview() {
  const panel = $("#review-panel");
  panel.hidden = !panel.hidden;
  $("#review-misses").textContent = panel.hidden ? "Review answers" : "Hide review";
  $("#review-misses").setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) {
    panel.setAttribute("tabindex", "-1");
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function copyQuestionReference(event) {
  event.preventDefault();
  const id = event.currentTarget.dataset.questionId;
  const question = questionMap.get(id);
  if (!question) return;
  const text = `${id}: ${question.prompt}\nReviewed ${question.reviewedAt}\nSource: ${question.sourceUrl}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast(`${id} copied`)).catch(() => showToast(`Question ID: ${id}`));
  } else {
    showToast(`Question ID: ${id}`);
  }
}

function handleKeyboard(event) {
  if (!game || $("#game-view").hidden) return;
  const interactive = event.target instanceof Element && event.target.closest("a, button, input, select, textarea");
  if (interactive && event.key === "Enter") return;
  if (["1", "2", "3", "4"].includes(event.key)) {
    const index = Number(event.key) - 1;
    const button = $(`.answer-button[data-index="${index}"]`);
    if (button && !button.disabled) button.click();
  } else if (event.key === "Enter" && !$("#next-question").hidden) {
    event.preventDefault();
    nextQuestion();
  }
}

function unlockAchievement(id) {
  if (!store.achievements.includes(id)) store.achievements.push(id);
}

function unlockAutomaticAchievements() {
  ACHIEVEMENTS.filter((achievement) => achievement.test).forEach((achievement) => {
    if (achievement.test(store)) unlockAchievement(achievement.id);
  });
}

function renderStats() {
  const answered = store.stats.answered;
  const accuracy = answered ? Math.round((store.stats.correct / answered) * 100) : null;
  const streak = getStreak();
  $("#stat-answered").textContent = answered.toLocaleString();
  $("#stat-accuracy").textContent = accuracy === null ? "—" : `${accuracy}%`;
  $("#stat-correct").textContent = `${store.stats.correct.toLocaleString()} correct answers`;
  $("#stat-streak").textContent = streak.current;
  $("#stat-best-streak").textContent = `Best: ${Math.max(streak.best, store.stats.bestStreak)} days`;
  $("#stat-runs").textContent = store.stats.runs.toLocaleString();

  const bars = $("#category-bars");
  bars.replaceChildren(...CATEGORY_ORDER.map((category) => {
    const stats = store.stats.categories[category];
    const percent = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
    const row = document.createElement("div");
    row.className = "category-bar-row";
    row.innerHTML = `<b></b><div class="category-bar-track"><i></i></div><span></span>`;
    $("b", row).textContent = CATEGORY_NAMES[category];
    $("i", row).style.width = `${percent}%`;
    $("span", row).textContent = stats.answered ? `${percent}% • ${stats.correct}/${stats.answered}` : "No data";
    return row;
  }));

  unlockAutomaticAchievements();
  const grid = $("#achievement-grid");
  grid.replaceChildren(...ACHIEVEMENTS.map((achievement) => {
    const unlocked = store.achievements.includes(achievement.id);
    const item = document.createElement("div");
    item.className = `achievement${unlocked ? "" : " is-locked"}`;
    item.innerHTML = `<span class="achievement-icon"></span><b></b><small></small>`;
    $(".achievement-icon", item).textContent = achievement.icon;
    $("b", item).textContent = achievement.name;
    $("small", item).textContent = unlocked ? achievement.description : `Locked • ${achievement.description}`;
    return item;
  }));
}

function exportData() {
  const readProgress = (key) => {
    try {
      const value = localStorage.getItem(key);
      return value === null ? null : JSON.parse(value);
    } catch {
      return null;
    }
  };
  const backup = {
    schema: PROGRESS_EXPORT_SCHEMA,
    version: PROGRESS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    games: {
      trivia: { storageKey: STORAGE_KEY, data: store },
      ...Object.fromEntries(Object.entries(GAME_PROGRESS_KEYS).map(([name, storageKey]) => [
        name,
        { storageKey, data: readProgress(storageKey) }
      ]))
    }
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `octane-iq-backup-${todayUTC()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Backup downloaded");
}

function resetData() {
  const confirmed = window.confirm("Reset all Octane IQ progress, streaks, and stats on this device? This cannot be undone.");
  if (!confirmed) return;
  clearGameTimers();
  store = defaultStore();
  game = null;
  lastResult = null;
  Object.values(GAME_PROGRESS_KEYS).forEach((key) => {
    try { localStorage.removeItem(key); } catch {}
  });
  saveStore();
  applyTheme(store.preferences.theme);
  refreshHome();
  renderStats();
  showToast("All local progress reset");
}

function showToast(message, duration = 2400) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, duration);
}
