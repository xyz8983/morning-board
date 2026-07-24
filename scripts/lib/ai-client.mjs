const AI_PROVIDER = process.env.AI_PROVIDER || "gemini";

export async function callAI({ system, user, temperature = 0.7, jsonSchema }) {
  if (AI_PROVIDER === "gemini") return callGemini({ system, user, temperature, jsonSchema });
  if (AI_PROVIDER === "anthropic") return callAnthropic({ system, user, temperature });
  throw new Error(`Unknown AI_PROVIDER "${AI_PROVIDER}" (expected "gemini" or "anthropic")`);
}

export async function callGemini({ system, user, temperature, jsonSchema }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const generationConfig = { temperature, responseMimeType: "application/json" };
  if (jsonSchema) generationConfig.responseSchema = jsonSchema;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export async function callAnthropic({ system, user, temperature }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

export function parseAIJson(raw) {
  // Anthropic may wrap JSON in ```json fences; Gemini's JSON mode returns bare JSON.
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(trimmed);
}
