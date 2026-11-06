import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../dist/data");
const cars = JSON.parse(await readFile(resolve(root, "cars.json"), "utf8"));
const start = process.argv[2] || new Date().toISOString().slice(0, 10);
let previous = {};
try { previous = JSON.parse(await readFile(resolve(root, "daily-cars.json"), "utf8")); } catch {}
const output = Object.fromEntries(Object.entries(previous).filter(([date]) => date <= start));
const hash = (value, seed = 7) => [...value].reduce((n, char) => (Math.imul(n, 31) + char.charCodeAt(0)) >>> 0, seed);
const pools = {
  cardle: cars.filter((car) => Number.isInteger(car.year)),
  supercardle: cars.filter((car) => Number.isInteger(car.year) && car.supercar),
  eurocardle: cars.filter((car) => Number.isInteger(car.year) && car.region === "europe"),
  spotter: cars
};
for (let offset = 0; offset < 366; offset += 1) {
  const date = new Date(`${start}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset);
  const day = date.toISOString().slice(0, 10);
  output[day] ||= {};
  for (const [variant, pool] of Object.entries(pools)) {
    if (!pool.length) throw new Error(`Empty daily pool: ${variant}`);
    if (day === start && output[day][variant] && pool.some((car) => car.id === output[day][variant])) continue;
    output[day][variant] = pool[hash(variant === "spotter" ? day : `${variant}:${day}`, variant === "spotter" ? 0 : 7) % pool.length].id;
  }
}
await writeFile(resolve(root, "daily-cars.json"), JSON.stringify(output));
console.log(`Pinned ${Object.keys(output).length} UTC daily assignments across four photo modes; preserved today's published assignments.`);
