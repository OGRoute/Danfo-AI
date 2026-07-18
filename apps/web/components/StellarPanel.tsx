"use client";

import { useCallback, useEffect, useState } from "react";
import { useFreighter } from "../lib/useFreighter";

interface Correction {
  id: number;
  contributor: string;
  routeId: string;
  kind: number; // 0 Fare, 1 Route, 2 Closure
  summary: string;
  status: number; // 0 Pending, 1 Accepted, 2 Rejected
  approvals: number;
  rejections: number;
  submittedAt: number;
}

interface Stats {
  pool?: string;
  totalPaid?: string;
  accepted?: number;
  pending?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const KIND_LABELS = ["Fare", "Route", "Closure"];
const STATUS_LABELS = ["Pending", "Accepted", "Rejected"];

function shortKey(k: string): string {
  return k ? `${k.slice(0, 4)}…${k.slice(-4)}` : "";
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

function stroopsToXlm(v?: string): string {
  if (!v) return "0";
  return (Number(v) / 10_000_000).toFixed(1);
}

/**
 * Stellar panel: the staked community corrections registry (submit → attest →
 * finalize, rewards for accepted corrections), plus the Freighter wallet and
 * fare payments.
 */
export default function StellarPanel({ open, onClose }: Props) {
  const wallet = useFreighter();

  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  const [fromStop, setFromStop] = useState("");
  const [toStop, setToStop] = useState("");
  const [kind, setKind] = useState(0);
  const [summary, setSummary] = useState("");
  const [fare, setFare] = useState("2");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/corrections");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCorrections(data.corrections || []);
      setTotal(data.total ?? (data.corrections?.length || 0));
      setStats(data.stats || {});
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Refresh XLM balance when a wallet connects.
  useEffect(() => {
    if (!wallet.address) {
      setBalance(null);
      return;
    }
    fetch(`/api/stellar/pay?address=${wallet.address}`)
      .then((r) => r.json())
      .then((d) => setBalance(d.balance ?? null))
      .catch(() => setBalance(null));
  }, [wallet.address]);

  async function submit() {
    if (!fromStop.trim() || !toStop.trim() || !summary.trim()) return;
    setBusy("submit");
    setErr(null);
    setMsg(null);
    const routeId = `${slugify(fromStop)}-${slugify(toStop)}`;
    try {
      const body: Record<string, unknown> = { routeId, kind, summary };
      if (wallet.address) body.contributor = wallet.address;

      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Submit failed");

      let hash: string = data.txHash;
      if (data.xdr) {
        // Freighter path: stake comes from the connected wallet.
        hash = await wallet.signAndSubmit(data.xdr);
      }
      setMsg(`Correction staked on Stellar · tx ${shortKey(hash)}`);
      setFromStop("");
      setToStop("");
      setSummary("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function attest(id: number, approve: boolean) {
    setBusy(`vote-${id}`);
    setErr(null);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { id, approve };
      if (wallet.address) body.voter = wallet.address;

      const res = await fetch("/api/corrections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Vote failed");

      let hash: string = data.txHash;
      if (data.xdr) {
        hash = await wallet.signAndSubmit(data.xdr);
      }
      setMsg(`Vote recorded · tx ${shortKey(hash)}`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function payFare() {
    if (!wallet.address) return;
    setBusy("fare");
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/stellar/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rider: wallet.address, amount: fare }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Couldn't build payment");
      const hash = await wallet.signAndSubmit(data.xdr);
      setMsg(`Fare paid · tx ${shortKey(hash)}`);
      const b = await fetch(`/api/stellar/pay?address=${wallet.address}`).then((r) => r.json());
      setBalance(b.balance ?? balance);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Stellar">
      <header className="head">
        <div className="title">
          <strong>Community routes on Stellar</strong>
          <span className="sub">
            {total} correction{total === 1 ? "" : "s"} · reward pool{" "}
            {stroopsToXlm(stats.pool)} XLM · paid out {stroopsToXlm(stats.totalPaid)} XLM
          </span>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="body">
        {/* Wallet */}
        <section className="card">
          <h3>Stellar wallet</h3>
          {wallet.address ? (
            <div className="wallet">
              <span className="addr" title={wallet.address}>
                <span className="dot" aria-hidden /> {shortKey(wallet.address)}
              </span>
              <span className="bal">
                {balance ? `${Number(balance).toFixed(2)} XLM` : "…"}
              </span>
              <button className="btn ghost" onClick={wallet.disconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <button
              className="btn primary"
              onClick={wallet.connect}
              disabled={wallet.connecting}
            >
              {wallet.connecting ? "Connecting…" : "Connect Freighter"}
            </button>
          )}
          {wallet.error && <p className="err">{wallet.error}</p>}
        </section>

        {/* Pay a fare */}
        <section className="card">
          <h3>Pay a fare</h3>
          <p className="hint">Settle a danfo/BRT fare in XLM — fast and near-free.</p>
          <div className="row">
            <input
              className="input"
              value={fare}
              onChange={(e) => setFare(e.target.value)}
              inputMode="decimal"
              aria-label="Fare amount in XLM"
            />
            <span className="unit">XLM</span>
            <button
              className="btn primary"
              onClick={payFare}
              disabled={!wallet.address || busy === "fare"}
            >
              {busy === "fare" ? "Paying…" : "Pay fare"}
            </button>
          </div>
          {!wallet.address && <p className="hint">Connect a wallet to pay.</p>}
        </section>

        {/* Submit a correction */}
        <section className="card">
          <h3>Submit a route correction</h3>
          <p className="hint">
            Submitting stakes a small amount. The community votes during a
            24-hour window: accepted corrections refund your stake <em>and</em>{" "}
            earn a reward from the pool; spam loses its stake.
          </p>
          <div className="row">
            <input
              className="input"
              placeholder="From (e.g. CMS)"
              value={fromStop}
              onChange={(e) => setFromStop(e.target.value)}
            />
            <input
              className="input"
              placeholder="To (e.g. Oshodi)"
              value={toStop}
              onChange={(e) => setToStop(e.target.value)}
            />
            <select
              className="input kind"
              value={kind}
              onChange={(e) => setKind(Number(e.target.value))}
              aria-label="Correction type"
            >
              {KIND_LABELS.map((label, i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <input
            className="input wide"
            placeholder="What changed? (e.g. Fare now 500 naira)"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <button
            className="btn primary"
            onClick={submit}
            disabled={busy === "submit" || !fromStop || !toStop || !summary}
          >
            {busy === "submit"
              ? "Staking on Stellar…"
              : wallet.address
                ? "Stake & submit"
                : "Submit (app-sponsored)"}
          </button>
        </section>

        {/* Feed */}
        <section className="card">
          <h3>Recent corrections</h3>
          {loading && <p className="hint">Loading…</p>}
          {!loading && corrections.length === 0 && (
            <p className="hint">No corrections yet — be the first.</p>
          )}
          <ul className="feed">
            {corrections.map((c) => (
              <li key={c.id}>
                <div className="c-main">
                  <span className="route">
                    {c.routeId}{" "}
                    <span className={`chip k${c.kind}`}>{KIND_LABELS[c.kind]}</span>{" "}
                    <span className={`chip s${c.status}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </span>
                  <span className="detail">{c.summary}</span>
                  <span className="by">
                    by {shortKey(c.contributor)} ·{" "}
                    {new Date(c.submittedAt * 1000).toLocaleDateString()} ·{" "}
                    {c.approvals}✓ {c.rejections}✗
                  </span>
                </div>
                {c.status === 0 && (
                  <div className="votes">
                    <button
                      className="btn vote"
                      onClick={() => attest(c.id, true)}
                      disabled={busy === `vote-${c.id}`}
                      aria-label={`Approve correction ${c.id}`}
                    >
                      ✓
                    </button>
                    <button
                      className="btn vote"
                      onClick={() => attest(c.id, false)}
                      disabled={busy === `vote-${c.id}`}
                      aria-label={`Reject correction ${c.id}`}
                    >
                      ✗
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {msg && <p className="ok">{msg}</p>}
        {err && <p className="err">{err}</p>}
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 40;
          display: flex;
          flex-direction: column;
          background: var(--bg);
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 3px solid var(--header-border);
          background: var(--header-bg);
        }
        .title {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .title strong {
          font-size: 17px;
          color: var(--header-text);
        }
        .sub {
          font-size: 12.5px;
          color: var(--header-subtext);
        }
        .close {
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border: 2px solid var(--header-border);
          border-radius: 10px;
          background: transparent;
          color: var(--header-text);
          font-size: 16px;
          cursor: pointer;
        }
        .body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          max-width: 720px;
          width: 100%;
          margin: 0 auto;
        }
        .card {
          border: 2px solid var(--border);
          border-radius: 14px;
          background: var(--surface);
          padding: 14px;
        }
        h3 {
          margin: 0 0 6px;
          font-size: 15px;
          color: var(--text);
        }
        .hint {
          margin: 0 0 10px;
          font-size: 12.5px;
          line-height: 1.5;
          color: var(--text-muted);
        }
        .row {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .input {
          flex: 1;
          min-width: 0;
          padding: 10px 12px;
          border: 2px solid var(--border);
          border-radius: 10px;
          background: var(--bg);
          color: var(--text);
          font-size: 15px;
          outline: none;
        }
        .input.wide {
          width: 100%;
          margin-bottom: 8px;
        }
        .input.kind {
          flex: 0 1 110px;
        }
        .input:focus {
          box-shadow: 0 0 0 3px var(--ring);
        }
        .unit {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-muted);
        }
        .btn {
          border: 2px solid var(--border);
          border-radius: 10px;
          font-weight: 700;
          font-size: 14px;
          padding: 10px 14px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .btn.primary {
          background: var(--accent);
          color: var(--accent-text);
        }
        .btn.ghost {
          background: transparent;
          color: var(--text);
        }
        .btn:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .btn.vote {
          background: var(--surface-hover);
          color: var(--text);
          padding: 8px 10px;
          font-size: 13px;
        }
        .votes {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }
        .chip {
          display: inline-block;
          padding: 1px 7px;
          border-radius: 999px;
          border: 1px solid var(--border);
          font-size: 10.5px;
          font-weight: 700;
          color: var(--text-muted);
          vertical-align: middle;
        }
        .chip.s1 {
          color: var(--verify-ok);
          border-color: var(--verify-ok);
        }
        .chip.s2 {
          color: var(--danger);
          border-color: var(--danger);
        }
        .wallet {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .addr {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 13.5px;
          font-weight: 700;
          color: var(--text);
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--verify-ok);
        }
        .bal {
          font-size: 13px;
          color: var(--text-muted);
          margin-right: auto;
        }
        .feed {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .feed li {
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .c-main {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }
        .route {
          font-size: 14px;
          font-weight: 700;
          color: var(--text);
        }
        .detail {
          font-size: 13px;
          color: var(--text);
        }
        .by {
          font-size: 11px;
          color: var(--text-muted);
        }
        .ok {
          font-size: 13px;
          font-weight: 600;
          color: var(--verify-ok);
          text-align: center;
        }
        .err {
          font-size: 13px;
          font-weight: 600;
          color: var(--danger);
          text-align: center;
        }
        @media (max-width: 480px) {
          .body { padding: 12px; }
          .bal { margin-right: 0; }
        }
      `}</style>
    </div>
  );
}
