"use strict";

(() => {
  const KEY = "octane-iq:spotter:v1";
  const qs = (selector) => document.querySelector(selector);
  const today = () => new Date().toISOString().slice(0, 10);
  const normal = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const dateHash = (value) => [...value].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0);
  const scales = [3.1, 2.5, 1.95, 1.45, 1];
  let cars = [];
  let car = null;
  let mode = "daily";
  let run = null;
  let ready = false;
  let lastPracticeId = null;
  let dailyAssignments = {};
  let data = { daily: {} };
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved?.daily && typeof saved.daily === "object") data = saved; } catch {}
  try { const prefs = JSON.parse(localStorage.getItem("octane-iq:v1")); if (prefs?.preferences?.theme === "dark") document.documentElement.dataset.theme = "dark"; } catch {}

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { message("This browser couldn’t save progress. The game still works."); }
  }
  function message(text) { qs("#spotter-message").textContent = text; }
  function streak() {
    let date = today();
    if (!data.daily[date]?.done) date = previousDay(date);
    let count = 0;
    while (data.daily[date]?.done) { count += 1; date = previousDay(date); }
    return count;
  }
  function previousDay(date) { return new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10); }
  function persist() { if (mode === "daily") { data.daily[today()] = run; save(); } }
  function dailyCar() { return cars.find((item) => item.id === dailyAssignments[today()]?.spotter) || cars[dateHash(today()) % cars.length]; }
  function newRun(kind) {
    mode = kind;
    qs("#daily-spotter").setAttribute("aria-pressed", String(mode === "daily"));
    qs("#practice-spotter").setAttribute("aria-pressed", String(mode === "practice"));
    if (mode === "daily") {
      const saved = data.daily[today()];
      const savedCar = saved?.carId && Array.isArray(saved.guesses) && saved.guesses.length <= 5 ? cars.find((item) => item.id === saved.carId) : null;
      car = savedCar || dailyCar();
      run = savedCar ? saved : { carId: car.id, guesses: [], done: false, won: false, hint: false };
    } else {
      const available = cars.filter((item) => item.id !== lastPracticeId);
      car = available[Math.floor(Math.random() * available.length)] || cars[0];
      lastPracticeId = car.id;
      run = { carId: car.id, guesses: [], done: false, won: false, hint: false };
    }
    ready = false;
    photoHideForNewRound();
    qs("#photo-loading").hidden = false;
    qs("#photo-error").hidden = true;
    const photo = qs("#car-photo");
    photo.onload = () => {
      ready = true;
      qs("#photo-loading").hidden = true;
      qs("#photo-error").hidden = true;
      render();
      requestAnimationFrame(() => {
        photo.style.visibility = "visible";
        requestAnimationFrame(() => { photo.style.transition = ""; });
      });
    };
    photo.onerror = () => { ready = false; qs("#photo-loading").hidden = true; qs("#photo-error").hidden = false; render(); };
    photo.alt = "Cropped detail of the mystery car";
    photo.src = new URL(car.image, document.baseURI).href;
    qs("#car-guess").value = "";
    message("");
    render();
  }
  function photoHideForNewRound() {
    const photo = qs("#car-photo");
    photo.style.visibility = "hidden";
    photo.style.transition = "none";
    photo.removeAttribute("src");
  }
  function render() {
    const attempt = Math.min(run.guesses.length, 4);
    qs("#spotter-date").textContent = mode === "daily" ? today() + " · UTC" : "Unlimited practice";
    qs("#spotter-attempt").textContent = run.done ? "Full reveal" : `Reveal ${attempt + 1} of 5`;
    qs("#spotter-streak").textContent = `${streak()}-day streak`;
    qs("#spotter-round").textContent = mode === "daily" ? "Daily challenge" : "Practice run";
    qs("#car-photo").style.transform = `scale(${run.done ? 1 : scales[attempt]})`;
    qs("#spotter-photo").classList.toggle("is-solved", run.done);
    qs("#reveal-badge").textContent = run.done ? car.yearLabel || "Full photo" : ["Detail crop", "A little wider", "Finding the shape", "Almost there", "Full frame"][attempt];
    qs("#guess-form").hidden = run.done;
    qs(".spotter-help").hidden = run.done;
    qs("#car-guess").disabled = !ready || run.done;
    qs("#submit-guess").disabled = !ready || run.done;
    qs("#skip-reveal").disabled = !ready || run.done;
    qs("#show-hint").disabled = !ready || run.done;
    qs("#spotter-hint").hidden = !run.hint || run.done;
    const clues = car.clueSteps || [];
    qs("#spotter-hint").textContent = clues[Math.min(attempt, Math.max(0, clues.length - 1))] || `This car comes from ${car.country}.`;
    qs("#guess-history").replaceChildren(...run.guesses.map((guess, index) => {
      const row = document.createElement("li");
      if (guess.correct) row.classList.add("correct");
      const text = document.createElement("span");
      text.textContent = `${index + 1}. ${guess.text}`;
      const status = document.createElement("span");
      status.textContent = guess.correct ? "✓ Correct" : guess.skipped ? "Skipped" : guess.makeMatch ? "✓ Make · try model" : "× Try again";
      row.append(text, status);
      return row;
    }));
    qs("#photo-credit").textContent = `${car.imageCredit} · ${car.license}`;
    qs("#photo-source").href = car.sourceUrl;
    qs("#spotter-result").hidden = !run.done;
    if (run.done) {
      qs("#spotter-outcome").textContent = run.won ? `Identified in ${run.guesses.length}/5${run.hint ? " · clue used" : ""}` : "One to remember for next time";
      qs("#spotter-answer").textContent = car.displayName;
      qs("#spotter-fact").textContent = [car.yearLabel, car.country, clues.at(-1)].filter(Boolean).join(" · ");
      qs("#car-photo").alt = `${car.displayName}. ${car.alt || ""}`;
    }
  }
  function guess(value, skipped = false) {
    if (!ready || run.done) return;
    const text = String(value).trim();
    const normalized = normal(text);
    if (!skipped && !normalized) { message("Enter a make and model first."); return; }
    if (!skipped && run.guesses.some((previous) => normal(previous.text) === normalized)) { message("You already tried that model. Try a different one."); return; }
    const accepted = [car.displayName, `${car.make} ${car.model}`, ...(car.acceptedNames || [])].map(normal);
    const correct = !skipped && accepted.includes(normalized);
    const makeMatch = !skipped && normalized.startsWith(normal(car.make));
    run.guesses.push({ text: skipped ? "Reveal skipped" : text, correct, skipped, makeMatch });
    run.won = correct;
    run.done = correct || run.guesses.length >= 5;
    persist();
    render();
    qs("#car-guess").value = "";
    if (run.done) { message(correct ? "Correct. The full car photo is revealed." : `The answer is ${car.displayName}. The full photo is revealed.`); qs("#spotter-result").focus({ preventScroll: true }); }
    else { message(makeMatch ? "You have the make. Try another model." : `More of the car revealed. ${5 - run.guesses.length} attempts left.`); qs("#car-guess").focus({ preventScroll: true }); }
  }
  async function share() {
    const tiles = run.guesses.map((item) => item.correct ? "🟩" : item.skipped ? "⬜" : "🟥").join("");
    const text = `Octane IQ Spotter${mode === "daily" ? " · " + today() : " · Practice"}\n${run.won ? run.guesses.length : "X"}/5${run.hint ? " · clue used" : ""} ${tiles}\n${new URL("spotter.html", location.href).href}`;
    try { if (navigator.share) await navigator.share({ title: "Octane IQ Spotter", text }); else { await navigator.clipboard.writeText(text); message("Spoiler-free result copied."); } }
    catch (error) { if (error.name !== "AbortError") message("Sharing isn’t available in this browser."); }
  }
  qs("#guess-form").addEventListener("submit", (event) => { event.preventDefault(); guess(qs("#car-guess").value); });
  qs("#daily-spotter").addEventListener("click", () => { if (cars.length) newRun("daily"); });
  qs("#practice-spotter").addEventListener("click", () => { if (cars.length) newRun("practice"); });
  qs("#next-car").addEventListener("click", () => newRun("practice"));
  qs("#skip-reveal").addEventListener("click", () => guess("", true));
  qs("#show-hint").addEventListener("click", () => { if (!run || !ready || run.done) return; run.hint = true; persist(); render(); });
  qs("#share-spotter").addEventListener("click", share);
  qs("#retry-photo").addEventListener("click", () => { qs("#photo-error").hidden = true; qs("#photo-loading").hidden = false; const image = new URL(car.image, document.baseURI); image.searchParams.set("retry", Date.now()); qs("#car-photo").src = image.href; });

  Promise.all([
    fetch(new URL("data/cars.json", document.baseURI)).then((response) => { if (!response.ok) throw new Error("Car collection unavailable"); return response.json(); }),
    fetch(new URL("data/daily-cars.json", document.baseURI)).then((response) => response.ok ? response.json() : {}).catch(() => ({}))
  ]).then(([collection, assignments]) => {
    if (!Array.isArray(collection) || !collection.length) throw new Error("Empty car collection");
    cars = collection;
    dailyAssignments = assignments;
    qs("#car-options").replaceChildren(...cars.map((item) => { const option = document.createElement("option"); option.value = item.displayName; return option; }));
    newRun("daily");
  }).catch(() => { qs("#photo-loading").hidden = true; qs("#photo-error").hidden = false; qs("#photo-error").innerHTML = '<strong>The car collection couldn’t load.</strong><p>Check your connection, then reload this page.</p><button class="button button-primary" type="button" id="reload-spotter">Reload</button>'; qs("#reload-spotter").addEventListener("click", () => location.reload()); qs("#submit-guess").disabled = true; });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
})();
