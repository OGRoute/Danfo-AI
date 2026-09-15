"use client";

import { ClerkLoaded, ClerkLoading, SignIn } from "@clerk/nextjs";
import { useAuth } from "../lib/useAuth";
import { useTheme } from "../lib/useTheme";
import TransitBackground from "./TransitBackground";
import ThemeToggle from "./ThemeToggle";

/** Clerk's sign-in card, re-skinned in DanfoAI's yellow/ink palette per theme. */
function clerkAppearance(dark: boolean) {
  return {
    variables: {
      colorPrimary: "#ffd400",
      colorTextOnPrimaryBackground: "#111111",
      colorBackground: dark ? "#1f1d16" : "#ffffff",
      colorText: dark ? "#f4f1e6" : "#111111",
      colorTextSecondary: dark ? "#b8b09a" : "#5b4a00",
      colorInputBackground: dark ? "#14130d" : "#ffffff",
      colorInputText: dark ? "#f4f1e6" : "#111111",
      colorNeutral: dark ? "#f4f1e6" : "#111111",
      borderRadius: "12px",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    },
    elements: {
      rootBox: { width: "100%" },
      cardBox: { width: "100%", boxShadow: "none", border: "none" },
      card: { boxShadow: "none", border: "none", background: "transparent", padding: "4px 0 8px" },
      // Our own heading sits above the card.
      header: { display: "none" },
      footer: { background: "transparent" },
    },
  };
}

/**
 * Landing / sign-in screen shown before a session exists. Clerk's embedded
 * sign-in (Google, email, …) comes first when Clerk is enabled; a wallet and
 * an explicit "continue without an account" path stay available — no account
 * is required to use the app, in keeping with a low-friction transit tool.
 */
export default function AuthGate() {
  const { connectWallet, continueAnonymous, connecting, error, clerkEnabled, clerkUnavailable } =
    useAuth();
  const { resolved } = useTheme();

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
          Lagos danfo, BRT &amp; train routes — ask in Yoruba, Igbo, Hausa, Pidgin or
          English.
        </p>

        {clerkEnabled && (
          <>
            <ClerkLoading>
              <div className="clerk-loading" role="status">
                {clerkUnavailable
                  ? "Google / email sign-in couldn't load — check your connection. You can still connect a wallet or continue without an account."
                  : "Loading sign-in…"}
              </div>
            </ClerkLoading>
            <ClerkLoaded>
              <div className="clerk-box">
                <SignIn routing="hash" appearance={clerkAppearance(resolved === "dark")} />
              </div>
            </ClerkLoaded>
            <div className="divider" aria-hidden>
              <span>or</span>
            </div>
          </>
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
          Signing in saves your chat history &amp; notifications. Anonymous sessions
          stay on this device only.
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
          max-width: 420px;
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
          margin: 0 0 18px;
          font-size: 14px;
          line-height: 1.5;
          color: var(--text-muted);
        }
        .clerk-box {
          display: flex;
          justify-content: center;
          text-align: left;
        }
        .clerk-loading {
          padding: 28px 0;
          font-size: 14px;
          color: var(--text-muted);
        }
        .divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 6px 0 14px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
        }
        .divider::before,
        .divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--border);
          opacity: 0.35;
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
          .gate {
            padding: 16px;
          }
          .card {
            padding: 26px 16px;
          }
          h1 {
            font-size: 26px;
          }
        }
      `}</style>
    </main>
  );
}
