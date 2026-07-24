/* ===== Morning Board — renderer + rotation ===== */

const ROTATE_MS = 20000;      // 20s per card
const RELOAD_MS = 30 * 60000; // re-fetch data.json every 30 min

const stage = document.getElementById("stage");
const dotsNav = document.getElementById("dots");

let cards = [];       // [{kind, el}]
let current = 0;
let rotateTimer = null;

/* ---------- helpers ---------- */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const cToF = (c) => (c * 9) / 5 + 32;

/* ---------- ink-painting creature SVGs ---------- */
// Style: silhouette-forward ink brush look, warm-ink tones, soft washes.
// Subjects chosen to be uncommon in the classical tradition (no koi / crane /
// tiger / plum / bamboo / lotus).

const CREATURES = {
  // Sun + wispy ink cloud — main weather illustration
  inkSun: `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg">
    <circle cx="82" cy="66" r="42" fill="#c96a52" opacity="0.85"/>
    <circle cx="82" cy="66" r="42" fill="none" stroke="#3f382f" stroke-width="2.5"/>
    <path d="M38 132 Q26 118 46 108 Q54 86 92 96 Q104 74 138 92 Q170 82 190 108 Q214 108 208 134 Q198 150 168 150 L62 150 Q36 150 38 132 Z"
      fill="#ebe2d0" stroke="#3f382f" stroke-width="2.8" stroke-linejoin="round"/>
    <path d="M75 132 Q100 124 130 130 Q160 124 178 132" fill="none" stroke="#3f382f" stroke-width="1.4" opacity="0.45" stroke-linecap="round"/>
    <path d="M55 142 Q80 136 105 142" fill="none" stroke="#3f382f" stroke-width="1.2" opacity="0.35" stroke-linecap="round"/>
  </svg>`,

  // Swallow (燕) — flying, forked tail
  swallow: `<svg viewBox="0 0 190 130" xmlns="http://www.w3.org/2000/svg">
    <path d="M25 66
             Q45 44 84 58
             Q102 42 152 22
             Q128 42 130 62
             Q138 68 162 70
             Q178 80 182 104
             Q154 90 128 84
             Q112 94 92 92
             Q68 94 40 80
             Q28 72 25 66 Z"
      fill="#3f382f"/>
    <path d="M45 70 Q76 64 102 74 Q80 80 55 76 Z" fill="#f6efdc" opacity="0.55"/>
    <circle cx="38" cy="64" r="1.7" fill="#f6efdc"/>
    <path d="M158 30 Q170 42 178 24" fill="none" stroke="#3f382f" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  // Squirrel (松鼠) — sitting, big curled tail, holding a nut
  squirrel: `<svg viewBox="0 0 175 185" xmlns="http://www.w3.org/2000/svg">
    <path d="M95 132 Q142 118 148 66 Q145 22 100 22 Q76 26 82 56"
      fill="none" stroke="#6b5a48" stroke-width="30" stroke-linecap="round"/>
    <path d="M95 132 Q142 118 148 66 Q145 22 100 22 Q76 26 82 56"
      fill="none" stroke="#a89078" stroke-width="14" stroke-linecap="round" opacity="0.5"/>
    <ellipse cx="60" cy="118" rx="34" ry="46" fill="#6b5a48"/>
    <ellipse cx="55" cy="128" rx="18" ry="28" fill="#f0e2c6" opacity="0.55"/>
    <circle cx="46" cy="72" r="26" fill="#6b5a48"/>
    <path d="M30 55 L28 40 L42 52 Z" fill="#6b5a48"/>
    <path d="M62 55 L64 40 L50 52 Z" fill="#6b5a48"/>
    <path d="M32 50 L34 45 L38 50 Z" fill="#a3624a" opacity="0.6"/>
    <path d="M58 50 L60 45 L54 50 Z" fill="#a3624a" opacity="0.6"/>
    <circle cx="39" cy="74" r="2.4" fill="#3f382f"/>
    <path d="M20 82 Q26 84 30 82 Q28 87 24 87 Z" fill="#3f382f"/>
    <ellipse cx="50" cy="152" rx="10" ry="6" fill="#6b5a48"/>
    <ellipse cx="50" cy="142" rx="7" ry="9" fill="#a3624a"/>
    <path d="M44 135 Q50 130 56 135" stroke="#3f382f" stroke-width="1.4" fill="none"/>
  </svg>`,

  // Hedgehog (刺猬) — round with spike strokes, peeking face
  hedgehog: `<svg viewBox="0 0 195 140" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#3f382f" stroke-width="2.5" stroke-linecap="round" fill="none">
      <line x1="55" y1="55" x2="48" y2="30"/>
      <line x1="72" y1="42" x2="70" y2="18"/>
      <line x1="92" y1="38" x2="94" y2="14"/>
      <line x1="112" y1="42" x2="118" y2="18"/>
      <line x1="132" y1="52" x2="142" y2="28"/>
      <line x1="150" y1="65" x2="168" y2="52"/>
      <line x1="162" y1="82" x2="182" y2="80"/>
      <line x1="160" y1="98" x2="178" y2="108"/>
    </g>
    <path d="M50 100 Q45 55 100 55 Q160 55 160 100 Q157 122 100 122 Q52 122 50 100 Z"
      fill="#6b5a48"/>
    <g stroke="#3f382f" stroke-width="1.4" opacity="0.4" fill="none">
      <path d="M60 65 L55 55"/>
      <path d="M75 60 L72 50"/>
      <path d="M90 58 L88 46"/>
      <path d="M110 60 L114 48"/>
      <path d="M128 65 L134 52"/>
      <path d="M144 78 L154 68"/>
    </g>
    <ellipse cx="95" cy="115" rx="45" ry="10" fill="#f0e2c6" opacity="0.35"/>
    <path d="M50 96 Q30 96 22 106 Q22 118 38 120 Q52 120 55 108 Z"
      fill="#e8dcc0" stroke="#3f382f" stroke-width="1.6"/>
    <ellipse cx="23" cy="108" rx="3" ry="2.4" fill="#3f382f"/>
    <circle cx="42" cy="102" r="1.8" fill="#3f382f"/>
    <ellipse cx="72" cy="125" rx="7" ry="3" fill="#3f382f"/>
    <ellipse cx="128" cy="125" rx="7" ry="3" fill="#3f382f"/>
  </svg>`,

  // Bat (蝠 → 福) — cheerful, spread wings
  bat: `<svg viewBox="0 0 210 140" xmlns="http://www.w3.org/2000/svg">
    <path d="M105 70 Q68 30 22 42 Q36 56 28 80 Q46 84 56 74 Q66 86 84 78 Q94 84 105 80 Z"
      fill="#7a5a4a"/>
    <path d="M105 70 Q142 30 188 42 Q174 56 182 80 Q164 84 154 74 Q144 86 126 78 Q116 84 105 80 Z"
      fill="#7a5a4a"/>
    <g stroke="#3f382f" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.55">
      <path d="M105 72 Q75 52 40 54"/>
      <path d="M105 74 Q86 62 58 74"/>
      <path d="M105 74 Q96 76 84 80"/>
      <path d="M105 72 Q135 52 170 54"/>
      <path d="M105 74 Q124 62 152 74"/>
      <path d="M105 74 Q114 76 126 80"/>
    </g>
    <ellipse cx="105" cy="82" rx="15" ry="22" fill="#5a4a3a"/>
    <circle cx="105" cy="60" r="17" fill="#5a4a3a"/>
    <path d="M93 46 L91 30 L103 44 Z" fill="#5a4a3a"/>
    <path d="M117 46 L119 30 L107 44 Z" fill="#5a4a3a"/>
    <path d="M95 60 Q100 55 105 60" stroke="#f6efdc" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M105 60 Q110 55 115 60" stroke="#f6efdc" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M99 68 Q105 72 111 68" stroke="#f6efdc" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`,

  // Small wispy ink cloud (secondary accent)
  inkCloud: `<svg viewBox="0 0 140 60" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 40 Q12 40 12 30 Q12 20 24 20 Q28 12 44 12 Q60 8 70 22 Q88 20 92 32 Q106 32 105 42 Q102 50 92 50 L32 50 Q20 50 20 40 Z"
      fill="none" stroke="#3f382f" stroke-width="2.2" stroke-linejoin="round" opacity="0.6"/>
    <path d="M32 45 Q50 42 68 45" fill="none" stroke="#3f382f" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/>
  </svg>`,

  // Ink leaf (ginkgo-ish) — small accent
  inkLeaf: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 20 Q22 40 20 78 Q22 100 50 105 Q78 100 80 78 Q78 40 50 20 Z"
      fill="#8b9b70" opacity="0.65"/>
    <path d="M50 20 Q22 40 20 78 Q22 100 50 105 Q78 100 80 78 Q78 40 50 20 Z"
      fill="none" stroke="#3f382f" stroke-width="1.8"/>
    <path d="M50 20 L50 105" stroke="#3f382f" stroke-width="1.2" opacity="0.5"/>
    <path d="M50 55 Q35 68 30 82" fill="none" stroke="#3f382f" stroke-width="1" opacity="0.4"/>
    <path d="M50 55 Q65 68 70 82" fill="none" stroke="#3f382f" stroke-width="1" opacity="0.4"/>
    <line x1="50" y1="105" x2="50" y2="122" stroke="#3f382f" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  // Cinnabar seal (印章) — traditional finishing mark
  seal: `<svg viewBox="0 0 80 90" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="68" height="78" rx="3" fill="#c15a3e" stroke="#3f382f" stroke-width="1.5"/>
    <rect x="12" y="12" width="56" height="66" rx="2" fill="none" stroke="#f6efdc" stroke-width="1.4"/>
    <g stroke="#f6efdc" stroke-width="3" stroke-linecap="square" fill="none">
      <path d="M22 25 L58 25"/>
      <path d="M22 42 L58 42"/>
      <path d="M32 25 L32 42"/>
      <path d="M48 25 L48 42"/>
      <path d="M22 55 L58 55"/>
      <path d="M40 55 L40 70"/>
      <path d="M22 70 L58 70"/>
    </g>
  </svg>`,
};

