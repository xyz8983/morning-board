// Turns each person's raw Wikipedia extract into up to 3 short highlight bullets
// (notable works/achievements, or a one-line reason they're famous), grounded
// strictly in the provided text so nothing gets invented.
import { callAI, parseAIJson } from "./ai-client.mjs";

const HIGHLIGHTS_SCHEMA = {
  type: "object",
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          highlights: { type: "array", items: { type: "string" } },
        },
        required: ["highlights"],
      },
    },
  },
  required: ["people"],
};

export async function generatePeopleHighlights(people) {
  const system =
    `You extract short, factual highlight bullets about real notable people for a morning display board, ` +
    `based ONLY on the biography text provided for each person. Never invent facts not present in the text. ` +
    `Return JSON only.`;
  const list = people
    .map((p, i) => `${i + 1}. ${p.name}: ${p.extract}`)
    .join("\n");
  const user =
    `For each person below, produce up to 3 short highlight bullets (each ≤10 words): ` +
    `prefer specific notable works/roles/achievements mentioned in the text; if the text doesn't name distinct works, ` +
    `use 1-2 bullets describing why they're famous instead. Same order as input, one entry per person, exactly ${people.length} entries.\n\n` +
    `${list}\n\n` +
    `Return JSON of shape:\n` +
    `{ "people": [ { "highlights": ["...", "...", "..."] } ] }`;

  const raw = await callAI({ system, user, temperature: 0.2, jsonSchema: HIGHLIGHTS_SCHEMA });
  const { people: results } = parseAIJson(raw);
  return people.map((p, i) => ({ ...p, highlights: results[i]?.highlights || [] }));
}
