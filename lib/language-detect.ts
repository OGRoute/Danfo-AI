/**
 * Lightweight language identification for the five languages DanfoAI serves.
 *
 * Used in two places:
 *  - Picking the right transcript when voice input is on "Auto-detect" (the
 *    same audio is transcribed with several Intron language models and the
 *    transcript that reads most like its own language wins).
 *  - Choosing the reply / text-to-speech language from what the rider typed.
 *
 * It's a lexicon + orthography scorer — no model, no network — tuned for the
 * short, transit-flavoured sentences riders actually say.
 */
import { normalizeText } from "./lagos-stops";

export type LangCode = "en" | "pcm" | "yo" | "ig" | "ha";

export const LANGUAGE_NAMES: Record<LangCode, string> = {
  en: "English",
  pcm: "Nigerian Pidgin",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
};

export function isLangCode(v: unknown): v is LangCode {
  return typeof v === "string" && v in LANGUAGE_NAMES;
}

type Lexicon = { strong: string[]; weak: string[]; phrases?: string[] };

const LEXICON: Record<Exclude<LangCode, "en">, Lexicon> = {
  yo: {
    strong: [
      "mo", "fe", "lati", "bawo", "kini", "elo", "jowo", "nibo", "ibo", "emi", "awa",
      "sugbon", "owo", "oko", "ati", "yen", "eyin", "bayi", "maa", "gbe", "kuro", "wole",
      "bole", "ese", "odabo", "ekaro", "ekaasan", "ekale", "oya", "abi",
    ],
    weak: ["si", "ni", "lo", "wa", "mi", "se", "ti", "ko", "ma", "ki"],
  },
  ig: {
    strong: [
      "kedu", "esi", "gaa", "site", "biko", "anyi", "gini", "ebe", "ole", "ego", "daalu",
      "nke", "ahu", "maka", "onye", "ugbo", "ihe", "unu", "bu", "otu", "nnoo", "achoro",
      "chere", "ije", "ebee",
    ],
    weak: ["na", "ka", "m", "ga", "kwa", "ya"],
  },
  ha: {
    strong: [
      "ina", "son", "zuwa", "daga", "yaya", "nawa", "kudi", "sannu", "nagode", "yaushe",
      "akwai", "hanya", "mota", "zan", "tafi", "wajen", "nake", "kake", "shin", "wane",
      "yanzu", "barka", "motar", "tasha", "kai",
    ],
    weak: ["da", "ta", "ne", "ce", "nan", "su", "ka", "ki"],
  },
  pcm: {
    strong: [
      "dey", "wey", "abeg", "wetin", "una", "wan", "comot", "sabi", "sef", "wahala",
      "oga", "dem", "shey", "naim", "dis", "dat", "waka", "chop", "pikin", "jare",
      "abi", "wia", "wetin", "enter", "motor",
    ],
    weak: ["na", "go", "fit", "don", "make", "reach", "sha", "am", "for"],
    phrases: ["how far", "e don", "no be", "i wan", "make i", "how much e", "wey go"],
  },
};

const ENGLISH = new Set([
  "the", "to", "from", "how", "much", "is", "what", "where", "i", "want", "go", "bus",
  "get", "can", "please", "which", "take", "route", "my", "me", "a", "and", "of", "in",
  "for", "it", "you", "do", "does", "there", "way", "going", "need", "help", "fare",
  "price", "cost", "should", "would", "will", "best", "cheapest", "fastest", "am",
]);

// Orthography that only (or mostly) appears in one language. Checked on the
// NFD-decomposed raw text: a letter followed by U+0323 (dot below) etc.
const MARKS: Record<Exclude<LangCode, "en" | "pcm">, RegExp> = {
  yo: /[es]\u0323|[aeiou][\u0300\u0301]/gi, // dot-below e/s, tone-marked vowels
  ig: /[iu]\u0323|n\u0307/gi, // dot-below i/u, n with dot above
  ha: /[ƙɗɓƴ]/gi, // hooked letters (they don't decompose)
};

export type LanguageScores = Record<LangCode, number>;

/** Per-language likelihood scores (roughly: share of words that belong). */
export function scoreLanguages(text: string): LanguageScores {
  const norm = normalizeText(text);
  const tokens = norm.trim().split(" ").filter(Boolean);
  const n = Math.max(tokens.length, 1);
  const decomposed = text.normalize("NFD");

  const scores = { en: 0, pcm: 0, yo: 0, ig: 0, ha: 0 } as LanguageScores;
  for (const lang of Object.keys(LEXICON) as Array<keyof typeof LEXICON>) {
    const lex = LEXICON[lang];
    const strong = new Set(lex.strong);
    const weak = new Set(lex.weak);
    let points = 0;
    for (const t of tokens) {
      if (strong.has(t)) points += 2;
      else if (weak.has(t)) points += 0.6;
    }
    for (const p of lex.phrases ?? []) if (norm.includes(` ${p} `)) points += 3;
    if (lang !== "pcm") {
      const marks = decomposed.match(MARKS[lang as keyof typeof MARKS]);
      if (marks) points += Math.min(marks.length, n) * 1.5;
    }
    scores[lang] = points / n;
  }
  scores.en = tokens.filter((t) => ENGLISH.has(t)).length / n;
  return scores;
}

/**
 * Best guess at the language of a piece of text. English is the fallback for
 * anything that doesn't clearly read as a Nigerian language; Pidgin needs at
 * least one unmistakable Pidgin word so plain English isn't mislabelled.
 */
export function detectLanguage(text: string): { code: LangCode; confidence: number } {
  const s = scoreLanguages(text || "");
  const candidates: Array<Exclude<LangCode, "en">> = ["yo", "ig", "ha", "pcm"];
  let best: Exclude<LangCode, "en"> = "pcm";
  for (const c of candidates) if (s[c] > s[best]) best = c;

  const threshold = best === "pcm" ? 0.2 : 0.25;
  if (s[best] >= threshold) return { code: best, confidence: Math.min(1, s[best]) };
  return { code: "en", confidence: Math.min(1, s.en) };
}

/**
 * Choose between transcripts of the SAME audio produced by different language
 * models. Each model tends to write real words of its own language only when
 * the speech really is that language, so the transcript that scores highest
 * for its own model's language wins. The Pidgin-English model doubles as the
 * English one, so it also earns credit for plain English.
 */
export function pickTranscript(
  candidates: Array<{ lang: LangCode; text: string }>
): { lang: LangCode; text: string } | null {
  const usable = candidates.filter((c) => c.text.trim());
  if (!usable.length) return null;

  let best = usable[0];
  let bestScore = -1;
  for (const c of usable) {
    const s = scoreLanguages(c.text);
    const own = c.lang === "pcm" || c.lang === "en" ? Math.max(s.pcm, s.en * 0.7) : s[c.lang];
    if (own > bestScore) {
      best = c;
      bestScore = own;
    }
  }
  // Nothing reads convincingly as any language: trust the general
  // Pidgin-English model, which copes best with mixed/accented English.
  if (bestScore < 0.15) best = usable.find((c) => c.lang === "pcm" || c.lang === "en") ?? best;

  if (best.lang === "pcm" || best.lang === "en") {
    const code = detectLanguage(best.text).code;
    return { lang: code === "pcm" ? "pcm" : "en", text: best.text };
  }
  return best;
}