const DECOS = {
  weather:   [{ pos: "tr", key: "swallow",  size: "m"  }, { pos: "bl", key: "inkCloud", size: "s"  }],
  hotTopics: [{ pos: "tl", key: "squirrel", size: "l"  }, { pos: "br", key: "inkLeaf",  size: "s"  }],
  market:    [{ pos: "bl", key: "hedgehog", size: "l"  }, { pos: "tr", key: "seal",     size: "xs" }],
  joke:      [{ pos: "tl", key: "bat",      size: "m"  }, { pos: "br", key: "seal",     size: "xs" }],
  famousPeople: [{ pos: "tr", key: "inkLeaf", size: "s" }, { pos: "bl", key: "seal",   size: "xs" }],
};

function decorations(kind) {
  return (DECOS[kind] || [])
    .map((d) => `<div class="deco deco--${d.pos} deco--${d.size}">${CREATURES[d.key]}</div>`)
    .join("");
}

// Get {hour, minute, weekday} in a given IANA timezone right now
function nowInZone(tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some engines report 24 at midnight
  return { hour, minute: parseInt(get("minute"), 10), weekday: get("weekday") };
}

// Exchange trading hours per region (local exchange time)
const MARKET_HOURS = {
  US:     { tz: "America/New_York", open: [9, 30], close: [16, 0] },
  Europe: { tz: "Europe/Berlin",    open: [9, 0],  close: [17, 30] },
  Asia:   { tz: "Asia/Shanghai",    open: [9, 30], close: [16, 0] },
};

