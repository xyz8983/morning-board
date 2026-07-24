// Summarizes trending topics + news entries into short keyword+summary bullets via an AI provider.
import { callAI, parseAIJson } from "./ai-client.mjs";

export const TOPICS_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keywords: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["keywords", "summary"],
      },
    },
  },
  required: ["topics"],
};

export async function generateTopics(entries) {
  const system =
    `You summarize input entries into short topic bullets for a personal morning display board. ` +
    `Produce exactly one topic per input entry, in the same order. ` +
    `Each topic: 1-2 short keyword chips (each ≤3 words) and one scannable summary sentence (≤20 words). ` +
    `For entries labeled "Trend", frame as "why it's buzzing"; for "News-US", keep a factual, headline tone. ` +
    `Skip pure celebrity gossip / reality TV framing. Return JSON only.`;
  const list = entries
    .map((e, i) => `${i + 1}. [${e.label}] ${e.text}`)
    .join("\n");
  const user =
    `Entries (produce exactly ${entries.length} topics, one per entry, same order):\n${list}\n\n` +
    `Return JSON of shape:\n` +
    `{ "topics": [ { "keywords": ["Tag 1", "Tag 2"], "summary": "One sentence." } ] }`;

  const raw = await callAI({ system, user, temperature: 0.4, jsonSchema: TOPICS_SCHEMA });
  return parseAIJson(raw);
}
