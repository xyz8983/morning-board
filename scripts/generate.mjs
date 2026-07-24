#!/usr/bin/env node
/**
 * Generate data.json for the morning board.
 *
 * Pulls:
 *   - Weather      Open-Meteo         (no API key)         → lib/weather.mjs
 *   - Markets      Yahoo Finance      (no API key)         → lib/markets.mjs
 *   - Trending     Google Trends RSS  (no API key)         → lib/trends.mjs
 *   - Headlines    NewsAPI            (optional; NEWSAPI_KEY) → lib/trends.mjs
 *   - Famous people Wikipedia "on this day" (no API key)    → lib/famousPeople.mjs
 *   - Topic summaries + bilingual joke via an AI provider.  → lib/topics.mjs, lib/joke.mjs, lib/ai-client.mjs
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
 *   NEWSAPI_KEY          optional; enables NewsAPI top-headlines for US + CN
 */

import fs from "node:fs/promises";
import path from "node:path";

import { fetchWeather } from "./lib/weather.mjs";
import { fetchMarkets } from "./lib/markets.mjs";
import { fetchTrends, fetchNews } from "./lib/trends.mjs";
import { fetchFamousPeople } from "./lib/famousPeople.mjs";
import { generatePeopleHighlights } from "./lib/peopleBio.mjs";
import { generateTopics } from "./lib/topics.mjs";
import { generateJoke } from "./lib/joke.mjs";

/* ---------------- config ---------------- */

const AI_PROVIDER = process.env.AI_PROVIDER || "gemini";
const LAT = parseFloat(process.env.LATITUDE || "40.7128");
const LON = parseFloat(process.env.LONGITUDE || "-74.0060");
const LOCATION_NAME = process.env.LOCATION_NAME || "New York City";
const TIMEZONE = process.env.TIMEZONE || "America/New_York";
const TRENDS_GEO = process.env.TRENDS_GEO || "US";

/* ---------------- main ---------------- */

async function main() {
  console.log(`[morning-board] provider=${AI_PROVIDER} location=${LOCATION_NAME}`);

  const [weather, market, trends, newsUS, famousPeople] = await Promise.all([
    fetchWeather({ lat: LAT, lon: LON, locationName: LOCATION_NAME, timezone: TIMEZONE })
      .catch((err) => { console.error("weather failed:", err.message); return null; }),
    fetchMarkets().catch((err) => { console.error("markets failed:", err.message); return null; }),
    fetchTrends(TRENDS_GEO).catch((err) => { console.error("trends failed:", err.message); return []; }),
    fetchNews("us", 2).catch((err) => { console.error("news US failed:", err.message); return []; }),
    fetchFamousPeople(3).catch((err) => { console.error("famous people failed:", err.message); return []; }),
  ]);

  const entries = [
    ...trends.slice(0, 4).map((t) => ({ label: "Trend", text: t })),
    ...newsUS.map((a) => ({ label: "News-US", text: `"${a.title}" — ${a.description}` })),
  ];
  console.log(`[morning-board] hot-topics sources: trends=${Math.min(trends.length, 2)} newsUS=${newsUS.length} → ${entries.length} entries`);

  let hotTopics = null;
  if (entries.length) {
    try {
      const { topics } = await generateTopics(entries);
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
