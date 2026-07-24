# Personal Morning Briefing Board — Plan

## Context

Build a personal, always-on "morning briefing" board to display on an old iPad in
Safari (kept awake via Guided Access). The board cycles through a set of cards every
20 seconds, showing information the user cares about each morning: weather, today's hot
topics (AI-summarized), how world markets are doing, and a bilingual joke — with room
for optional challenge/compliment cards.

The guiding principle throughout is **maximum simplicity**: no always-on server, no
database, fully stateless. Data is generated **once per day at 9am** by a scheduled job
and served as a static file. The user may later increase frequency, but never beyond
5×/day, so a lightweight cron approach is ideal.

## Architecture

**GitHub Actions (daily 9am cron) → generates `data.json` → GitHub Pages hosts the static board → iPad loads the Pages URL.**

- A scheduled GitHub Action runs a Node script that fetches all live data, calls the
  Claude API for summaries/joke, and writes a single `data.json`.
- The script commits `data.json` to the repo; GitHub Pages serves both the static
  frontend and `data.json`.
- The iPad loads the Pages URL. The page fetches `data.json` **same-origin** (no CORS
  issue) and renders + auto-rotates the cards client-side.
- **No secrets in code**: the Claude API key lives as an encrypted GitHub Actions secret,
  only present at runtime inside the Action. Public repo is safe because nothing sensitive
  is committed (`data.json` holds only weather, public news summaries, market numbers, a joke).
- `data.json` **is** the state — regenerated each run. No database, nothing persisted.

Why this fits: free (public repo = unlimited Actions minutes + free Pages), stateless,
zero server maintenance, and bumping to ≤5×/day is a one-line cron edit later.

## Build sequence — UI first

Design and iterate on the **frontend UI using hardcoded dummy data first**, before
wiring up any real data generation. The board is static HTML/CSS/JS, so we build a
`data.json` full of realistic sample values and refine the visuals freely, then later
swap in the real `generate.mjs` output — the frontend contract (`data.json` shape) stays
identical, so no frontend rework is needed.

**Phase A — UI with dummy data (done):**
- `index.html`, `style.css`, `app.js`, and a hand-written `data.json` with sample values
  for every card.
- Iterated on layout, colors, typography, rotation, and the market live/closed logic.
- Style landed on a muted Song-dynasty palette (月白 / 藕荷 / 秋香 / 缃色) with
  translucent rice-paper tiles and hand-drawn "uncommon" ink creatures (swallow,
  squirrel, hedgehog, bat) plus a cinnabar 印章 seal accent.

**Phase B — real data (done):**
- `scripts/generate.mjs` fetches everything and writes `data.json`.
- `package.json` — Node ≥20, no runtime deps (native `fetch` only).
- `.github/workflows/briefing.yml` — daily cron.
- Frontend was not touched.

## UI design decisions

- **Aesthetic**: bright & cheerful — light background, warm/friendly colors, playful but
  legible. Large type suited to glancing from across a room.
- **Orientation**: landscape (horizontal). Design at typical iPad landscape dimensions
  (e.g. 1024×768 baseline; ensure it scales to larger old-iPad resolutions).
- **Layout**: one full-screen card at a time, auto-rotating every 20s with a smooth fade.
- **Card visuals**:
  - Weather: big temperature + condition icon, high/low, rain chance.
  - Hot topics: headline "Today's buzz" + the AI briefing paragraph, readable line length.
  - Market: the three regional indices, each with % change, up/down color + arrow, and a
    live/closed badge (computed client-side).
  - Joke: the joke large and centered; for English, the "why it's funny" note below in a
    lighter style.
  - Greeting/date anchor card: "Good morning" + weekday/date.

## Repository structure

Project root: `/Users/yuhang.zheng/Workspace/playground/morning-board`
(git already initialized; `.gitignore` covers `node_modules/`, `.env`, `.DS_Store`).

```
/
├── index.html          # the board (static)
├── app.js              # fetch data.json, render cards, 20s rotation
├── style.css           # full-screen dark dashboard styling
├── data.json           # generated output (committed by the Action)
├── scripts/
│   └── generate.mjs     # Node script: fetch data + call AI (Gemini/Anthropic) → write data.json
└── .github/workflows/
    └── briefing.yml     # daily cron (13:00 UTC), runs generate.mjs, commits data.json
```

