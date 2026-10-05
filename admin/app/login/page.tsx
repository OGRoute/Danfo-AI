import { redirect } from "next/navigation";
import { missingConfig, signedIn } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (signedIn()) redirect("/");
  const gaps = missingConfig();

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(380px, 100%)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 24,
        }}
      >
        <div style={{ fontSize: 26, marginBottom: 2 }}>🚌</div>
        <h1 style={{ margin: "0 0 4px", fontSize: 20 }}>DanfoAI Admin</h1>
        <p style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: 13 }}>
          Rider feedback, route data quality and the questions DanfoAI couldn&apos;t answer.
        </p>

        {gaps.length > 0 && (
          <p
            style={{
              background: "rgba(180,83,9,0.12)",
              border: "1px solid var(--warn)",
              color: "var(--warn)",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 12.5,
            }}
          >
            Not configured yet — set {gaps.join(", ")} in this deployment&apos;s environment.
          </p>
        )}

        <form method="post" action="/api/login">
          <label htmlFor="password" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            style={{
              width: "100%",
              marginTop: 6,
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              font: "inherit",
            }}
          />
          {searchParams.error && (
            <p style={{ color: "var(--bad)", fontSize: 12.5, margin: "0 0 10px" }}>
              That password didn&apos;t match.
            </p>
          )}
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: 0,
              background: "var(--danfo)",
              color: "#141413",
              font: "inherit",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
