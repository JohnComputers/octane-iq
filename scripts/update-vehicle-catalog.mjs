import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const api = "https://vpic.nhtsa.dot.gov/api/vehicles/";
const request = async (path) => {
  const response = await fetch(new URL(path, api), { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
};
const [makes, models] = await Promise.all([
  request("GetMakesForVehicleType/car?format=json"),
  request("GetModelsForMakeId/0?format=json")
]);
const makeIds = new Set(makes.Results.map((make) => make.MakeId));
const map = {};
for (const row of models.Results) {
  if (!makeIds.has(row.Make_ID)) continue;
  const name = row.Make_Name.trim();
  map[name] ||= new Set();
  if (row.Model_Name?.trim()) map[name].add(row.Model_Name.trim());
}
const output = {
  version: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  source: "NHTSA vPIC vehicle listing: makes registered for passenger cars and their model names",
  sourceUrl: "https://vpic.nhtsa.dot.gov/api/",
  coverage: "Manufacturer-reported vPIC records; not an exhaustive catalogue of every historical or worldwide vehicle. Photographed classics supplement this catalogue in the game. Years are entered separately, not inferred from model names.",
  makes: Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, [...values].sort((a, b) => a.localeCompare(b))]))
};
await writeFile(resolve(import.meta.dirname, "../dist/data/vehicle-catalog.json"), JSON.stringify(output));
console.log(`Vehicle catalogue: ${Object.keys(output.makes).length} makes and ${Object.values(output.makes).reduce((total, items) => total + items.length, 0)} make/model pairs.`);
