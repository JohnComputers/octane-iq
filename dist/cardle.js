"use strict";
(() => {
  const $ = (selector) => document.querySelector(selector);
  const normalize = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const date = () => new Date().toISOString().slice(0, 10);
  const hash = (value) => [...value].reduce((n, char) => (Math.imul(n, 31) + char.charCodeAt(0)) >>> 0, 7);
  const variants = { cardle: ["Cardle", "A daily car from across the automotive world."], supercardle: ["Supercardle", "The supercar paddock. Five attempts, every day."], eurocardle: ["Eurocardle", "European cars, from everyday legends to exotic machinery."] };
  const requestedVariant = new URLSearchParams(location.search).get("game");
  const variant = Object.hasOwn(variants, requestedVariant) ? requestedVariant : "cardle";
  const key = "octane-iq:cardle:v2";
  const scales = [3.2, 2.6, 2, 1.5, 1];
  const catalog = new Map();
  let cars = [], pool = [], target = null, run = null, ready = false, mode = "daily", lastPractice = null;
  let dailyAssignments = {};
  let saved = { daily: {} };
  try { const parsed = JSON.parse(localStorage.getItem(key)); if (parsed?.daily) saved = parsed; } catch {}
  try { const prefs = JSON.parse(localStorage.getItem("octane-iq:v1")); if (prefs?.preferences?.theme === "dark") document.documentElement.dataset.theme = "dark"; } catch {}
  const say = (text) => { $("#cardle-message").textContent = text; };
  const storageId = (day = date()) => `${variant}:${day}`;
  const persist = () => { if (mode !== "daily") return; saved.daily[storageId(run.date || date())] = run; try { localStorage.setItem(key, JSON.stringify(saved)); } catch { say("This browser couldn’t save progress. You can keep playing."); } };
  const actualYear = (car) => Number.isInteger(car.year) ? car.year : /^\d{4}$/.test(car.yearLabel) ? Number(car.yearLabel) : null;
  const simpleModel = (car) => car.familyModel || car.model;
  const prettyMake = (name) => name.length <= 4 ? name : name.toLowerCase().replace(/(^|[ -])\S/g, (char) => char.toUpperCase());
  const commonMakeGroups = [
    ["Volkswagen", "VW"],
    ["Chevrolet", "Chevy"],
    ["Mercedes-Benz", "Mercedes Benz", "Mercedes"],
    ["Alfa Romeo", "Alfa"],
    ["Aston Martin", "Aston"],
    ["Rolls-Royce", "Rolls Royce"],
    ["General Motors", "GM"]
  ];
  function uniqueNames(names) {
    const seen = new Set();
    return names.filter(Boolean).filter((name) => { const value = normalize(name); if (!value || seen.has(value)) return false; seen.add(value); return true; });
  }
  function commonMakeNames(make) {
    const group = commonMakeGroups.find((names) => names.some((name) => normalize(name) === normalize(make)));
    return group ? group.filter((name) => normalize(name) !== normalize(make)) : [];
  }
  function stripLeadingMake(value, make) {
    const pattern = String(make).trim().split(/[\s-]+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+");
    const match = value.match(new RegExp(`^${pattern}(?:[\\s-]+|$)`, "i"));
    return match ? value.slice(match[0].length).trim() : null;
  }
  function makeNames(car) { return uniqueNames([car.make, ...(car.makeAliases || []), ...commonMakeNames(car.make), ...(normalize(car.make) === "honda" && normalize(car.model).includes("nsx") ? ["Acura"] : []), ...(normalize(car.make) === "austin" ? ["Mini", "Morris"] : [])]); }
  function modelNames(car) {
    const names = [simpleModel(car), car.model];
    const makes = makeNames(car).sort((a, b) => b.length - a.length);
    for (let alias of car.acceptedNames || []) {
      alias = alias.replace(/^\d{4}\s+/, "").trim();
      for (const make of makes) {
        const model = stripLeadingMake(alias, make);
        if (model !== null) { alias = model; break; }
      }
      if (!makes.some((make) => normalize(make) === normalize(alias))) names.push(alias);
    }
    return uniqueNames(names);
  }
  function addCatalog(make, models) {
    const normalized = normalize(make);
    const item = catalog.get(normalized) || { name: prettyMake(make), models: new Set() };
    models.forEach((model) => { if (model?.trim()) item.models.add(model.trim()); });
    catalog.set(normalized, item);
  }
  function fillModels(clear = true) {
    const entry = catalog.get(normalize($("#guess-make").value));
    const input = $("#guess-model");
    if (clear && input.dataset.make !== normalize($("#guess-make").value)) input.value = "";
    input.dataset.make = normalize($("#guess-make").value);
    input.disabled = !entry || !ready || run?.done;
    input.placeholder = entry ? `Search ${entry.name} models` : "Choose a make first";
    $("#model-list").replaceChildren(...(entry ? [...entry.models].sort((a, b) => a.localeCompare(b)) : []).map((model) => { const option = document.createElement("option"); option.value = model; return option; }));
    $("#catalog-status").textContent = entry ? `${entry.models.size} ${entry.name} model names available` : `${catalog.size} makes · searchable dropdowns`;
  }
  function start(kind) {
    mode = kind;
    $("#cardle-daily").setAttribute("aria-pressed", String(kind === "daily"));
    $("#cardle-practice").setAttribute("aria-pressed", String(kind === "practice"));
    if (kind === "daily") {
      const prior = saved.daily[storageId()];
      const priorTarget = prior?.carId && Array.isArray(prior.guesses) && prior.guesses.length <= 5 ? pool.find((car) => car.id === prior.carId) : null;
      const assignedTarget = pool.find((car) => car.id === dailyAssignments[date()]?.[variant]);
      target = priorTarget || assignedTarget || pool[hash(`${variant}:${date()}`) % pool.length];
      run = priorTarget ? { ...prior, date: prior.date || date() } : { carId: target.id, date: date(), guesses: [], done: false, won: false, hint: false };
    } else {
      const choices = pool.filter((car) => car.id !== lastPractice);
      target = choices[Math.floor(Math.random() * choices.length)] || pool[0];
      lastPractice = target.id;
      run = { carId: target.id, guesses: [], done: false, won: false, hint: false };
    }
    ready = false;
    const photo = $("#cardle-photo");
    photo.style.visibility = "hidden";
    photo.style.transition = "none";
    photo.removeAttribute("src");
    $("#cardle-loading").hidden = false;
    $("#cardle-error").hidden = true;
    photo.onload = () => {
      ready = true;
      render();
      $("#cardle-loading").hidden = true;
      $("#cardle-error").hidden = true;
      requestAnimationFrame(() => { photo.style.visibility = "visible"; requestAnimationFrame(() => { photo.style.transition = ""; }); });
    };
    photo.onerror = () => { ready = false; $("#cardle-loading").hidden = true; $("#cardle-error").hidden = false; render(); };
    photo.alt = "Cropped detail of the mystery car";
    $("#guess-make").value = "";
    $("#guess-model").value = "";
    $("#guess-year").value = "";
    say("");
    render();
    photo.src = new URL(target.image, document.baseURI).href;
  }
  function render() {
    const stage = Math.min(run.guesses.length, 4);
    $("#cardle-date").textContent = mode === "daily" ? `${date()} · UTC` : "Unlimited practice";
    $("#cardle-pool").textContent = `${pool.length} photographed cars`;
    $("#cardle-reveal").textContent = run.done ? "Full reveal" : `Reveal ${stage + 1} of 5`;
    $("#cardle-photo").style.transform = `scale(${run.done ? 1 : scales[stage]})`;
    $("#cardle-photo-wrap").classList.toggle("is-solved", run.done);
    $("#cardle-badge").textContent = run.done ? `${actualYear(target)}` : ["Detail crop", "Wider view", "Finding the shape", "Almost there", "Full frame"][stage];
    $("#cardle-form").hidden = run.done;
    $("#cardle-help").hidden = run.done;
    $("#guess-make").disabled = !ready || run.done;
    $("#guess-year").disabled = !ready || run.done;
    $("#cardle-submit").disabled = !ready || run.done;
    $("#cardle-skip").disabled = !ready || run.done;
    $("#cardle-hint-button").disabled = !ready || run.done;
    fillModels(false);
    $("#cardle-hint").hidden = !run.hint || run.done;
    $("#cardle-hint").textContent = target.clueSteps?.[Math.min(stage, 3)] || `This car's brand comes from ${target.country}.`;
    $("#cardle-credit").textContent = `${target.imageCredit} · ${target.license}`;
    $("#cardle-rows").replaceChildren(...run.guesses.map((guess, index) => {
      const row = document.createElement("tr");
      const number = document.createElement("td"); number.textContent = index + 1; row.append(number);
      const fields = guess.skipped ? ["Skipped", "Skipped", "Skipped"] : [guess.make, guess.model, String(guess.year)];
      fields.forEach((value, field) => {
        const cell = document.createElement("td"); cell.textContent = value;
        cell.className = guess.skipped ? "" : guess.hits[field] ? "hit" : "miss";
        const status = document.createElement("small");
        status.textContent = guess.skipped ? "—" : guess.hits[field] ? field === 2 && guess.year !== actualYear(target) ? "✓ Within ±2" : "✓ Correct" : field === 2 ? guess.year < actualYear(target) ? "↑ Newer" : "↓ Older" : "× Incorrect";
        cell.append(status); row.append(cell);
      });
      return row;
    }));
    $("#cardle-result").hidden = !run.done;
    if (run.done) {
      $("#cardle-outcome").textContent = run.won ? `All three correct in ${run.guesses.length}/5${run.hint ? " · clue used" : ""}` : "Here’s the car";
      $("#cardle-answer").textContent = `${actualYear(target)} ${target.make} ${simpleModel(target)}`;
      $("#cardle-answer-note").textContent = `${target.displayName}. ${target.clueSteps?.at(-1) || ""}`;
      $("#cardle-photo").alt = target.displayName;
    }
  }
  function submit(skipped = false) {
    if (!run || !ready || run.done) return;
    const make = $("#guess-make").value.trim(), model = $("#guess-model").value.trim(), year = Number($("#guess-year").value);
    const entry = catalog.get(normalize(make));
    const knownModel = entry && [...entry.models].some((name) => normalize(name) === normalize(model));
    if (!skipped && (!entry || !knownModel || !Number.isInteger(year) || year < 1886 || year > 2028)) { say("Choose a make and one of its models from the searchable dropdowns, then enter a four-digit year."); return; }
    const hits = skipped ? [false, false, false] : [makeNames(target).some((name) => normalize(name) === normalize(make)), modelNames(target).some((name) => normalize(name) === normalize(model)), Math.abs(year - actualYear(target)) <= 2];
    run.guesses.push({ make, model, year, hits, skipped });
    run.won = !skipped && hits.every(Boolean);
    run.done = run.won || run.guesses.length >= 5;
    persist(); render();
    say(run.done ? run.won ? "Correct make, model and year. Full photo revealed." : `The answer is ${actualYear(target)} ${target.make} ${simpleModel(target)}.` : `${hits.filter(Boolean).length} fields correct. ${5 - run.guesses.length} attempts left.`);
    if (run.done) $("#cardle-result").focus({ preventScroll: true });
  }
  $("#guess-make").addEventListener("input", () => fillModels());
  $("#cardle-form").addEventListener("submit", (event) => { event.preventDefault(); submit(); });
  $("#cardle-daily").addEventListener("click", () => { if (pool.length) start("daily"); });
  $("#cardle-practice").addEventListener("click", () => { if (pool.length) start("practice"); });
  $("#cardle-next").addEventListener("click", () => start("practice"));
  $("#cardle-skip").addEventListener("click", () => submit(true));
  $("#cardle-hint-button").addEventListener("click", () => { if (ready && !run.done) { run.hint = true; persist(); render(); } });
  $("#cardle-retry").addEventListener("click", () => { if (!target) { location.reload(); return; } $("#cardle-loading").hidden = false; $("#cardle-error").hidden = true; const url = new URL(target.image, document.baseURI); url.searchParams.set("retry", Date.now()); $("#cardle-photo").src = url.href; });
  $("#cardle-share").addEventListener("click", async () => {
    const pattern = run.guesses.map((guess) => guess.hits.map((hit) => hit ? "🟩" : "🟥").join("")).join("\n");
    const text = `Octane IQ ${variants[variant][0]} · ${mode === "daily" ? date() : "Practice"}\n${run.won ? run.guesses.length : "X"}/5${run.hint ? " · clue used" : ""}\n${pattern}\n${new URL(`cardle.html${variant === "cardle" ? "" : "?game=" + variant}`, location.href).href}`;
    try { if (navigator.share) await navigator.share({ title: variants[variant][0], text }); else { await navigator.clipboard.writeText(text); say("Result copied without spoilers."); } } catch (error) { if (error.name !== "AbortError") say("Sharing isn’t available in this browser."); }
  });
  $("#cardle-title").textContent = variants[variant][0];
  document.title = `${variants[variant][0]} | Octane IQ`;
  $("#cardle-description").textContent = variants[variant][1];
  document.querySelector(`[data-variant="${variant}"]`).setAttribute("aria-current", "page");
  Promise.all([
    fetch(new URL("data/cars.json", document.baseURI)).then((response) => { if (!response.ok) throw new Error(); return response.json(); }),
    fetch(new URL("data/vehicle-catalog.json", document.baseURI)).then((response) => response.ok ? response.json() : { makes: {} }).catch(() => ({ makes: {} })),
    fetch(new URL("data/daily-cars.json", document.baseURI)).then((response) => response.ok ? response.json() : {}).catch(() => ({}))
  ]).then(([collection, vehicleCatalog, assignments]) => {
    dailyAssignments = assignments;
    cars = collection;
    Object.entries(vehicleCatalog.makes || {}).forEach(([make, models]) => { addCatalog(make, models); commonMakeNames(make).forEach((alias) => addCatalog(alias, models)); });
    cars.forEach((car) => makeNames(car).forEach((make) => addCatalog(make, modelNames(car))));
    $("#make-list").replaceChildren(...[...catalog.values()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => { const option = document.createElement("option"); option.value = item.name; return option; }));
    pool = cars.filter((car) => actualYear(car) && (variant === "supercardle" ? car.supercar === true : variant === "eurocardle" ? car.region === "europe" || ["Germany", "United Kingdom", "Italy", "France", "Sweden", "Spain", "Czech Republic"].includes(car.country) : true));
    if (!pool.length) throw new Error("No eligible photos");
    start("daily");
  }).catch(() => { $("#cardle-loading").hidden = true; $("#cardle-error").hidden = false; say("The car collection couldn’t load. Refresh when connected."); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
})();
