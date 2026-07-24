import { callAI, parseAIJson } from "./ai-client.mjs";

// Random seed injected into the joke prompt so we get variety without any state.
export const JOKE_THEMES = [
  "Observational humor", "Dry / deadpan", "Sarcasm", "Self-deprecating", "Absurdist",
  "Anti-humor", "Post-irony", "Dark humor"
];

export const JOKE_SCHEMA = {
  type: "object",
  properties: {
    en: {
      type: "object",
      properties: {
        joke: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["joke", "explanation"],
    },
    zh: {
      type: "object",
      properties: { joke: { type: "string" } },
      required: ["joke"],
    },
  },
  required: ["en", "zh"],
};

export async function generateJoke() {
  const theme = JOKE_THEMES[Math.floor(Math.random() * JOKE_THEMES.length)];
  const system =
    `You write fresh, family-friendly bilingual jokes for a morning display board. Return JSON only.`;
  const user = `
Write two short original jokes. 

- English: a one-liner in the style of current internet/meme humor, Theme seed: "${theme}". Ideally about 
modern life (phones, apps, AI, remote work, dating apps, social media itself, streaming, delivery apps, but not limited
to those topics). Avoid classic joke-book formats (knock-knock, "why did the chicken", "walks into a bar", pun-based dad 
jokes), those read as dated. Favor the short, deadpan, slightly ironic tone common in tweet, tiktok or caption style jokes. 
Include a brief "why it's funny" note (under 20 words).

- Chinese (中文): 你是一位非常熟悉当代中文互联网文化和年轻人日常聊天方式的幽默创作者。生成 1 个自然、好笑、有当代中文语感的笑话或幽默表达。
要求：
  不要写传统“问：……答：……”式冷笑话，也不要像春晚小品或老式段子。
  优先使用当代中文常见的幽默方式，包括：
    观察型幽默：抓住生活中大家都经历过但很少直接说出来的细节
    一本正经胡说八道：用严肃、正式的语气描述荒谬事情
    轻度自嘲：尤其适合工作、生活、社交、消费、健身、恋爱等场景
    荒诞 / 抽象：逻辑突然向意想不到的方向发展，但仍然能理解笑点
    反转：前半句建立正常预期，后半句突然改变逻辑
    阴阳 / 反讽：表面赞美，实际吐槽，但不要恶毒
    谐音、成语或固定表达篡改：只有自然时才使用，不要强行谐音
    过度正式化：把一件非常小的事情上升成宏大的理论、制度或人生问题
  笑点尽量来自“观察 + 意外的表达”，而不是单纯堆网络热梗。
  可以使用当前流行的中文网络表达，但不要为了显得年轻而强行加入“绝绝子”“家人们”等已经显得刻意或过时的表达。
  避免明显的 AI 味，例如过度工整、每句话结构一样、解释笑点、刻意制造金句。
  每个笑话控制在 1到3 句话，最好像一个聪明的人在微信群、饭桌、办公室或朋友聊天时随口说出来的。
  幽默可以有一点丧、一点荒诞、一点刻薄，但不要攻击具体弱势群体或依赖冒犯别人制造笑点。
  Must be originally conceived in Chinese — do NOT translate an English joke, 
  and do NOT force a pun that doesn't land naturally in Mandarin. No explanation needed.

Return JSON of shape:
{ "en": { "joke": "...", "explanation": "..." }, "zh": { "joke": "..." } }
`.trim();

  const raw = await callAI({ system, user, temperature: 0.95, jsonSchema: JOKE_SCHEMA });
  return parseAIJson(raw);
}
