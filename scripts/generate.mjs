#!/usr/bin/env node
/**
 * Generate data.json for the morning board.
 *
 * Pulls:
 *   - Weather      Open-Meteo         (no API key)
 *   - Markets      Yahoo Finance      (no API key)
 *   - Trending     Google Trends RSS  (no API key)
 *   - Topic summaries + bilingual joke via an AI provider.
 *
 * AI provider is selected with the AI_PROVIDER env var:
 *   "gemini"    (default) → Google Gemini (free tier friendly)
 *   "anthropic"           → Anthropic Claude
 *
 * Env vars:
 *   AI_PROVIDER          "gemini" | "anthropic"                (default: "gemini")
 *   GEMINI_API_KEY       required when AI_PROVIDER=gemini
 *   ANTHROPIC_API_KEY    required when AI_PROVIDER=anthropic
 *   GEMINI_MODEL         default "gemini-2.5-flash"
 *   ANTHROPIC_MODEL      default "claude-haiku-4-5-20251001"
 *   LATITUDE / LONGITUDE default 40.7128 / -74.0060 (New York City)
 *   LOCATION_NAME        default "New York City"
 *   TIMEZONE             default "America/New_York"
 *   TRENDS_GEO           default "US"
 */

import fs from "node:fs/promises";
import path from "node:path";

/* ---------------- config ---------------- */

const AI_PROVIDER   = process.env.AI_PROVIDER   || "gemini";
const LAT           = parseFloat(process.env.LATITUDE  || "40.7128");
const LON           = parseFloat(process.env.LONGITUDE || "-74.0060");
const LOCATION_NAME = process.env.LOCATION_NAME || "New York City";
const TIMEZONE      = process.env.TIMEZONE      || "America/New_York";
const TRENDS_GEO    = process.env.TRENDS_GEO    || "US";

const INDICES = [
  { region: "US",     name: "S&P 500",       symbol: "^GSPC" },
  { region: "US",     name: "Nasdaq",        symbol: "^IXIC" },
  { region: "Europe", name: "Euro Stoxx 50", symbol: "^STOXX50E" },
  { region: "Europe", name: "FTSE 100",      symbol: "^FTSE" },
  { region: "Asia",   name: "SSE Composite", symbol: "000001.SS" },
  { region: "Asia",   name: "CSI 300",       symbol: "000300.SS" },
  { region: "Asia",   name: "Hang Seng",     symbol: "^HSI" },
];

// Random seed injected into the joke prompt so we get variety without any state.
const JOKE_THEMES = [
  "animals", "food", "wordplay", "workplace", "family", "weather",
  "space", "cooking", "sports", "philosophy", "tech", "谐音梗",
  "school", "books", "music", "travel",
];

// Open-Meteo WMO weather codes → short display strings.
const WEATHER_CONDITIONS = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Severe thunderstorm",
};

/* ---------------- weather ---------------- */

async function fetchWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", LAT);
  url.searchParams.set("longitude", LON);
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
  url.searchParams.set("timezone", TIMEZONE);
  url.searchParams.set("forecast_days", "1");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();
  const code = data.daily.weather_code?.[0] ?? data.current.weather_code;

  return {
    location: LOCATION_NAME,
    tempC: data.current.temperature_2m,
    condition: WEATHER_CONDITIONS[code] || "Unknown",
    code,
    highC: data.daily.temperature_2m_max[0],
    lowC: data.daily.temperature_2m_min[0],
    rainChance: data.daily.precipitation_probability_max[0] ?? 0,
  };
}

/* ---------------- markets ---------------- */

async function fetchIndex(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { headers: { "user-agent": "morning-board/1.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance ${symbol}: HTTP ${res.status}`);
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`Yahoo Finance ${symbol}: malformed response`);
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  return {
    price,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
  };
}

async function fetchMarkets() {
  const results = await Promise.allSettled(
    INDICES.map(async (idx) => {
      const { price, changePct } = await fetchIndex(idx.symbol);
      return { ...idx, price, changePct };
    }),
  );
  return {
    indices: results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value),
  };
}

/* ---------------- trending topics ---------------- */

async function fetchTrends() {
  // Google Trends daily-trending RSS feed.
  const url = `https://trends.google.com/trending/rss?geo=${TRENDS_GEO}`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (morning-board)" },
  });
  if (!res.ok) throw new Error(`Google Trends HTTP ${res.status}`);
  const xml = await res.text();

  // Lightweight XML: extract each <item>'s <title>. RSS wraps titles in CDATA.
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const titleRe = /<title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 15) {
    const t = titleRe.exec(m[1]);
    if (t && t[1]) items.push(t[1].trim());
  }
  return items;
}

