import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const source = await readFile(resolve(root, "dist/app.js"), "utf8");
const questionBank = JSON.parse(await readFile(resolve(root, "dist/data/questions.json"), "utf8"));
const storage = new Map();
const context = vm.createContext({
  console,
  crypto: webcrypto,
  URL,
  Date,
  Math,
  JSON,
  Map,
  Set,
  Object,
  Array,
  Number,
  String,
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  },
  document: { addEventListener: () => {} },
  __QUESTIONS__: questionBank
});

vm.runInContext(source, context, { filename: "app.js" });
const result = vm.runInContext(`(() => {
  questions = __QUESTIONS__;
  questionMap = new Map(questions.map((question) => [question.id, question]));
  const failures = [];
  const recentDailySets = [];
  for (let day = 0; day < 366; day += 1) {
    const dateValue = new Date(Date.UTC(2026, 0, 1));
    dateValue.setUTCDate(dateValue.getUTCDate() + day);
    const date = dateValue.toISOString().slice(0, 10);
    const seed = "daily:" + date;
    const first = selectDailyQuestions(date);
    const second = selectDailyQuestions(date);
    if (first.length !== 7) failures.push(seed + " did not select seven questions");
    if (new Set(first.map((question) => question.id)).size !== first.length) failures.push(seed + " selected duplicates");
    if (first.map((question) => question.id).join() !== second.map((question) => question.id).join()) failures.push(seed + " was not deterministic");
    if (new Set(first.map((question) => question.category)).size !== 7) failures.push(seed + " was not category-balanced");
    const recentIds = new Set(recentDailySets.flat());
    if (first.some((question) => recentIds.has(question.id))) failures.push(seed + " repeated a question from the prior seven days");
    recentDailySets.push(first.map((question) => question.id));
    if (recentDailySets.length > 7) recentDailySets.shift();
    for (const question of first) {
      const prepared = prepareQuestion(question, seed);
      if (prepared.choices.length !== 4 || new Set(prepared.choices).size !== 4) failures.push(question.id + " has invalid prepared choices");
      if (prepared.choices[prepared.correctIndex] !== question.answer) failures.push(question.id + " correct index mismatch");
    }
  }
  const categoryRuns = CATEGORY_ORDER.map((category) => selectBalanced(10, "category-test:" + category, category));
  if (categoryRuns.some((run) => run.length !== 10)) failures.push("A category run did not contain ten questions");
  if (categoryRuns.some((run, index) => run.some((question) => question.category !== CATEGORY_ORDER[index]))) failures.push("A category run leaked another category");
  return { failures, checkedDailySeeds: 366, checkedPreparedQuestions: 366 * 7 };
})()`, context);

if (result.failures.length) {
  console.error(`Logic validation failed with ${result.failures.length} issue(s):`);
  result.failures.slice(0, 20).forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Validated ${result.checkedDailySeeds} deterministic daily seeds and ${result.checkedPreparedQuestions} prepared question states.`);
