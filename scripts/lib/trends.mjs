export async function fetchTrends(geo) {
  // Google Trends daily-trending RSS feed.
  const url = `https://trends.google.com/trending/rss?geo=${geo}`;
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

// Google News RSS section feeds → categorized candidate stories (no API key).
// Each section is pre-ranked by Google; we take the top `perCategory` items each.
const NEWS_CATEGORIES = [
  { topic: "WORLD", label: "World" },
  { topic: "NATION", label: "US/Politics" },
  { topic: "BUSINESS", label: "Business" },
  { topic: "TECHNOLOGY", label: "Tech" },
  { topic: "ENTERTAINMENT", label: "Entertainment" },
  { topic: "SPORTS", label: "Sports" },
];

const pubDateRe = /<pubDate>\s*([\s\S]*?)\s*<\/pubDate>/;

async function fetchNewsSection({ topic, label }, perCategory) {
  const url = `https://news.google.com/rss/headlines/section/topic/${topic}?hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (morning-board)" },
  });
  if (!res.ok) throw new Error(`Google News ${topic}: HTTP ${res.status}`);
  const xml = await res.text();

  const out = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const titleRe = /<title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/;
  let m;
  while ((m = itemRe.exec(xml)) !== null && out.length < perCategory) {
    const block = m[1];
    const rawTitle = titleRe.exec(block)?.[1]?.trim();
    if (!rawTitle) continue;
    // Google News titles are "Headline - Source"; split the trailing source off.
    let title = rawTitle;
    let source = "";
    const dash = rawTitle.lastIndexOf(" - ");
    if (dash > 0) {
      title = rawTitle.slice(0, dash).trim();
      source = rawTitle.slice(dash + 3).trim();
    }
    out.push({
      category: label,
      title,
      source,
      // Google News section <description> is only a related-links <ol> blob, not a
      // real summary — omit it to keep the AI prompt lean.
      description: "",
      pubDate: pubDateRe.exec(block)?.[1]?.trim() || "",
    });
  }
  return out;
}

// Fetch all category sections in parallel; a failing feed is skipped, not fatal.
export async function fetchCategoryNews(perCategory = 2) {
  const results = await Promise.allSettled(
    NEWS_CATEGORIES.map((c) => fetchNewsSection(c, perCategory)),
  );
  const items = [];
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
    else console.error("category news failed:", r.reason?.message || r.reason);
  }
  // De-duplicate across feeds by normalized title.
  const seen = new Set();
  return items.filter((it) => {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchNews(country, limit = 2) {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) return [];
  const url = `https://newsapi.org/v2/top-headlines?country=${country}&pageSize=${limit}`;
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!res.ok) throw new Error(`NewsAPI ${country}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.articles || []).slice(0, limit).map((a) => ({
    title: a.title || "",
    description: a.description || "",
  }));
}