function isMarketOpen(region) {
  const cfg = MARKET_HOURS[region];
  if (!cfg) return false;
  const { hour, minute, weekday } = nowInZone(cfg.tz);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const mins = hour * 60 + minute;
  const openMins = cfg.open[0] * 60 + cfg.open[1];
  const closeMins = cfg.close[0] * 60 + cfg.close[1];
  return mins >= openMins && mins < closeMins;
}

/* ---------- card builders (return HTML strings) ---------- */

function buildWeather(w) {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
  return `
    <div class="card-title">${esc(dateStr)} · ${esc(w.location || "Weather")}</div>
    <div class="weather-row">
      <div class="weather-icon">${CREATURES.inkSun}</div>
      <div class="weather-main">
        <div class="weather-temp">${Math.round(w.lowC)}°<span class="weather-temp-sep">–</span>${Math.round(w.highC)}<sup>°C</sup></div>
        <div class="weather-temp-alt">${Math.round(cToF(w.lowC))}°–${Math.round(cToF(w.highC))}<sup>°F</sup></div>
        <div class="weather-cond">${esc(w.condition || "")}</div>
      </div>
    </div>
    <div class="weather-meta">
      <span><b>Now</b> ${Math.round(w.tempC)}°C · ${Math.round(cToF(w.tempC))}°F</span>
      <span><b>Rain</b> ${Math.round(w.rainChance)}%</span>
    </div>
  `;
}

function buildHotTopics(t) {
  const topics = (t.topics || []).map((topic) => {
    const chips = (topic.keywords || [])
      .map((k) => `<span class="chip">${esc(k)}</span>`)
      .join("");
    return `
      <li class="topic">
        <div class="topic-chips">${chips}</div>
        <div class="topic-summary">${esc(topic.summary || "")}</div>
      </li>
    `;
  }).join("");
  return `
    <div class="card-title">${esc(t.headline || "Today's buzz")}</div>
    <ul class="topics-list">${topics}</ul>
  `;
}