/* ---------------- AI providers ---------------- */

async function callAI({ system, user, temperature = 0.7, jsonSchema }) {
  if (AI_PROVIDER === "gemini")    return callGemini({ system, user, temperature, jsonSchema });
  if (AI_PROVIDER === "anthropic") return callAnthropic({ system, user, temperature });
  throw new Error(`Unknown AI_PROVIDER "${AI_PROVIDER}" (expected "gemini" or "anthropic")`);
}

async function callGemini({ system, user, temperature, jsonSchema }) {
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

async function callAnthropic({ system, user, temperature }) {
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

function parseAIJson(raw) {
  // Anthropic may wrap JSON in ```json fences; Gemini's JSON mode returns bare JSON.
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(trimmed);
}

/* ---------------- AI-generated content ---------------- */

const TOPICS_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keywords: { type: "array", items: { type: "string" } },
          summary:  { type: "string" },
        },
        required: ["keywords", "summary"],
      },
    },
  },
  required: ["topics"],
};

async function generateTopics(trendingTitles) {
  const system =
    `You summarize today's news for a personal morning display board. Given a list of trending searches, pick 4-5 globally relevant, substantive topics (skip pure celebrity gossip and reality TV). For each, give 1-2 short keyword chips (each ≤3 words) and a single scannable sentence summary (≤20 words). Return JSON only.`;
  const user =
    `Trending searches:\n${trendingTitles.map((t) => `- ${t}`).join("\n")}\n\n` +
    `Return JSON of shape:\n` +
    `{ "topics": [ { "keywords": ["Tag 1", "Tag 2"], "summary": "One sentence." } ] }`;

  const raw = await callAI({ system, user, temperature: 0.4, jsonSchema: TOPICS_SCHEMA });
  return parseAIJson(raw);
}

const JOKE_SCHEMA = {
  type: "object",
  properties: {
    en: {
      type: "object",
      properties: {
        joke:        { type: "string" },
        explanation: { type: "string" },
      },
      required: ["joke", "explanation"],
    },
    zh: {
      type: "object",
      properties: { joke: { type: "string" } },
      required: ["joke"],
    },
  },
  required: ["en", "zh"],
};

const ZH_JOKE_FORMS = ["谐音梗", "冷笑话", "段子", "一句话笑话"];

async function generateJoke() {
  const theme = JOKE_THEMES[Math.floor(Math.random() * JOKE_THEMES.length)];
  const zhForm = ZH_JOKE_FORMS[Math.floor(Math.random() * ZH_JOKE_FORMS.length)];
  const system =
    `You write fresh, family-friendly bilingual jokes for a morning display board. Return JSON only.`;
  const user =
    `Write two short original jokes. Theme seed: "${theme}".\n\n` +
    `- English: a one-liner, preferably wordplay. Include a brief "why it's funny" note (under 20 words).\n` +
    `- Chinese (中文): write a native ${zhForm}. Must be originally conceived in Chinese — ` +
    `do NOT translate an English joke, and do NOT force a pun that doesn't land naturally in Mandarin. ` +
    `If you can't produce a genuinely funny ${zhForm} on this theme, pick a different angle within the theme rather than settling for a forced one. No explanation needed.\n\n` +
    `Return JSON of shape:\n` +
    `{ "en": { "joke": "...", "explanation": "..." }, "zh": { "joke": "..." } }`;

  const raw = await callAI({ system, user, temperature: 0.95, jsonSchema: JOKE_SCHEMA });
  return parseAIJson(raw);
}

/* ---------------- main ---------------- */

async function main() {
  console.log(`[morning-board] provider=${AI_PROVIDER} location=${LOCATION_NAME}`);

  const [weather, market, trends] = await Promise.all([
    fetchWeather().catch((err) => { console.error("weather failed:", err.message); return null; }),
    fetchMarkets().catch((err) => { console.error("markets failed:", err.message); return null; }),
    fetchTrends().catch((err)  => { console.error("trends failed:",  err.message); return []; }),
  ]);

  let hotTopics = null;
  if (trends.length) {
    try {
      const { topics } = await generateTopics(trends);
      hotTopics = { headline: "Today's buzz", topics };
    } catch (err) {
      console.error("topics AI failed:", err.message);
    }
  }

  let joke = null;
  try {
    joke = await generateJoke();
  } catch (err) {
    console.error("joke AI failed:", err.message);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    ...(weather   && { weather }),
    ...(hotTopics && { hotTopics }),
    ...(market    && { market }),
    ...(joke      && { joke }),
  };

  const outPath = path.resolve(process.cwd(), "data.json");
  await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`[morning-board] wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
