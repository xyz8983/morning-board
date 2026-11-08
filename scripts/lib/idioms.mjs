// Picks one random idiom from the pre-parsed dataset (resources/idioms.json).
// No AI / network — the dataset is generated once by scripts/lib/parse-idioms.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "..", "..", "resources", "idioms.json");

let cache = null;
function load() {
  if (!cache) cache = JSON.parse(fs.readFileSync(DATA, "utf8"));
  return cache;
}

export function pickIdiom() {
  const all = load();
  if (!all.length) return null;
  const x = all[Math.floor(Math.random() * all.length)];
  return {
    id: x.id,
    title: x.title,
    glossZh: x.glossZh || "",
    interpretationEn: x.interpretationEn || "",
    interpretationZh: x.interpretationZh || x.glossZh || "",
    examples: (x.examples || []).slice(0, 3),
  };
}
