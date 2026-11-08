#!/usr/bin/env node
/**
 * Generate data.json for the morning board.
 *
 * Pulls:
 *   - Weather      Open-Meteo         (no API key)         → lib/weather.mjs
 *   - Markets      Yahoo Finance      (no API key)         → lib/markets.mjs
 *   - News         Google News RSS by category (no API key) → lib/trends.mjs
 *   - Headlines    NewsAPI            (optional; NEWSAPI_KEY) → lib/trends.mjs
 *   - Famous people Wikipedia "on this day" (no API key)    → lib/famousPeople.mjs
 *   - Jokes        Reddit r/Jokes + JokeAPI safe-mode (no API key) → lib/joke.mjs
 *   - Topic summaries via an AI provider.                   → lib/topics.mjs, lib/ai-client.mjs
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
 *   NEWSAPI_KEY          optional; adds NewsAPI top-headlines to the candidate pool
 */

import fs from "node:fs/promises";
import path from "node:path";

import { fetchWeather } from "./lib/weather.mjs";
import { fetchMarkets } from "./lib/markets.mjs";
import { fetchCategoryNews, fetchNews } from "./lib/trends.mjs";
import { fetchFamousPeople } from "./lib/famousPeople.mjs";
import { generatePeopleHighlights } from "./lib/peopleBio.mjs";
import { generateTopics } from "./lib/topics.mjs";
import { fetchJokes } from "./lib/joke.mjs";
import { pickIdiom } from "./lib/idioms.mjs";

/* ---------------- config ---------------- */

const AI_PROVIDER = process.env.AI_PROVIDER || "gemini";
const LAT = parseFloat(process.env.LATITUDE || "40.7128");
const LON = parseFloat(process.env.LONGITUDE || "-74.0060");
const LOCATION_NAME = process.env.LOCATION_NAME || "New York City";
const TIMEZONE = process.env.TIMEZONE || "America/New_York";

/* ---------------- main ---------------- */

async function main() {
  console.log(`[morning-board] provider=${AI_PROVIDER} location=${LOCATION_NAME}`);

  const [weather, market, categoryNews, newsUS, famousPeople] = await Promise.all([
    fetchWeather({ lat: LAT, lon: LON, locationName: LOCATION_NAME, timezone: TIMEZONE })
      .catch((err) => { console.error("weather failed:", err.message); return null; }),
    fetchMarkets().catch((err) => { console.error("markets failed:", err.message); return null; }),
    fetchCategoryNews(2).catch((err) => { console.error("category news failed:", err.message); return []; }),
    fetchNews("us", 2).catch((err) => { console.error("news US failed:", err.message); return []; }),
    fetchFamousPeople(3).catch((err) => { console.error("famous people failed:", err.message); return []; }),
  ]);

  // Build the candidate pool: categorized Google News + optional NewsAPI headlines.
  const candidates = [
    ...categoryNews,
    ...newsUS.map((a) => ({ category: "US/Politics", title: a.title, description: a.description, source: "", pubDate: "" })),
  ];
  // De-duplicate by normalized title across both sources.
  const seen = new Set();
  const pool = candidates.filter((c) => {
    const key = (c.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`[morning-board] hot-topics candidates: categoryNews=${categoryNews.length} newsUS=${newsUS.length} → ${pool.length} unique`);

  let hotTopics = null;
  if (pool.length) {
    try {
      const { topics } = await generateTopics(pool, { count: 6 });
      hotTopics = { headline: "Today's news", topics };
    } catch (err) {
      console.error("topics AI failed:", err.message);
    }
  }

  let joke = null;
  try {
    const fetched = await fetchJokes();
    if (fetched.items.length) joke = fetched;
  } catch (err) {
    console.error("jokes failed:", err.message);
  }

  let idiom = null;
  try {
    idiom = pickIdiom();
  } catch (err) {
    console.error("idiom pick failed:", err.message);
  }

  let famousPeopleWithHighlights = famousPeople;
  if (famousPeople.length) {
    try {
      famousPeopleWithHighlights = await generatePeopleHighlights(famousPeople);
    } catch (err) {
      console.error("people highlights AI failed:", err.message);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    ...(weather && { weather }),
    ...(hotTopics && { hotTopics }),
    ...(market && { market }),
    ...(joke && { joke }),
    ...(idiom && { idiom }),
    ...(famousPeople.length && { famousPeople: { headline: "Born today", people: famousPeopleWithHighlights } }),
  };

  const outPath = path.resolve(process.cwd(), "data.json");
  await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`[morning-board] wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
