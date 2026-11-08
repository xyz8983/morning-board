// Fetches two human-written jokes:
//   1. Reddit r/Jokes top-of-day (upvote-ranked) + a short AI "why it's funny" note
//   2. JokeAPI with safe-mode on
import { callAI } from "./ai-client.mjs";

const UA = "morning-board/1.0";
const MAX_LEN = 220; // keep jokes short enough to fit the card

// The unauthenticated Reddit .json endpoints return 403 for many networks, but the
// public RSS (Atom) feed works and keeps the same top-of-day ranking.
// The feed has no over_18 flag, so we filter with a small explicit-word blocklist.
const BLOCKLIST =
  /\b(sex\w*|fuck\w*|shit\w*|dick|cock|pussy|penis|vagina|rape\w*|nazi\w*|hitler|suicid\w*|boobs?|tits?|fart\w*|orgasm\w*|porn\w*|whore|slut|cum|blowjob|molest\w*|pedo\w*|nigg\w*|retard\w*)\b/i;

function decodeEntities(s) {
  return (s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function fetchRedditJoke() {
  const res = await fetch("https://www.reddit.com/r/Jokes/top.rss?t=day&limit=30", {
    headers: { "user-agent": UA },
  });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
  const xml = await res.text();

  // Entries are already in top-of-day order; take the first that passes the filters.
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const rawTitle = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1];
    const rawContent = /<content[^>]*>([\s\S]*?)<\/content>/.exec(block)?.[1];
    const title = decodeEntities(rawTitle).trim();
    if (!title) continue;

    // Content is double-escaped HTML: unescape once, grab the post body, strip tags.
    const html = decodeEntities(rawContent);
    const bodyHtml = /<div class="md">([\s\S]*?)<\/div>\s*<!-- SC_ON -->/.exec(html)?.[1] || "";
    const body = decodeEntities(
      bodyHtml.replace(/<\/p>\s*/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]*>/g, "")
    )
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (body === "[removed]" || body === "[deleted]") continue;

    const joke = body ? `${title}\n${body}` : title;
    if (joke.length > MAX_LEN || BLOCKLIST.test(joke)) continue;
    return { joke, source: "r/Jokes" };
  }
  throw new Error("Reddit: no suitable joke found");
}

export async function fetchJokeApiJoke() {
  const res = await fetch("https://v2.jokeapi.dev/joke/Any?safe-mode&type=single", {
    headers: { "user-agent": UA },
  });
  if (!res.ok) throw new Error(`JokeAPI HTTP ${res.status}`);
  const data = await res.json();
  if (data.error || !data.joke) throw new Error("JokeAPI: no joke returned");
  return { joke: data.joke.trim(), source: "JokeAPI" };
}

// Asks the AI for a one-line "why it's funny" note. Short and plain — fits under
// the joke on the card. Returns "" on failure so the joke still renders.
async function explainJoke(joke) {
  try {
    const raw = await callAI({
      system:
        "You write a single short note (under 15 words) that explains why a joke is funny. " +
        "Plain, no hype, no 'the joke is funny because', no quotes. Just the explanation.",
      user: `Explain in one short sentence why this joke is funny:\n\n${joke}`,
      temperature: 0.4,
    });
    return (raw || "").trim().replace(/^["']|["']$/g, "").slice(0, 160);
  } catch (err) {
    console.error("joke explanation failed:", err.message);
    return "";
  }
}

// Returns { items: [{ joke, source, explanation? }, ...] } — aims for two jokes.
// If Reddit fails, a second JokeAPI joke fills the slot. Only the Reddit joke
// gets an AI-generated explanation.
export async function fetchJokes() {
  const [reddit, jokeApi] = await Promise.allSettled([fetchRedditJoke(), fetchJokeApiJoke()]);
  const items = [];

  if (reddit.status === "fulfilled") {
    const r = reddit.value;
    r.explanation = await explainJoke(r.joke);
    items.push(r);
  } else {
    console.error("reddit joke failed:", reddit.reason?.message || reddit.reason);
  }

  if (jokeApi.status === "fulfilled") items.push(jokeApi.value);
  else console.error("jokeapi joke failed:", jokeApi.reason?.message || jokeApi.reason);

  if (items.length === 1 && reddit.status === "rejected") {
    // Fallback: second JokeAPI joke (retry a few times to avoid an exact duplicate).
    for (let i = 0; i < 3; i++) {
      try {
        const extra = await fetchJokeApiJoke();
        if (extra.joke !== items[0].joke) {
          items.push(extra);
          break;
        }
      } catch (err) {
        console.error("jokeapi fallback failed:", err.message);
        break;
      }
    }
  }
  return { items };
}
