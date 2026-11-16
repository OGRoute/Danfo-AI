/**
 * Builds a fine-tuning dataset for the DanfoAI chat model.   npm run build:training
 *
 * The 0G testnet model (qwen2.5-omni-7b) is only trusted to rephrase English
 * today: it garbles Yoruba, Igbo and Hausa and drifts out of Pidgin, so those
 * replies come from templates (see MODEL_REPLY_LANGUAGES in app/api/chat).
 * This script turns the trip planner into a teacher for a better model.
 * Every example is computed from data/lagos-routes.json and
 * data/lagos-places.json, so the dataset contains no fare, stop or boarding
 * point that the planner would not give.
 *
 * Output (training/, git-ignored — regenerate whenever the route data changes):
 *   grounded.train.jsonl / grounded.eval.jsonl
 *       The production task. system = the exact prompt the app sends (the
 *       computed answer plus "rewrite / translate it, keep every fact"),
 *       user = the rider's question, assistant = the answer in the rider's
 *       language. Tuning on this is what lets Yoruba, Igbo, Hausa and Pidgin
 *       move from templates to the model.
 *   direct.train.jsonl / direct.eval.jsonl
 *       No computed answer in the prompt: the model must recall the route
 *       itself. Useful for measuring how much Lagos it has absorbed; riskier
 *       to deploy, because fares change and a tuned-in fare goes stale.
 *
 * Format: one {"messages":[{role,content},…]} object per line — the chat
 * format accepted by 0G fine-tuning, Hugging Face TRL/PEFT and most hosted
 * tuners. Eval pairs never appear in train (split by origin–destination pair).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import seed from "../data/lagos-routes.json";
import { buildSystemPrompt, type RouteKB } from "../lib/prompt";
import { composeAnswer, composeNoTrip } from "../lib/compose-answer";
import { PICKER_PLACES, type PickerPlace } from "../lib/lagos-places";
import type { LangCode } from "../lib/language-detect";
import { planBetween, resolveToNetwork, type TripPlan } from "../lib/route-planner";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "training");
const PAIRS = Number(process.env.TRAINING_PAIRS || 2500);
const EVAL_SHARE = 0.1;
const kb = seed as unknown as RouteKB;

// The way riders actually ask, per language. {a} = start, {b} = destination.
const QUESTIONS: Record<LangCode, string[]> = {
  en: [
    "How do I get from {a} to {b}?",
    "{a} to {b}",
    "I'm at {a} and I want to go to {b}.",
    "What's the best way from {a} to {b}, and how much is it?",
    "Which bus do I take from {a} to {b}?",
  ],
  pcm: [
    "Abeg, how I go reach {b} from {a}?",
    "I dey {a}, I wan go {b}.",
    "How much be motor from {a} to {b}?",
    "Which bus I go enter from {a} to {b}?",
  ],
  yo: [
    "Mo fẹ́ lọ sí {b} láti {a}",
    "Báwo ni mo ṣe lè dé {b} láti {a}?",
    "Èló ni owó ọkọ̀ láti {a} sí {b}?",
  ],
  ig: [
    "Kedu ka m ga-esi gaa {b} site na {a}?",
    "Achọrọ m ịga {b} site na {a}",
    "Ego ole ka ụgbọ si {a} gaa {b}?",
  ],
  ha: [
    "Ina son zuwa {b} daga {a}",
    "Yaya zan je {b} daga {a}?",
    "Nawa ne kuɗin mota daga {a} zuwa {b}?",
  ],
};
const LANGS = Object.keys(QUESTIONS) as LangCode[];

const DIRECT_SYSTEM =
  "You are DanfoAI, an expert Lagos transit guide. Tell the rider which vehicles to take, " +
  "where to board, where to get off, the fare in ₦ and how long it takes. Reply in the " +
  "rider's language. If you do not know a route, say so — never invent a fare or a bus stop.";

/** Small seeded generator, so the dataset is the same on every build. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20261116);
const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];

function plan(a: PickerPlace, b: PickerPlace): TripPlan | null {
  const from = resolveToNetwork(kb, a.name, a.pos);
  const to = resolveToNetwork(kb, b.name, b.pos);
  return from && to ? planBetween(kb, from, to) : null;
}

const line = (system: string, user: string, assistant: string) =>
  JSON.stringify({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
      { role: "assistant", content: assistant },
    ],
  });

/** Eval trips with their plans, so scripts/eval-model.ts can fact-check a model's replies. */
const evalCases: string[] = [];

