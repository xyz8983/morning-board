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

**Phase A (now): UI with dummy data**
- Create `index.html`, `style.css`, `app.js`, and a hand-written `data.json` with sample
  values for every card.
- Iterate on layout, colors, typography, rotation, and the market live/closed logic.
- Verify locally in a browser at iPad landscape dimensions.

**Phase B (later): real data**
- Add `scripts/generate.mjs` + the GitHub Action to produce the real `data.json`.
- Nothing in the frontend changes.

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
│   └── generate.mjs     # Node script: fetch data + call Claude → write data.json
└── .github/workflows/
    └── briefing.yml     # cron @ 9am local (set via UTC), runs generate.mjs, commits data.json
```

## Data generation (`scripts/generate.mjs`)

Runs in the Action. Produces `data.json` with one object per card. Steps:

1. **Weather** — Open-Meteo (free, no key). Fetch current conditions + daily high/low +
   precipitation probability for the user's coordinates.
   `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max`

2. **Hot topics** — Fetch Google Trends Daily RSS
   (`https://trends.google.com/trends/trendingsearches/daily/rss?geo=US`). Parse the
   trending terms + their related news headlines, then send them to Claude with a prompt
   like *"Here are today's trending searches and related headlines. Write a short 'what's
   happening today' briefing of the top ~5 things worth knowing."* Store the summary text.

3. **Market** — Yahoo Finance (unofficial, no key), one representative index per region:
   - US: `^GSPC` (S&P 500)
   - Europe: `^STOXX50E` (Euro Stoxx 50)
   - Asia: `^N225` (Nikkei 225)

   `https://query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>` → extract current price
   and previous close → compute % change. Store price, %change, and the symbol. (The
   live/closed label is computed client-side, see below.)

4. **Joke** — Claude call. Randomly pick English or Chinese and inject a **random theme
   seed** (e.g. animals/food/tech/space/谐音梗) with **temperature ~0.9** for variety —
   no history stored, occasional repeats acceptable.
   - Chinese → return joke only.
   - English → return joke **plus a short "why it's funny"** explanation (unpacking the
     pun/wordplay), since the user may not catch English humor.
   Store `{ lang, joke, explanation? }`.

5. *(Optional, same stateless pattern)* **Challenge** (daily brain teaser) and
   **Compliment** — Claude-generated with a random seed + high temperature.

6. Write all cards + a `generatedAt` timestamp to `data.json`.

**Claude API**: use the Anthropic SDK with **prompt caching** on the stable system prompt.
Default to a fast, cheap model (Haiku) for these short generations. Key read from
`process.env.ANTHROPIC_API_KEY` (the Actions secret).

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

- `on: schedule: cron` set to 9am local time expressed in UTC (note: shifts 1h across
  daylight saving — acceptable, or add a second cron line to cover both). Also
  `workflow_dispatch` for manual runs.
- Steps: checkout → setup Node → `npm ci` → `node scripts/generate.mjs` →
  commit & push `data.json` if changed.
- `ANTHROPIC_API_KEY` provided via `secrets`.

## Setup / deploy (one-time, done by the user)

1. Create a **public** GitHub repo, push the code.
2. Add repo secret `ANTHROPIC_API_KEY`.
3. Enable **GitHub Pages** (serve from the default branch root or `/docs`).
4. Open the Pages URL on the iPad; enable Guided Access to keep it always-on.

## Files to create

- `index.html`, `app.js`, `style.css` — the board
- `scripts/generate.mjs` — data + Claude generation
- `.github/workflows/briefing.yml` — daily cron
- `package.json` — deps (`@anthropic-ai/sdk`, an RSS/XML parser)
- `data.json` — initial placeholder (real one generated by the Action)

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
