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
