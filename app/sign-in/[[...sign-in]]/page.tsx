"use client";

import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { clerkAppearance } from "../../../lib/clerk-appearance";
import { useTheme } from "../../../lib/useTheme";

/** Hosted Sign in page, themed like the rest of DanfoAI. */
export default function SignInPage() {
  const { resolved } = useTheme();
  return (
    <main className="auth">
      <div className="card">
        <h1>Sign in</h1>
        <p className="tag">Lagos danfo, BRT &amp; train routes — in your language.</p>
        <SignIn appearance={clerkAppearance(resolved === "dark")} />
        <Link href="/" className="skip">
          ← Back to DanfoAI
        </Link>
      </div>

      <style jsx>{`
        .auth {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: var(--bg);
        }
        .card {
          width: 100%;
          max-width: 420px;
          background: var(--surface);
          border: 3px solid var(--border);
          border-radius: 20px;
          padding: 28px 24px;
          text-align: center;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
        }
        h1 {
          margin: 0 0 4px;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--text);
        }
        .tag {
          margin: 0 0 16px;
          font-size: 13.5px;
          color: var(--text-muted);
        }
        .skip {
          display: inline-block;
          margin-top: 14px;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-muted);
          text-decoration: none;
        }
        .skip:hover {
          color: var(--text);
        }
      `}</style>
    </main>
  );
}
