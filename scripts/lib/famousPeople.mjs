// Picks a few real, verified notable people born on today's date via Wikipedia's
// public "on this day" API — no API key, no AI hallucination, real name/face/bio.
export async function fetchFamousPeople(count = 3) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/births/${mm}/${dd}`;
  const res = await fetch(url, { headers: { "user-agent": "morning-board/1.0" } });
  if (!res.ok) throw new Error(`Wikipedia onthisday HTTP ${res.status}`);
  const data = await res.json();

  const candidates = (data.births || [])
    .map((b) => ({ year: b.year, page: b.pages?.[0] }))
    .filter((b) => b.page?.thumbnail?.source && b.page?.extract);

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, count).map(({ year, page }) => ({
    name: page.titles.normalized,
    photoUrl: page.thumbnail.source,
    bio: page.description || "",
    extract: page.extract,
    born: year,
  }));
}
