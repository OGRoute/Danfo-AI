"use client";

import { useAuth } from "../lib/useAuth";
import TransitBackground from "./TransitBackground";
import ThemeToggle from "./ThemeToggle";

/**
 * Landing / sign-in screen shown before a session exists. Offers hosted sign-in
 * (Clerk: Google / email / …), wallet, or an explicit "continue anonymously"
 * path — no account required to use the app, in keeping with a low-friction
 * transit tool. The hosted sign-in button appears only when Clerk is configured.
 */
export default function AuthGate() {
  const {
    connectWallet,
    signIn,
    continueAnonymous,
    connecting,
    error,
    clerkEnabled,
  } = useAuth();

  return (
    <main className="gate">
      <TransitBackground />

      <div className="gate-topbar">
        <ThemeToggle />
      </div>

      <div className="card" role="dialog" aria-labelledby="gate-title">
        <div className="brandmark" aria-hidden>
          <span className="stripe" />
          <span className="stripe" />
          <span className="stripe" />
        </div>

        <h1 id="gate-title">DanfoAI</h1>
        <p className="tag">
          Lagos danfo &amp; BRT routes — ask in Yoruba, Igbo, Hausa, Pidgin or
          English.
        </p>

        {clerkEnabled && (
          <button className="btn primary" onClick={signIn}>
            Sign in or sign up
          </button>
        )}

        <button
          className={`btn ${clerkEnabled ? "wallet" : "primary"}`}
          onClick={connectWallet}
          disabled={connecting}
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
        <button className="btn ghost" onClick={continueAnonymous}>
          Continue without an account
        </button>

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}

        <p className="fineprint">
          Connecting a wallet saves your chat history &amp; notifications. Anonymous
          sessions stay on this device only.
        </p>
      </div>

      <style jsx>{`
        .gate {
          position: relative;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: var(--bg);
        }
        .gate-topbar {
          position: absolute;
          top: 16px;
          right: 16px;
          z-index: 2;
        }
        .card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 380px;
          background: var(--surface);
          border: 3px solid var(--border);
          border-radius: 20px;
          padding: 32px 28px;
          text-align: center;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
        }
        .brandmark {
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 40px;
          margin: 0 auto 14px;
        }
        .stripe {
          height: 6px;
          border-radius: 3px;
          background: var(--accent);
        }
        .stripe:nth-child(2) {
          background: #0050b3;
          width: 70%;
          margin: 0 auto 0 0;
        }
        .stripe:nth-child(3) {
          width: 85%;
          margin: 0 auto 0 0;
        }
        h1 {
          margin: 0 0 6px;
          font-size: 30px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--text);
        }
        .tag {
          margin: 0 0 24px;
          font-size: 14px;
          line-height: 1.5;
          color: var(--text-muted);
        }
        .btn {
          display: block;
          width: 100%;
          padding: 14px 16px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          border: 2px solid var(--border);
          transition: transform 0.05s ease, opacity 0.15s ease;
        }
        .btn:active {
          transform: translateY(1px);
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .btn.primary {
          background: var(--accent);
          color: var(--accent-text);
          margin-bottom: 10px;
        }
        .btn.wallet {
          background: var(--surface);
          color: var(--text);
          margin-bottom: 10px;
        }
        .btn.wallet:hover {
          background: var(--surface-hover);
        }
        .btn.ghost {
          background: transparent;
          color: var(--text);
        }
        .btn.ghost:hover {
          background: var(--surface-hover);
        }
        .btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
        .err {
          margin: 14px 0 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--danger);
        }
        .fineprint {
          margin: 18px 0 0;
          font-size: 11.5px;
          line-height: 1.5;
          color: var(--text-muted);
        }
        @media (max-width: 480px) {
          .card {
            padding: 26px 20px;
          }
          h1 {
            font-size: 26px;
          }
        }
      `}</style>
    </main>
  );
}
