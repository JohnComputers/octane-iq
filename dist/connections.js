"use strict";

(() => {
  const KEY = "octane-iq:connections:v1";
  const COLORS = ["#f2c94c", "#74c69d", "#69a8e8", "#b995d6"];
  const EMOJI = ["🟨", "🟩", "🟦", "🟪"];
  const qs = (selector) => document.querySelector(selector);
  const today = () => new Date().toISOString().slice(0, 10);
  const hash = (value) => [...String(value)].reduce((result, char) => (Math.imul(result, 31) + char.charCodeAt(0)) >>> 0, 0);
  const randomFrom = (seed) => {
    let value = hash(seed);
    return () => {
      value += 0x6D2B79F5;
      let output = value;
      output = Math.imul(output ^ (output >>> 15), output | 1);
      output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
      return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
    };
  };
  const shuffled = (items, seed) => {
    const output = [...items];
    const random = randomFrom(seed);
    for (let index = output.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [output[index], output[target]] = [output[target], output[index]];
    }
    return output;
  };

  let puzzles = [];
  let puzzle = null;
  let state = null;
  let mode = "daily";
  let practiceIndex = -1;
  let data = { daily: {} };
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved?.daily && typeof saved.daily === "object") data = saved; } catch {}
  try { const prefs = JSON.parse(localStorage.getItem("octane-iq:v1")); if (prefs?.preferences?.theme === "dark") document.documentElement.dataset.theme = "dark"; } catch {}

  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { message("Progress could not be saved in this browser."); } }
  function persist() { if (mode === "daily") { data.daily[today()] = state; save(); } }
  function message(text) { qs("#connections-message").textContent = text; }
  function dailyPuzzle() { return puzzles[hash(today()) % puzzles.length]; }
  function allTerms(item) { return item.groups.flatMap((group) => group.terms); }
  function validSaved(saved, item) {
    const terms = new Set(allTerms(item));
    return saved?.puzzleId === item.id && Array.isArray(saved.order) && saved.order.length === 16 && saved.order.every((term) => terms.has(term)) && Array.isArray(saved.found) && Array.isArray(saved.attempts);
  }

  function newGame(kind) {
    mode = kind;
    qs("#daily-connections").setAttribute("aria-pressed", String(mode === "daily"));
    qs("#practice-connections").setAttribute("aria-pressed", String(mode === "practice"));
    if (mode === "daily") {
      puzzle = dailyPuzzle();
      const saved = data.daily[today()];
      state = validSaved(saved, puzzle) ? { ...saved, selected: [] } : freshState(puzzle, `daily:${today()}`);
    } else {
      const options = puzzles.map((_, index) => index).filter((index) => index !== practiceIndex);
      practiceIndex = options[Math.floor(Math.random() * options.length)] ?? 0;
      puzzle = puzzles[practiceIndex];
      state = freshState(puzzle, `practice:${Date.now()}:${Math.random()}`);
    }
    message("Select four terms that share one exact connection.");
    render();
  }

  function freshState(item, seed) {
    return { puzzleId: item.id, order: shuffled(allTerms(item), seed), found: [], selected: [], mistakes: 0, attempts: [], done: false, won: false };
  }

  function groupIndexForTerm(term) { return puzzle.groups.findIndex((group) => group.terms.includes(term)); }
  function solvedTerms() { return new Set(state.found.flatMap((index) => puzzle.groups[index].terms)); }

  function renderGroup(group, index, revealed = false) {
    const item = document.createElement("article");
    item.className = "solved-group";
    item.style.setProperty("--group-color", COLORS[index]);
    const name = document.createElement("b");
    name.textContent = `${revealed ? "Revealed · " : ""}${group.label}`;
    const terms = document.createElement("span");
    terms.textContent = group.terms.join(" · ");
    const detail = document.createElement("p");
    detail.textContent = group.explanation;
    item.append(name, terms, detail);
    return item;
  }

  function render() {
    const shownGroups = state.done ? puzzle.groups.map((group, index) => ({ group, index, revealed: !state.found.includes(index) })) : state.found.map((index) => ({ group: puzzle.groups[index], index, revealed: false }));
    qs("#solved-groups").replaceChildren(...shownGroups.map(({ group, index, revealed }) => renderGroup(group, index, revealed)));
    const solved = solvedTerms();
    const remaining = state.order.filter((term) => !solved.has(term));
    const grid = qs("#connection-grid");
    grid.hidden = state.done;
    grid.replaceChildren(...remaining.map((term) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `term-button${state.selected.includes(term) ? " is-selected" : ""}`;
      button.textContent = term;
      button.setAttribute("aria-pressed", String(state.selected.includes(term)));
      button.addEventListener("click", () => toggleTerm(term));
      return button;
    }));
    qs("#connections-date").textContent = mode === "daily" ? `${today()} · UTC` : "Unlimited practice";
    qs("#connections-title").textContent = puzzle.title;
    qs("#connections-progress").textContent = `${state.found.length} of 4 groups`;
    const dots = [...qs("#mistake-dots").children];
    dots.forEach((dot, index) => dot.classList.toggle("is-spent", index >= 4 - state.mistakes));
    qs("#mistake-dots").setAttribute("aria-label", `${Math.max(0, 4 - state.mistakes)} mistakes remaining`);
    qs("#submit-group").disabled = state.done || state.selected.length !== 4;
    qs("#shuffle-terms").disabled = state.done;
    qs("#deselect-terms").disabled = state.done || !state.selected.length;
    qs("#connections-result").hidden = !state.done;
    if (state.done) {
      qs("#connections-outcome").textContent = state.won ? "Four clean connections." : "The board fought back.";
      qs("#connections-summary").textContent = state.won ? `Solved with ${state.mistakes} ${state.mistakes === 1 ? "mistake" : "mistakes"}. Every group is explained above.` : `You found ${state.found.length} of 4 groups. The complete board is revealed above.`;
      setTimeout(() => qs("#connections-result").focus({ preventScroll: true }), 30);
    }
  }

  function toggleTerm(term) {
    if (state.done) return;
    if (state.selected.includes(term)) state.selected = state.selected.filter((item) => item !== term);
    else if (state.selected.length < 4) state.selected.push(term);
    else { message("Four terms are already selected. Deselect one first."); return; }
    render();
  }

  function submitGroup() {
    if (state.done || state.selected.length !== 4) return;
    const selected = [...state.selected];
    state.attempts.push(selected);
    const match = puzzle.groups.findIndex((group, index) => !state.found.includes(index) && group.terms.every((term) => selected.includes(term)));
    if (match >= 0) {
      state.found.push(match);
      state.selected = [];
      state.done = state.found.length === 4;
      state.won = state.done;
      message(state.done ? "All four connections found." : `${puzzle.groups[match].label} — locked in.`);
    } else {
      state.mistakes += 1;
      const oneAway = puzzle.groups.some((group, index) => !state.found.includes(index) && group.terms.filter((term) => selected.includes(term)).length === 3);
      state.selected = [];
      state.done = state.mistakes >= 4;
      message(state.done ? "Four misses. The complete board is now revealed." : oneAway ? "One away — three of those belong together." : "Not a group. Look for a more exact connection.");
    }
    persist();
    render();
  }

  function shuffleTerms() {
    const solved = solvedTerms();
    const open = shuffled(state.order.filter((term) => !solved.has(term)), `manual:${Date.now()}:${Math.random()}`);
    let cursor = 0;
    state.order = state.order.map((term) => solved.has(term) ? term : open[cursor++]);
    persist();
    render();
    message("Unsolved terms shuffled.");
  }

  async function share() {
    const lines = state.attempts.map((attempt) => attempt.map((term) => EMOJI[groupIndexForTerm(term)]).join(""));
    const text = `Octane IQ CarConnections${mode === "daily" ? ` · ${today()}` : " · Practice"}\n${state.found.length}/4 groups · ${state.mistakes}/4 mistakes\n${lines.join("\n")}\n${new URL("connections.html", location.href).href}`;
    try {
      if (navigator.share) await navigator.share({ title: "Octane IQ CarConnections", text });
      else { await navigator.clipboard.writeText(text); message("Spoiler-free result copied."); }
    } catch (error) { if (error.name !== "AbortError") message("Sharing is not available in this browser."); }
  }

  qs("#daily-connections").addEventListener("click", () => { if (puzzles.length) newGame("daily"); });
  qs("#practice-connections").addEventListener("click", () => { if (puzzles.length) newGame("practice"); });
  qs("#another-connections").addEventListener("click", () => newGame("practice"));
  qs("#submit-group").addEventListener("click", submitGroup);
  qs("#shuffle-terms").addEventListener("click", shuffleTerms);
  qs("#deselect-terms").addEventListener("click", () => { state.selected = []; render(); message("Selection cleared."); });
  qs("#share-connections").addEventListener("click", share);

  fetch(new URL("data/connections.json", document.baseURI)).then((response) => {
    if (!response.ok) throw new Error("Puzzle collection unavailable");
    return response.json();
  }).then((collection) => {
    if (!Array.isArray(collection) || !collection.length) throw new Error("Empty puzzle collection");
    puzzles = collection;
    newGame("daily");
  }).catch(() => {
    message("The puzzle collection could not load. Check your connection and refresh.");
    qs("#submit-group").disabled = true;
    qs("#shuffle-terms").disabled = true;
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
})();
