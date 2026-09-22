"use client";

import { useState } from "react";
import type { LangCode } from "../lib/language-detect";
import type { TripPlan } from "../lib/route-planner";

/**
 * Honest feedback on an answer, and the way DanfoAI learns.
 *
 * A thumbs up/down is a signal; a correction ("the fare was ₦800", "that bus
 * boards on the other side") is recorded on 0G Chain and folded back into the
 * route data, so the next rider asking the same trip gets the corrected fare.
 */
type Kind = "fare" | "board" | "missing" | "other";

interface Labels {
  ask: string;
  good: string;
  bad: string;
  report: string;
  thanks: string;
  onChain: string;
  kinds: Record<Kind, string>;
  fareLabel: string;
  notePlaceholder: string;
  send: string;
  sending: string;
  cancel: string;
}

const EN: Labels = {
  ask: "Was this right?",
  good: "Yes",
  bad: "No",
  report: "Fix something",
  thanks: "Thank you — riders like you keep the fares honest.",
  onChain: "Recorded on 0G Chain",
  kinds: {
    fare: "Fare was different",
    board: "Wrong boarding point",
    missing: "That route doesn't run",
    other: "Something else",
  },
  fareLabel: "What you actually paid (₦)",
  notePlaceholder: "What should we fix? e.g. conductor charged ₦800 at rush hour",
  send: "Send",
  sending: "Sending…",
  cancel: "Cancel",
};

const LABELS: Record<LangCode, Labels> = {
  en: EN,
  pcm: {
    ...EN,
    ask: "This one correct?",
    good: "Yes na",
    bad: "No be so",
    report: "Correct am",
    thanks: "Thank you — na people like you dey keep the fare correct.",
    kinds: {
      fare: "The fare no be so",
      board: "Na wrong bus stop",
      missing: "That road no dey run",
      other: "Another thing",
    },
    fareLabel: "Wetin you actually pay (₦)",
    notePlaceholder: "Wetin we go correct? e.g. conductor collect ₦800 for rush hour",
    send: "Send am",
  },
  yo: {
    ...EN,
    ask: "Ṣé ó tọ̀nà?",
    good: "Bẹ́ẹ̀ni",
    bad: "Bẹ́ẹ̀kọ́",
    report: "Ṣàtúnṣe",
    thanks: "A dúpẹ́ — ẹ̀yin ni ẹ ń mú kí owó ọkọ̀ tọ̀nà.",
    kinds: {
      fare: "Owó ọkọ̀ yàtọ̀",
      board: "Ibùdókọ̀ kò tọ̀nà",
      missing: "Ọ̀nà yìí kò ṣiṣẹ́ mọ́",
      other: "Nǹkan mìíràn",
    },
    fareLabel: "Owó tí o san gan-an (₦)",
    notePlaceholder: "Kí ni ká ṣàtúnṣe? àpẹẹrẹ: wọ́n gba ₦800",
    send: "Firánṣẹ́",
    sending: "Ń fi ránṣẹ́…",
    cancel: "Fagilé",
  },
  ig: {
    ...EN,
    ask: "Ọ ziri ezi?",
    good: "Ee",
    bad: "Mba",
    report: "Mezie ya",
    thanks: "Daalụ — ndị dị ka gị na-eme ka ụgwọ ụgbọ ziri ezi.",
    kinds: {
      fare: "Ụgwọ ụgbọ dị iche",
      board: "Ọdụ ụgbọ ezighi ezi",
      missing: "Ụzọ ahụ anaghị aga",
      other: "Ihe ọzọ",
    },
    fareLabel: "Ego ị kwụrụ n'ezie (₦)",
    notePlaceholder: "Gịnị ka anyị mezie? dịka: ha naara ₦800",
    send: "Zipu",
    sending: "Na-ezipu…",
    cancel: "Kagbuo",
  },
  ha: {
    ...EN,
    ask: "Wannan daidai ne?",
    good: "Eh",
    bad: "A'a",
    report: "Gyara shi",
    thanks: "Na gode — ku ne kuke sa kuɗin mota ya zama daidai.",
    kinds: {
      fare: "Kuɗin ya sha bamban",
      board: "Tashar ba daidai ba",
      missing: "Wannan hanyar ba ta aiki",
      other: "Wani abu dabam",
    },
    fareLabel: "Abin da ka biya da gaske (₦)",
    notePlaceholder: "Me za mu gyara? misali: an karɓa ₦800",
    send: "Aika",
    sending: "Ana aikawa…",
    cancel: "Soke",
  },
};