## Data generation (`scripts/generate.mjs`)

Runs in the Action. Produces `data.json` with one object per card.
Non-AI fetches use `Promise.allSettled` so any one failing source doesn't kill the run.
Steps:

1. **Weather** — Open-Meteo (free, no key). Fetches current conditions + daily high/low +
   precipitation probability for the user's coordinates. Result:
   `{ location, tempC, condition, code, highC, lowC, rainChance }`.
   WMO `weather_code` is mapped to a short condition string; `code` is preserved so the
   frontend can pick the right icon.

2. **Hot topics** — Mixed sourcing produces up to **4 topics** per run:
   - **2 from Google Trends US** — top 2 titles from the daily-trending RSS
     (`https://trends.google.com/trending/rss?geo=US`), parsed with a minimal regex.
   - **2 from NewsAPI US top-headlines** — `GET /v2/top-headlines?country=us&pageSize=2`
     (default general category). Requires `NEWSAPI_KEY`; silently skipped if unset.

   (China coverage was dropped: NewsAPI's `country=cn` and `country=hk` return zero
   articles in practice, and switching to `/v2/everything?q=China` was deemed too
   noisy for the amount of value added.)

   Both sources are fetched in parallel via `Promise.allSettled`; any that fail
   contribute 0 items. The union is passed to the AI as a labeled `{ label, text }[]`
   list (labels internal only) and the AI produces **one topic per input entry, in the
   same order** — matches the frontend shape `hotTopics.topics[]`. Temperature 0.4.

3. **Market** — Yahoo Finance (unofficial, no key), two representative indices per region:
   - US: `^GSPC` (S&P 500), `^IXIC` (Nasdaq)
   - Europe: `^STOXX50E` (Euro Stoxx 50), `^FTSE` (FTSE 100)
   - Asia: `000001.SS` (SSE Composite), `000300.SS` (CSI 300), `^HSI` (Hang Seng)

   `https://query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>` → extract
   `regularMarketPrice` and `chartPreviousClose` → compute %change. Store price,
   %change, region, name, and symbol. The live/closed label is computed client-side.

4. **Joke** — a single AI call. Injects a **random theme seed** from a rotating list
   (`animals / food / wordplay / 谐音梗 / …`) at **temperature 0.95** for variety —
   no history stored, occasional repeats acceptable. Returns
   `{ en: { joke, explanation }, zh: { joke } }` matching the frontend shape:
   - English joke → include a short "why it's funny" line (under 20 words).
   - Chinese joke (中文) → joke only, no explanation.

5. Writes all sections + a `generatedAt` ISO timestamp to `data.json`. Any section that
   failed to fetch is simply omitted — the frontend already guards each card with a
   truthiness check.

### AI provider switch (Gemini or Anthropic)

The script supports two providers behind a single `callAI(...)` interface, selected at
run time by `AI_PROVIDER`:

- **`gemini`** (default) — Google Gemini via the REST endpoint
  (`generativelanguage.googleapis.com`). Uses `responseMimeType: "application/json"` +
  a `responseSchema` so structured output is enforced by the API. Free tier friendly
  (chosen for the GitHub Action). Requires `GEMINI_API_KEY`.
  Default model: `gemini-2.5-flash` (overridable via `GEMINI_MODEL`).
- **`anthropic`** — Claude via `api.anthropic.com/v1/messages`. Asks for JSON in the
  prompt (no native schema mode). Requires `ANTHROPIC_API_KEY`.
  Default model: `claude-haiku-4-5-20251001` (overridable via `ANTHROPIC_MODEL`).

Both providers are called with raw `fetch` (no SDK dep). Because the whole pipeline
runs once per day with ~2 total AI calls, prompt caching isn't worthwhile (the 5-minute
cache TTL doesn't span daily runs).

### Location & other env-var overrides

`LATITUDE`, `LONGITUDE`, `LOCATION_NAME`, `TIMEZONE`, `TRENDS_GEO` — all default to
New York City / `America/New_York` / `US`, matching the current `data.json`.

