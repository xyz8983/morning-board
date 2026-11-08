#!/usr/bin/env node
/**
 * One-off parser: turns resources/Most_Common_American_Idioms.html into a clean
 * JSON dataset at resources/idioms.json, consumed at runtime by lib/idioms.mjs.
 *
 * Run manually whenever the source HTML changes:
 *   node scripts/lib/parse-idioms.mjs
 *
 * No npm deps — the source markup is highly regular, so plain regex parsing is
 * enough and keeps the project dependency-light.
 *
 * Each idiom block looks like:
 *   <h2 id="a-bad-apple">2. A bad apple</h2>
 *   <p class="cn"><strong>释义</strong></p>
 *   <p class="en"><strong>Interpretation</strong></p>
 *   <p class="cn">…short Chinese meaning…</p>
 *   <p class="cn">…Chinese etymology…</p>
 *   <p>…English interpretation…</p>
 *   <p class="cn"><strong>例句</strong></p>
 *   <p class="en"><strong>Examples</strong></p>
 *   <ul><li><span lang="en">EN…<em>idiom</em>…</span> <span lang="cn">中文…</span><audio…></li>…</ul>
 *
 * <em> tags inside interpretations/examples are preserved (used by the frontend
 * to highlight the idiom); <audio> is dropped; HTML entities are decoded.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const SRC = path.join(root, "resources", "Most_Common_American_Idioms.html");
const OUT = path.join(root, "resources", "idioms.json");

// Decode the only entities present in the source, then collapse whitespace.
// <em> tags are kept verbatim — they mark the idiom phrase for highlighting.
function clean(html) {
  return html
    .replace(/<audio[\s\S]*?<\/audio>/gi, "")
    .replace(/<\/?strong>/gi, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// A paragraph is "Chinese" when CJK characters outnumber Latin letters — some
// English interpretations quote a Chinese phrase, so a simple presence test fails.
const isChinese = (s) => {
  const cjk = (s.match(/[一-鿿]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return cjk > latin;
};

function parseBlock(block) {
  // id + title: `a-bad-apple">2. A bad apple</h2>`
  const head = block.match(/^([^"]+)">\s*([\s\S]*?)<\/h2>/);
  if (!head) return null;
  const id = head[1].trim();
  const title = clean(head[2]).replace(/^\d+\.\s*/, ""); // strip leading "2. "

  // Split interpretation vs examples on the "例句" (Examples) marker. Most blocks
  // then wrap examples in <ul><li>, but a few (e.g. hopping-mad) use an inline
  // dash list of <span> pairs with no <ul> — splitting on the marker handles both.
  const afterH2 = block.slice(head[0].length);
  const exMatch = afterH2.match(/例句|举例|Examples/); // a few blocks use 举例 instead of 例句
  const exIdx = exMatch ? exMatch.index : -1;
  const interpPart = exIdx === -1 ? afterH2 : afterH2.slice(0, exIdx);
  const examplesPart = exIdx === -1 ? "" : afterH2.slice(exIdx);

  // Interpretation paragraphs — classify by language, since a handful of blocks
  // put the English interpretation inside <p class="cn"> rather than a plain <p>.
  const zh = [];
  const en = [];
  const pRe = /<p(?:\s+class="(?:cn|en)")?>([\s\S]*?)<\/p>/g;
  let m;
  const MARKERS = new Set(["释义", "例句", "Interpretation", "Examples"]);
  while ((m = pRe.exec(interpPart))) {
    const text = clean(m[1]); // <strong> already stripped by clean()
    if (!text) continue;
    if (MARKERS.has(text)) continue; // skip only the section-label markers
    if (isChinese(text)) zh.push(text);
    else en.push(text);
  }

  // Examples — zip English spans with their Chinese counterparts (document order).
  const enSpans = [...examplesPart.matchAll(/<span lang="en">([\s\S]*?)<\/span>/g)].map((x) => clean(x[1]));
  const zhSpans = [...examplesPart.matchAll(/<span lang="cn">([\s\S]*?)<\/span>/g)].map((x) => clean(x[1]));
  const examples = [];
  for (let i = 0; i < Math.max(enSpans.length, zhSpans.length); i++) {
    const exEn = enSpans[i] || "";
    const exZh = zhSpans[i] || "";
    if (exEn || exZh) examples.push({ en: exEn, zh: exZh });
  }

  return {
    id,
    title,
    glossZh: zh[0] || "",
    interpretationEn: en.join(" "),
    interpretationZh: zh.slice(1).join(" "),
    examples,
  };
}

async function main() {
  const html = await fs.readFile(SRC, "utf8");
  const blocks = html.split(/<h2 id="/).slice(1); // drop preamble before first idiom
  const idioms = [];
  for (const b of blocks) {
    const parsed = parseBlock(b);
    if (parsed && parsed.title) idioms.push(parsed);
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(idioms) + "\n");
  console.log(`[parse-idioms] wrote ${idioms.length} idioms → ${OUT}`);

  // quick sanity log
  const noEx = idioms.filter((i) => i.examples.length === 0).length;
  const noEn = idioms.filter((i) => !i.interpretationEn).length;
  console.log(`[parse-idioms] without examples: ${noEx}, without EN interpretation: ${noEn}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