const files: Record<string, string[]> = {
  "grounded.train": [],
  "grounded.eval": [],
  "direct.train": [],
  "direct.eval": [],
};
const stats = { pairs: 0, trips: 0, refusals: 0, byLang: {} as Record<string, number> };
const seen = new Set<string>();

// Stops carry the network, so they are drawn as often as the whole gazetteer.
const stops = PICKER_PLACES.filter((p) => p.kind === "stop");
const draw = () => (random() < 0.5 ? pick(stops) : pick(PICKER_PLACES));

for (let guard = 0; stats.pairs < PAIRS && guard < PAIRS * 20; guard++) {
  const a = draw();
  const b = draw();
  const key = `${a.id}>${b.id}`;
  if (a === b || seen.has(key)) continue;
  seen.add(key);
  const p = plan(a, b);
  if (!p) continue;
  stats.pairs++;
  p.best ? stats.trips++ : stats.refusals++;

  const split = random() < EVAL_SHARE ? "eval" : "train";
  // Two languages per pair keeps the set balanced without five near-copies.
  const first = pick(LANGS);
  const langs = [first, pick(LANGS.filter((l) => l !== first))];
  for (const lang of langs) {
    const answer = p.best ? composeAnswer(p, lang) : composeNoTrip(p, lang);
    if (!answer) continue;
    const question = pick(QUESTIONS[lang]).replace("{a}", a.name).replace("{b}", b.name);
    files[`direct.${split}`].push(line(DIRECT_SYSTEM, question, answer));
    // The grounded task only exists when there is a computed trip to phrase.
    if (p.best) {
      const system = buildSystemPrompt(kb, { plan: p, language: lang });
      files[`grounded.${split}`].push(line(system, question, answer));
      if (split === "eval") {
        evalCases.push(JSON.stringify({ language: lang, system, question, reference: answer, english: composeAnswer(p, "en"), plan: p }));
      }
    }
    stats.byLang[lang] = (stats.byLang[lang] ?? 0) + 1;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, lines] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, `${name}.jsonl`), lines.join("\n") + "\n");
  console.log(`${String(lines.length).padStart(6)}  training/${name}.jsonl`);
}
writeFileSync(join(OUT_DIR, "eval.cases.jsonl"), evalCases.join("\n") + "\n");

// Rough size of the production set, for budgeting a fine-tuning run. 0G bills
// per million tokens per epoch; ~3.3 characters per token is a fair average
// for this mix of English and tone-marked Yoruba/Igbo/Hausa.
const tokens = Math.round(files["grounded.train"].join("").length / 3.3);
const cost = (rate: number) => ((tokens / 1e6) * rate).toFixed(1);

writeFileSync(
  join(OUT_DIR, "manifest.json"),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      routeDataVersion: kb.version,
      routeDataUpdatedAt: kb.updatedAt,
      places: PICKER_PLACES.length,
      ...stats,
      groundedTrainTokensEstimate: tokens,
      files: Object.fromEntries(Object.entries(files).map(([k, v]) => [`${k}.jsonl`, v.length])),
    },
    null,
    2
  ) + "\n"
);
console.log(
  `\n${stats.pairs} place pairs (${stats.trips} trips, ${stats.refusals} honest refusals) ` +
    `from ${PICKER_PLACES.length} places · ${JSON.stringify(stats.byLang)}`
);
console.log(
  `grounded.train is about ${(tokens / 1e6).toFixed(1)}M tokens: roughly ${cost(0.5)} 0G per epoch on Qwen2.5-0.5B-Instruct, ` +
    `${cost(4)} 0G per epoch on Qwen3-32B (0G fine-tuning list prices; set TRAINING_PAIRS to resize).`
);
