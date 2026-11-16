/**
 * Measures whether a chat model can be trusted to write DanfoAI's replies.
 *
 *   npm run eval:model -- --self-test        # check the scorer itself, no model needed
 *   MODEL_BASE_URL=http://localhost:8000/v1 MODEL_NAME=danfo-qwen npm run eval:model
 *
 * It replays the held-out trips in training/eval.cases.jsonl (written by
 * `npm run build:training`) against any OpenAI-compatible endpoint — a base
 * model or one with the fine-tuned LoRA adapter loaded — sending exactly the
 * system prompt the app sends. Each reply is judged by the two gates /api/chat
 * applies in production: replyKeepsFacts() (every boarding and drop-off stop,
 * every fare, no invented ₦ amount, no loops) and replyInLanguage() (it is
 * written in the language the rider asked in, not in English).
 *
 * The result is a pass rate per language. A language the model passes
 * (EVAL_PASS_RATE, default 95%) can be added to MODEL_REPLY_LANGUAGES; one it
 * fails stays on the planner's templates. Failures are written to
 * training/eval-failures.jsonl for reading.
 *
 * Environment:
 *   MODEL_BASE_URL   base URL ending in /v1 (vLLM, Ollama, llama.cpp, LM Studio, …)
 *   MODEL_NAME       model id to request
 *   MODEL_API_KEY    bearer token, if the endpoint needs one
 *   EVAL_LIMIT       cases to run (default 150, spread across languages)
 *   EVAL_CONCURRENCY parallel requests (default 3)
 *   EVAL_PASS_RATE   share of replies that must pass both gates (default 0.95)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { replyKeepsFacts } from "../lib/prompt";
import { LANGUAGE_NAMES, replyInLanguage, type LangCode } from "../lib/language-detect";
import type { TripPlan } from "../lib/route-planner";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "training");
const CASES = join(DIR, "eval.cases.jsonl");
const LIMIT = Number(process.env.EVAL_LIMIT || 150);
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY || 3);
const PASS_RATE = Number(process.env.EVAL_PASS_RATE || 0.95);
const selfTest = process.argv.includes("--self-test");

interface Case {
  language: LangCode;
  system: string;
  question: string;
  /** The planner's answer in the rider's language. */
  reference: string;
  /** The planner's answer in English — what the facts are checked against. */
  english: string;
  plan: TripPlan;
}

if (!existsSync(CASES)) {
  console.error("training/eval.cases.jsonl not found — run `npm run build:training` first.");
  process.exit(1);
}
const all: Case[] = readFileSync(CASES, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** The first `limit` cases, taken evenly across languages. */
function sample(cases: Case[], limit: number): Case[] {
  const byLang = new Map<string, Case[]>();
  for (const c of cases) byLang.set(c.language, [...(byLang.get(c.language) ?? []), c]);
  const out: Case[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const list of byLang.values()) {
      if (list[i] && out.length < limit) {
        out.push(list[i]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

async function ask(c: Case): Promise<string> {
  const base = (process.env.MODEL_BASE_URL || "").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.MODEL_API_KEY ? { Authorization: `Bearer ${process.env.MODEL_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.MODEL_NAME,
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: "system", content: c.system },
        { role: "user", content: c.question },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content ?? "");
}

interface Row {
  /** Replies that pass both gates and would be shown to the rider. */
  kept: number;
  facts: number;
  inLanguage: number;
  total: number;
  errors: number;
}

async function run(cases: Case[], reply: (c: Case) => Promise<string>) {
  const rows = new Map<LangCode, Row>();
  const failures: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
      for (;;) {
        const c = cases[next++];
        if (!c) return;
        const row = rows.get(c.language) ?? { kept: 0, facts: 0, inLanguage: 0, total: 0, errors: 0 };
        rows.set(c.language, row);
        row.total++;
        let text = "";
        try {
          text = (await reply(c)).trim();
        } catch (e) {
          row.errors++;
          failures.push(JSON.stringify({ language: c.language, question: c.question, error: (e as Error).message }));
          continue;
        }
        const facts = replyKeepsFacts(text, c.plan, c.english, c.language);
        const inLanguage = replyInLanguage(text, c.language);
        // Both gates, exactly as /api/chat applies them.
        const kept = facts && inLanguage;
        if (facts) row.facts++;
        if (kept) row.kept++;
        if (inLanguage) row.inLanguage++;
        if (!kept) {
          failures.push(JSON.stringify({ language: c.language, question: c.question, reply: text, reference: c.reference }));
        }
      }
    })
  );
  return { rows, failures };
}

function report(rows: Map<LangCode, Row>) {
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%`.padStart(4) : "   –");
  console.log("\nlanguage         cases  usable  facts kept  right language  errors");
  const passed: LangCode[] = [];
  for (const [lang, r] of [...rows].sort()) {
    console.log(
      `${(LANGUAGE_NAMES[lang] ?? lang).padEnd(16)} ${String(r.total).padStart(5)}  ${pct(r.kept, r.total).padStart(6)}  ${pct(r.facts, r.total).padStart(10)}  ${pct(r.inLanguage, r.total).padStart(14)}  ${String(r.errors).padStart(6)}`
    );
    if (r.total && r.kept / r.total >= PASS_RATE) passed.push(lang);
  }
  return passed;
}

async function main() {
  if (selfTest) {
    // The scorer must accept the planner's own answers and reject a changed fare.
    // A walk-only answer has no fare to change, so it can't take part.
    const cases = sample(all.filter((c) => c.reference.includes("₦")), LIMIT);
    const good = await run(cases, async (c) => c.reference);
    const bad = await run(cases, async (c) =>
      c.reference.replace(/₦\s?(\d[\d,]*)/, (_m, n) => `₦${Number(String(n).replace(/,/g, "")) + 7}`)
    );
    console.log("Planner's own answers (every one should keep its facts):");
    report(good.rows);
    console.log("\nSame answers with the first fare changed (none should pass):");
    report(bad.rows);
    const sum = (m: Map<LangCode, Row>, k: keyof Row) => [...m.values()].reduce((s, r) => s + r[k], 0);
    const ok = sum(good.rows, "kept") === sum(good.rows, "total") && sum(bad.rows, "kept") === 0;
    console.log(ok ? "\nself-test passed" : "\nself-test FAILED");
    if (!ok) {
      writeFileSync(join(DIR, "eval-failures.jsonl"), [...good.failures].join("\n") + "\n");
      process.exitCode = 1;
    }
    return;
  }

  if (!process.env.MODEL_BASE_URL || !process.env.MODEL_NAME) {
    console.error("Set MODEL_BASE_URL (ending in /v1) and MODEL_NAME, or run with --self-test.");
    process.exit(1);
  }
  const cases = sample(all, LIMIT);
  console.log(`Evaluating ${process.env.MODEL_NAME} on ${cases.length} held-out trips…`);
  const { rows, failures } = await run(cases, ask);
  const passed = report(rows);
  writeFileSync(join(DIR, "eval-failures.jsonl"), failures.join("\n") + (failures.length ? "\n" : ""));
  console.log(`\n${failures.length} failing replies written to training/eval-failures.jsonl`);
  console.log(
    passed.length
      ? `Languages at or above ${Math.round(PASS_RATE * 100)}%: set MODEL_REPLY_LANGUAGES=${passed.join(",")}`
      : `No language reached ${Math.round(PASS_RATE * 100)}% — keep MODEL_REPLY_LANGUAGES as it is.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