function buildMarket(m) {
  const indices = m.indices || [];
  const regionOrder = ["US", "Europe", "Asia"];
  const grouped = regionOrder
    .map((region) => ({ region, items: indices.filter((i) => i.region === region) }))
    .filter((g) => g.items.length);

  const cols = grouped.map(({ region, items }) => {
    const open = isMarketOpen(region);
    const cards = items.map((idx) => {
      const up = idx.changePct >= 0;
      const arrow = up ? "▲" : "▼";
      const sign = up ? "+" : "";
      return `
        <div class="index">
          <div class="index-name">${esc(idx.name)}</div>
          <div class="index-price">${Number(idx.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          <div class="index-change ${up ? "up" : "down"}">${arrow} ${sign}${idx.changePct.toFixed(2)}%</div>
        </div>
      `;
    }).join("");
    return `
      <div class="region-col${items.length > 2 ? " region-col--dense" : ""}">
        <div class="region-head">
          <span class="region-label">${esc(region)}</span>
          <span class="badge ${open ? "live" : "closed"}"><span class="dot"></span>${open ? "Live" : "Closed"}</span>
        </div>
        ${cards}
      </div>
    `;
  }).join("");

  return `
    <div class="card-title">Markets around the world</div>
    <div class="market-grid">${cols}</div>
  `;
}

function buildJoke(j) {
  const en = j.en || {};
  const zh = j.zh || {};
  const enWhy = en.explanation
    ? `<div class="joke-why">${esc(en.explanation)}</div>`
    : "";
  return `
    <div class="card-title">Joke of the day · 今日笑话</div>
    <div class="joke-grid">
      <div class="joke-panel joke-en">
        <div class="joke-lang">EN</div>
        <div class="joke-text">${esc(en.joke || "")}</div>
        ${enWhy}
      </div>
      <div class="joke-panel joke-zh">
        <div class="joke-lang">中文</div>
        <div class="joke-text">${esc(zh.joke || "")}</div>
      </div>
    </div>
  `;
}

function buildFamousPeople(p) {
  const people = (p.people || []).map((person) => {
    const highlights = person.highlights?.length
      ? `<ul class="person-highlights">${person.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
      : `<div class="person-bio">${esc(person.bio || person.extract || "")}</div>`;
    return `
    <li class="person">
      <img class="person-photo" src="${esc(person.photoUrl)}" alt="${esc(person.name)}" loading="lazy">
      <div class="person-name">${esc(person.name)}${person.born ? ` <span class="person-born">b. ${esc(person.born)}</span>` : ""}</div>
      ${highlights}
    </li>
  `;
  }).join("");
  return `
    <div class="card-title">${esc(p.headline || "Born today")}</div>
    <ul class="people-list">${people}</ul>
  `;
}

/* ---------- assemble ---------- */

function render(data) {
  stage.innerHTML = "";
  dotsNav.innerHTML = "";
  cards = [];

  const plan = [
    data.weather   && { kind: "weather",   build: () => buildWeather(data.weather) },
    data.hotTopics && { kind: "hotTopics", build: () => buildHotTopics(data.hotTopics) },
    data.market    && { kind: "market",    build: () => buildMarket(data.market) },
    data.joke      && { kind: "joke",      build: () => buildJoke(data.joke) },
    data.famousPeople && { kind: "famousPeople", build: () => buildFamousPeople(data.famousPeople) },
  ].filter(Boolean);

  plan.forEach((item, i) => {
    const el = document.createElement("section");
    el.className = "card";
    el.dataset.kind = item.kind;
    el.innerHTML = decorations(item.kind) + item.build();
    stage.appendChild(el);
    cards.push(el);

    const dot = document.createElement("button");
    dot.addEventListener("click", () => goto(i));
    dotsNav.appendChild(dot);
  });

  current = 0;
  show(0);
  startRotation();
}

function show(i) {
  cards.forEach((el, idx) => el.classList.toggle("is-active", idx === i));
  [...dotsNav.children].forEach((d, idx) => d.classList.toggle("active", idx === i));
}

function goto(i) {
  current = (i + cards.length) % cards.length;
  show(current);
  startRotation(); // reset timer on manual nav
}

function next() { goto(current + 1); }

function startRotation() {
  clearInterval(rotateTimer);
  rotateTimer = setInterval(next, ROTATE_MS);
}

/* ---------- data loading ---------- */

async function load() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (err) {
    stage.innerHTML = `<div class="error">Couldn't load the board — ${esc(err.message)}</div>`;
    console.error(err);
  }
}

// Tap anywhere (except dots) to advance
document.addEventListener("click", (e) => {
  if (!e.target.closest(".dots") && cards.length) next();
});

load();
setInterval(load, RELOAD_MS);