`NEWSAPI_KEY` — optional. Enables the NewsAPI top-headlines pull for the "Today's buzz"
card (US + CN). If unset, the card falls back to Google Trends only.

## Frontend (`index.html` / `app.js` / `style.css`)

- Single static page, **no framework, no build step**.
- On load, `fetch('data.json')`, then render each card into a full-screen container.
- **Auto-rotate every 20 seconds**, looping through cards continuously all day (data is a
  9am snapshot, but the display always feels alive). Smooth fade between cards.
- **Market card live/closed label** computed client-side from the current time vs. known
  exchange hours per region (NYSE, Frankfurt, Tokyo) — so it's always correct regardless of
  when data was generated. Green up / red down arrow on % change.
- Card designs: large, legible, dark theme suited to an always-on display. Include a
  greeting/date anchor (e.g. "Good morning — Sat, Jul 4").
- Poll `data.json` periodically (e.g. every 30 min) so the board picks up the new 9am data
  without a manual reload.

## Workflow (`.github/workflows/briefing.yml`)

- **Two scheduled runs per day**:
  - `cron: "0 13 * * *"` — 13:00 UTC ≈ 9am ET (EDT) / 8am ET (EST) — morning briefing.
  - `cron: "0 19 * * *"` — 19:00 UTC ≈ 3pm ET (EDT) / 2pm ET (EST) — afternoon briefing.

  Both runs execute the same job — no mode branching. Weather / market / joke /
  hotTopics all regenerate on each run so the board stays current through the day. The
  1-hour DST drift is acceptable; both runs still land in their intended time window.
  Also `workflow_dispatch` for manual runs.
- `permissions: contents: write` so the workflow can commit back to the repo.
- Steps: checkout → setup Node 20 → `node scripts/generate.mjs` → `git commit && push`
  only if `data.json` actually changed.
- Env: `AI_PROVIDER: gemini` + `GEMINI_API_KEY` from repo secrets; `NEWSAPI_KEY` also
  from repo secrets (optional — script degrades gracefully if unset). Anthropic wiring
  is present but commented — swap the two lines and the secret name to switch providers.
- No `npm ci` step: the script has no runtime deps.

## Setup / deploy (one-time, done by the user)

1. Create a **public** GitHub repo, push the code.
2. Add repo secret **`GEMINI_API_KEY`** (grab a free key at
   https://aistudio.google.com/apikey). If you'd rather use Claude, add
   `ANTHROPIC_API_KEY` instead and flip the two lines in `briefing.yml`.
3. Add repo secret **`NEWSAPI_KEY`** (free key at https://newsapi.org/register — 100
   req/day tier, usage will be ~2/day = 1 call × 2 runs). Optional; without it the
   "Today's buzz" card falls back to Google Trends only (2 topics per run).
4. Enable **GitHub Pages** (serve from the default branch root).
5. Trigger the workflow manually once via **Actions → Daily morning briefing → Run
   workflow**, then let the cron take over.
6. Open the Pages URL on the iPad; enable Guided Access to keep it always-on.

## Files

- `index.html`, `app.js`, `style.css` — the board (Phase A)
- `data.json` — regenerated each run; the frontend/backend contract
- `scripts/generate.mjs` — the fetch + AI pipeline (Phase B)
- `.github/workflows/briefing.yml` — daily cron
- `package.json` — declares Node 20+, no runtime deps

## Verification

- **Local**: run `node scripts/generate.mjs` with `ANTHROPIC_API_KEY` set → confirm a
  well-formed `data.json` with all card sections populated. Manually verify each data
  source returns sane values (weather temps, trends summary reads coherently, index
  %changes match reality, joke present, English joke has an explanation).
- **Frontend**: serve locally (e.g. `python3 -m http.server`), open in a browser →
  confirm cards render, rotate every 20s, and the market card shows correct live/closed
  labels and up/down colors. Test with a mobile/narrow viewport to match the iPad.
- **End-to-end**: trigger the workflow via `workflow_dispatch`, confirm the Action fetches
  data, calls Claude, and commits an updated `data.json`; confirm the Pages URL reflects it.
- **On the iPad**: load the Pages URL, verify legibility and rotation on the actual device,
  and confirm Guided Access keeps the screen awake.