interface Props {
  /** The trip this answer was about, so a correction names the right leg. */
  plan?: TripPlan | null;
  language?: LangCode;
}

export default function FeedbackBar({ plan, language }: Props) {
  const t = LABELS[language ?? "en"] ?? EN;
  const legs = plan?.best?.legs ?? [];

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("fare");
  const [legIndex, setLegIndex] = useState(0);
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ chain: boolean; tx?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Couldn't send that.");
      setDone({ chain: data.recorded === "0g-chain", tx: data.txHash });
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function rate(rating: "up" | "down") {
    const leg = legs[0];
    send({ rating, kind: rating === "up" ? "praise" : "wrong", from: leg?.from, to: leg?.to, mode: leg?.mode });
    if (rating === "down") setOpen(true);
  }

  function submitCorrection() {
    const leg = legs[legIndex];
    const fare = low ? [Number(low), Number(high || low)] : undefined;
    send({
      kind,
      from: leg?.from,
      to: leg?.to,
      mode: leg?.mode,
      fare: kind === "fare" ? fare : undefined,
      board: kind === "board" ? note : undefined,
      note,
    });
  }

  if (done) {
    return (
      <div className="fb done">
        <span>✅ {t.thanks}</span>
        {done.chain && (
          <span className="chain">
            {done.tx ? (
              <a
                href={`https://chainscan-galileo.0g.ai/tx/${done.tx}`}
                target="_blank"
                rel="noreferrer"
              >
                {t.onChain} ↗
              </a>
            ) : (
              t.onChain
            )}
          </span>
        )}
        <style jsx>{styles}</style>
      </div>
    );
  }

  return (
    <div className="fb">
      {!open && (
        <div className="row">
          <span className="ask">{t.ask}</span>
          <button type="button" onClick={() => rate("up")} disabled={sending}>
            👍 {t.good}
          </button>
          <button type="button" onClick={() => rate("down")} disabled={sending}>
            👎 {t.bad}
          </button>
          <button type="button" className="link" onClick={() => setOpen(true)}>
            {t.report}
          </button>
        </div>
      )}

      {open && (
        <div className="form">
          {legs.length > 1 && (
            <select value={legIndex} onChange={(e) => setLegIndex(Number(e.target.value))} aria-label="Which part of the trip">
              {legs.map((l, i) => (
                <option key={i} value={i}>
                  {i + 1}. {l.from} → {l.to}
                </option>
              ))}
            </select>
          )}
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="What was wrong">
            {(Object.keys(t.kinds) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {t.kinds[k]}
              </option>
            ))}
          </select>

          {kind === "fare" && (
            <div className="fare">
              <label>{t.fareLabel}</label>
              <div className="fare-inputs">
                <input
                  inputMode="numeric"
                  value={low}
                  onChange={(e) => setLow(e.target.value.replace(/\D/g, ""))}
                  placeholder="600"
                  aria-label="Fare paid, lowest"
                />
                <span>–</span>
                <input
                  inputMode="numeric"
                  value={high}
                  onChange={(e) => setHigh(e.target.value.replace(/\D/g, ""))}
                  placeholder="800"
                  aria-label="Fare paid, highest"
                />
              </div>
            </div>
          )}

          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 400))}
            placeholder={t.notePlaceholder}
          />

          <div className="actions">
            <button type="button" className="primary" onClick={submitCorrection} disabled={sending || (!note && !low)}>
              {sending ? t.sending : t.send}
            </button>
            <button type="button" className="link" onClick={() => setOpen(false)} disabled={sending}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {error && <div className="err">{error}</div>}
      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
  .fb {
    margin-top: 8px;
    font-size: 12.5px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .ask {
    color: var(--text-muted);
    margin-right: 2px;
  }
  button {
    border: 1.5px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
    padding: 4px 10px;
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-hover);
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  button.link {
    border: 0;
    text-decoration: underline;
    color: var(--text-muted);
    padding: 4px 2px;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
    padding: 10px;
    border: 2px dashed var(--border);
    border-radius: 12px;
  }
  select,
  input,
  textarea {
    border: 2px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    padding: 7px 9px;
    width: 100%;
    resize: vertical;
  }
  .fare label {
    display: block;
    font-size: 11.5px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .fare-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .done {
    color: var(--verify-ok);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .chain a {
    color: var(--text-muted);
  }
  .err {
    margin-top: 6px;
    color: var(--danger);
  }
`;
