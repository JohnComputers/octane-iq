import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "dist", "data", "questions.json");
const questions = JSON.parse(await readFile(file, "utf8"));
const categories = ["history", "engineering", "evs", "motorsport", "design", "safety", "culture", "brands"];
const difficulties = ["easy", "medium", "hard"];
const required = ["id", "category", "difficulty", "era", "prompt", "answer", "distractors", "explanation", "sourceLabel", "sourceUrl", "reviewedAt", "tags"];
const errors = [];
const ids = new Set();
const prompts = new Set();

if (!Array.isArray(questions)) errors.push("Question bank must be an array.");
if (questions.length < 80) errors.push(`Expected at least 80 questions; found ${questions.length}.`);

for (const [index, question] of questions.entries()) {
  const label = question?.id || `record ${index + 1}`;
  for (const field of required) {
    if (!(field in question)) errors.push(`${label}: missing ${field}.`);
  }
  if (ids.has(question.id)) errors.push(`${label}: duplicate id.`);
  ids.add(question.id);
  if (prompts.has(question.prompt)) errors.push(`${label}: duplicate prompt.`);
  prompts.add(question.prompt);
  if (!categories.includes(question.category)) errors.push(`${label}: invalid category ${question.category}.`);
  if (!difficulties.includes(question.difficulty)) errors.push(`${label}: invalid difficulty ${question.difficulty}.`);
  if (!Array.isArray(question.distractors) || question.distractors.length !== 3) errors.push(`${label}: must have exactly three distractors.`);
  if (new Set([question.answer, ...(question.distractors || [])]).size !== 4) errors.push(`${label}: answer choices must be unique.`);
  if (!Array.isArray(question.tags) || question.tags.length < 2) errors.push(`${label}: expected at least two tags.`);
  try {
    const source = new URL(question.sourceUrl);
    if (source.protocol !== "https:") errors.push(`${label}: source URL must use HTTPS.`);
  } catch {
    errors.push(`${label}: invalid source URL.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(question.reviewedAt)) errors.push(`${label}: invalid review date.`);
  if (String(question.prompt).length < 20) errors.push(`${label}: prompt is too short.`);
  if (String(question.explanation).length < 35) errors.push(`${label}: explanation is too short.`);
}

for (const category of categories) {
  const count = questions.filter((question) => question.category === category).length;
  if (count < 10) errors.push(`${category}: expected at least 10 questions; found ${count}.`);
}

if (errors.length) {
  console.error(`Question validation failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const distribution = Object.fromEntries(categories.map((category) => [category, questions.filter((question) => question.category === category).length]));
console.log(`Validated ${questions.length} sourced questions across ${categories.length} categories.`);
console.log(distribution);
