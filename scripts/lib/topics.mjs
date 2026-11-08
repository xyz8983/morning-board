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

export async function generateTopics(candidates, { count = 6 } = {}) {
  const n = Math.min(count, candidates.length);
  const system =
    `You are the editor of a personal morning briefing. From the candidate news stories below, ` +
    `choose the ${n} most important things a well-informed person should know today. ` +
    `Prioritize real-world significance and impact over popularity. ` +
    `Ensure variety across areas (world, politics/national, business, technology, entertainment, sports); ` +
    `avoid near-duplicate stories and do not let any single area dominate ` +
    `(at most one sports story unless a second is truly major). ` +
    `For each chosen story, write ONE concise, plain-language sentence (≤20 words) that rewrites the ` +
    `headline and description into what happened and why it matters. ` +
    `Do NOT use hype words like "buzzing", "trending", "viral", or "everyone's talking about". ` +
    `Provide 1-2 short keyword chips (each ≤3 words); the first chip must be the story's category. ` +
    `Return JSON only.`;
  const list = candidates
    .map((c, i) => {
      const desc = c.description ? ` — ${c.description}` : "";
      return `${i + 1}. [${c.category}] ${c.title}${desc}`;
    })
    .join("\n");
  const user =
    `Candidate stories:\n${list}\n\n` +
    `Select the ${n} most important and diverse, ordered most important first.\n` +
    `Return JSON of shape:\n` +
    `{ "topics": [ { "keywords": ["Category", "Tag"], "summary": "One sentence." } ] }`;

  const raw = await callAI({ system, user, temperature: 0.4, jsonSchema: TOPICS_SCHEMA });
  return parseAIJson(raw);
}
