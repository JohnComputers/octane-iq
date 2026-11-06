"use strict";

(() => {
  const KEY = "octane-iq:autoask:v1";
  const MAX_TURNS = 20;
  const qs = (selector) => document.querySelector(selector);
  const today = () => new Date().toISOString().slice(0, 10);
  const normal = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const dateHash = (value) => [...value].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0);
  const introductionYear = (item) => {
    const direct = Number(item.year ?? item.yearStart);
    if (Number.isInteger(direct) && direct >= 1885 && direct <= 2100) return direct;
    const match = String(item.yearLabel || item.displayName).match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  };

  let cars = [];
  let carMap = new Map();
  let knowledge = null;
  let eligible = [];
  let target = null;
  let car = null;
  let state = null;
  let mode = "daily";
  let lastPracticeId = null;
  let data = { daily: {} };
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved?.daily && typeof saved.daily === "object") data = saved; } catch {}
  try { const prefs = JSON.parse(localStorage.getItem("octane-iq:v1")); if (prefs?.preferences?.theme === "dark") document.documentElement.dataset.theme = "dark"; } catch {}

  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { message("Progress could not be saved in this browser."); } }
  function persist() { if (mode === "daily") { data.daily[today()] = state; save(); } }
  function message(text) { qs("#autoask-message").textContent = text; }
  function previousDay(date) { return new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10); }
  function streak() {
    let cursor = data.daily[today()]?.done ? today() : previousDay(today());
    let count = 0;
    while (data.daily[cursor]?.done) { count += 1; cursor = previousDay(cursor); }
    return count;
  }
  function dailyTarget() { return eligible[dateHash(today()) % eligible.length]; }
  function freshState(carId) { return { carId, history: [], used: [], guesses: [], done: false, won: false }; }
  function validSaved(saved, entry) { return saved?.carId === entry.carId && Array.isArray(saved.history) && saved.history.length <= MAX_TURNS && Array.isArray(saved.used) && Array.isArray(saved.guesses); }

  function newGame(kind) {
    mode = kind;
    qs("#daily-autoask").setAttribute("aria-pressed", String(mode === "daily"));
    qs("#practice-autoask").setAttribute("aria-pressed", String(mode === "practice"));
    if (mode === "daily") {
      target = dailyTarget();
      const saved = data.daily[today()];
      state = validSaved(saved, target) ? saved : freshState(target.carId);
    } else {
      const options = eligible.filter((entry) => entry.carId !== lastPracticeId);
      target = options[Math.floor(Math.random() * options.length)] || eligible[0];
      lastPracticeId = target.carId;
      state = freshState(target.carId);
    }
    car = carMap.get(target.carId);
    qs("#question-search").value = "";
    qs("#autoask-guess").value = "";
    message(state.done ? "This mystery is complete. Review the evidence or start a Practice run." : "Choose the most useful question first.");
    render();
  }

  function turnsUsed() { return state.history.length; }
  function availableQuestions() {
    const query = normal(qs("#question-search").value);
    return knowledge.questions.filter((question) => {
      if (state.used.includes(question.id)) return false;
      if (!query) return true;
      return normal([question.prompt, question.category, ...(question.keywords || [])].join(" ")).includes(query);
    });
  }

  function renderTurns() {
    const used = turnsUsed();
    const track = qs("#turn-track");
    track.replaceChildren(...Array.from({ length: MAX_TURNS }, (_, index) => {
      const tick = document.createElement("i");
      if (index < used) tick.classList.add("is-used");
      else if (index === used && !state.done) tick.classList.add("is-current");
      return tick;
    }));
    track.setAttribute("aria-valuenow", String(used));
    qs("#autoask-turn").textContent = state.done ? `${used} of ${MAX_TURNS} turns` : `Turn ${used + 1} of ${MAX_TURNS}`;
  }

  function renderQuestionBank() {
    const bank = qs("#question-bank");
    const available = availableQuestions();
    if (!available.length) {
      const empty = document.createElement("p");
      empty.className = "question-empty";
      empty.textContent = state.used.length === knowledge.questions.length ? "Every factual question has been used." : "No unused questions match that search.";
      bank.replaceChildren(empty);
      return;
    }
    bank.replaceChildren(...available.map((question) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fact-question";
      const category = document.createElement("span");
      category.textContent = question.category;
      const prompt = document.createElement("b");
      prompt.textContent = question.prompt;
      button.append(category, prompt);
      button.addEventListener("click", () => ask(question.id));
      return button;
    }));
  }

  function renderHistory() {
    const history = qs("#ask-history");
    if (!state.history.length) {
      const empty = document.createElement("li");
      empty.className = "empty-history";
      empty.textContent = "Your answers will build a trail here.";
      history.replaceChildren(empty);
    } else {
      history.replaceChildren(...state.history.map((entry, index) => {
        const item = document.createElement("li");
        const number = document.createElement("span");
        number.className = "history-number";
        number.textContent = index + 1;
        const copy = document.createElement("span");
        copy.className = "history-copy";
        const title = document.createElement("b");
        title.textContent = entry.type === "question" ? entry.prompt : `Guess: ${entry.text}`;
        const detail = document.createElement("small");
        detail.textContent = entry.type === "question" ? entry.category : "Make and model";
        copy.append(title, detail);
        const answer = document.createElement("span");
        answer.className = `history-answer ${entry.answer === true ? "yes" : "no"}`;
        answer.textContent = entry.answer === true ? (entry.type === "guess" ? "Correct" : "Yes") : "No";
        item.append(number, copy, answer);
        return item;
      }));
    }
    qs("#history-count").textContent = `${state.history.length} ${state.history.length === 1 ? "turn" : "turns"}`;
  }

  function renderResult() {
    qs("#ask-controls").hidden = state.done;
    const result = qs("#autoask-result");
    result.hidden = !state.done;
    if (!state.done) return;
    const photo = qs("#autoask-photo");
    photo.src = new URL(car.image, document.baseURI).href;
    photo.alt = `${car.displayName}. ${car.alt || ""}`;
    qs("#autoask-photo-credit").textContent = `${car.imageCredit} · ${car.license}`;
    qs("#autoask-result-label").textContent = state.won ? "Mystery solved" : "Twenty turns used";
    qs("#autoask-answer").textContent = car.displayName;
    qs("#autoask-outcome").textContent = state.won ? `Identified in ${turnsUsed()} of ${MAX_TURNS} turns.` : "The garage kept its secret this time.";
    qs("#autoask-fact").textContent = [car.yearLabel, car.country, car.clueSteps?.at(-1)].filter(Boolean).join(" · ");
    qs("#autoask-source").href = car.sourceUrl;
    setTimeout(() => result.focus({ preventScroll: true }), 30);
  }

  function render() {
    renderTurns();
    renderQuestionBank();
    renderHistory();
    renderResult();
    qs("#autoask-date").textContent = mode === "daily" ? `${today()} · UTC` : "Unlimited practice";
    qs("#autoask-streak").textContent = `${streak()}-day streak`;
  }

  function finishIfOut() {
    if (turnsUsed() >= MAX_TURNS && !state.done) { state.done = true; state.won = false; }
  }

  function ask(questionId) {
    if (state.done || turnsUsed() >= MAX_TURNS || state.used.includes(questionId)) return;
    const question = knowledge.questions.find((item) => item.id === questionId);
    if (!question || typeof target.answers[questionId] !== "boolean") return;
    const answer = target.answers[questionId];
    state.used.push(questionId);
    state.history.push({ type: "question", questionId, prompt: question.prompt, category: question.category, answer });
    qs("#question-search").value = "";
    finishIfOut();
    persist();
    render();
    message(state.done ? `Twenty turns used. The car was ${car.displayName}.` : `${answer ? "Yes" : "No"}. ${MAX_TURNS - turnsUsed()} turns remain.`);
  }

  function guess(value) {
    if (state.done || turnsUsed() >= MAX_TURNS) return;
    const text = String(value).trim();
    const normalized = normal(text);
    if (!normalized) { message("Enter a make and model first."); return; }
    if (state.guesses.some((item) => normal(item) === normalized)) { message("You already tried that car. Ask a question or make a different guess."); return; }
    const accepted = [car.displayName, `${car.make} ${car.model}`, ...(car.acceptedNames || [])].map(normal);
    const correct = accepted.includes(normalized);
    state.guesses.push(text);
    state.history.push({ type: "guess", text, answer: correct });
    state.won = correct;
    state.done = correct;
    finishIfOut();
    persist();
    qs("#autoask-guess").value = "";
    render();
    message(correct ? `Correct — it is the ${car.displayName}.` : state.done ? `Twenty turns used. The car was ${car.displayName}.` : `No — not ${text}. ${MAX_TURNS - turnsUsed()} turns remain.`);
  }

  async function share() {
    const questionCount = state.history.filter((entry) => entry.type === "question").length;
    const guessCount = state.history.filter((entry) => entry.type === "guess").length;
    const text = `Octane IQ AutoAsk${mode === "daily" ? ` · ${today()}` : " · Practice"}\n${state.won ? `${turnsUsed()}/${MAX_TURNS} turns` : `X/${MAX_TURNS}`} · ${questionCount} questions · ${guessCount} guesses\n${state.won ? "🚗✅" : "🚗❌"}\n${new URL("autoask.html", location.href).href}`;
    try {
      if (navigator.share) await navigator.share({ title: "Octane IQ AutoAsk", text });
      else { await navigator.clipboard.writeText(text); message("Spoiler-free result copied."); }
    } catch (error) { if (error.name !== "AbortError") message("Sharing is not available in this browser."); }
  }

  qs("#question-search").addEventListener("input", renderQuestionBank);
  qs("#car-guess-form").addEventListener("submit", (event) => { event.preventDefault(); guess(qs("#autoask-guess").value); });
  qs("#daily-autoask").addEventListener("click", () => { if (eligible.length) newGame("daily"); });
  qs("#practice-autoask").addEventListener("click", () => { if (eligible.length) newGame("practice"); });
  qs("#another-autoask").addEventListener("click", () => newGame("practice"));
  qs("#share-autoask").addEventListener("click", share);

  Promise.all([
    fetch(new URL("data/cars.json", document.baseURI)).then((response) => { if (!response.ok) throw new Error("Cars unavailable"); return response.json(); }),
    fetch(new URL("data/autoask.json", document.baseURI)).then((response) => { if (!response.ok) throw new Error("Fact bank unavailable"); return response.json(); })
  ]).then(([carCollection, factBank]) => {
    cars = carCollection;
    carMap = new Map(cars.map((item) => [item.id, item]));
    const explicit = new Map(factBank.cars.map((entry) => [entry.carId, entry.answers]));
    const explicitOrder = new Map(factBank.cars.map((entry, index) => [entry.carId, index]));
    const baseQuestions = factBank.questions;
    const originIds = { "United States": "origin-usa", "United Kingdom": "origin-uk", Italy: "origin-italy", Germany: "origin-germany", Japan: "origin-japan" };
    const entries = cars.map((item) => {
      const supplied = item.autoAsk || item.autoask || item.facts?.autoAsk || {};
      const answers = { ...supplied, ...(explicit.get(item.id) || {}) };
      const year = introductionYear(item);
      if (year) {
        answers["pre-1970"] = year < 1970;
        answers["1980-or-later"] = year >= 1980;
      }
      Object.entries(originIds).forEach(([country, id]) => { answers[id] = item.country === country; });
      return { carId: item.id, answers, year };
    });
    eligible = entries
      .filter((entry) => baseQuestions.every((question) => typeof entry.answers[question.id] === "boolean"))
      .sort((left, right) => (explicitOrder.get(left.carId) ?? Number.MAX_SAFE_INTEGER) - (explicitOrder.get(right.carId) ?? Number.MAX_SAFE_INTEGER) || left.carId.localeCompare(right.carId));
    if (!eligible.length || !baseQuestions.length) throw new Error("Empty AutoAsk collection");

    const makes = [...new Set(cars.map((item) => item.make).filter(Boolean))].sort();
    const decades = [...new Set(cars.map(introductionYear).filter(Boolean).map((year) => Math.floor(year / 10) * 10))].sort();
    const coveredCountries = new Set(Object.keys(originIds));
    const extraCountries = [...new Set(cars.map((item) => item.country).filter((country) => country && !coveredCountries.has(country)))].sort();
    const derivedQuestions = [
      ...makes.map((make) => ({ id: `make:${normal(make)}`, category: "Marque", prompt: `Is it made by ${make}?`, keywords: ["make", "brand", make] })),
      ...decades.map((decade) => ({ id: `decade:${decade}`, category: "Era", prompt: `Was it introduced in the ${decade}s?`, keywords: ["year", "decade", String(decade)] })),
      ...extraCountries.map((country) => ({ id: `country:${normal(country)}`, category: "Origin", prompt: `Is its marque from ${country}?`, keywords: ["country", "origin", country] }))
    ];
    eligible.forEach((entry) => {
      const item = carMap.get(entry.carId);
      makes.forEach((make) => { entry.answers[`make:${normal(make)}`] = item.make === make; });
      decades.forEach((decade) => { entry.answers[`decade:${decade}`] = entry.year ? Math.floor(entry.year / 10) * 10 === decade : false; });
      extraCountries.forEach((country) => { entry.answers[`country:${normal(country)}`] = item.country === country; });
    });
    knowledge = { ...factBank, questions: [...baseQuestions, ...derivedQuestions], cars: eligible };
    qs("#autoask-cars").replaceChildren(...cars.map((item) => { const option = document.createElement("option"); option.value = item.displayName; return option; }));
    newGame("daily");
  }).catch(() => {
    message("The AutoAsk fact bank could not load. Check your connection and refresh.");
    qs("#ask-controls").hidden = true;
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
})();
