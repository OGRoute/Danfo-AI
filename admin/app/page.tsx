import { redirect } from "next/navigation";
import { signedIn } from "../lib/auth";
import { fetchOverview, type Overview } from "../lib/data";

export const dynamic = "force-dynamic";

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
};
const th: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 600,
  fontSize: 11.5,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
  padding: "0 10px 6px 0",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "7px 10px 7px 0",
  borderTop: "1px solid var(--border)",
  verticalAlign: "top",
};

const naira = (f?: [number, number]) =>
  !f ? "—" : f[0] === f[1] ? `₦${f[0].toLocaleString()}` : `₦${f[0].toLocaleString()}–${f[1].toLocaleString()}`;

const ago = (ms: number) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/** Rider corrections are stored as a small JSON payload; show them as English. */
function readDetail(detail: string): string {
  try {
    const d = JSON.parse(detail);
    const bits: string[] = [];
    if (d.rating) bits.push(d.rating === "up" ? "👍 helpful" : "👎 not right");
    if (d.kind && d.kind !== "praise") bits.push(`kind: ${d.kind}`);
    if (d.mode) bits.push(d.mode);
    if (Array.isArray(d.fare)) bits.push(`paid ₦${d.fare[0]}–₦${d.fare[1]}`);
    if (d.board) bits.push(`boards: ${d.board}`);
    if (d.note) bits.push(`“${d.note}”`);
    return bits.join(" · ") || detail;
  } catch {
    return detail;
  }
}

const STATUS_MEANING: Record<string, string> = {
  ok: "trip planned",
  "need-origin": "no starting point given",
  "need-destination": "no destination given",
  "same-place": "start and end the same",
  "out-of-area": "outside Lagos coverage",
  "no-connection": "no route in the data",
  "no-trip": "not a trip question",
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ ...card, marginTop: 18 }}>
      <h2 style={{ margin: "0 0 2px", fontSize: 15 }}>{title}</h2>
      {note && <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--muted)" }}>{note}</p>}
      <div style={{ overflowX: "auto" }}>{children}</div>
    </section>
  );
}

function Dashboard({ data }: { data: Overview }) {
  const { routes, fares, feedback, questions, voice } = data;
  const operatorTotal = (fares.byMode.brt?.total ?? 0) + (fares.byMode.lamata?.total ?? 0);
  const operatorOfficial = (fares.byMode.brt?.official ?? 0) + (fares.byMode.lamata?.official ?? 0);
  const disputed = feedback.inForce.filter((o) => o.disputed);
  const applied = feedback.inForce.filter((o) => o.fare || o.board);

  return (
    <>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        }}
      >
        <Tile label="Routes" value={String(routes.count)} hint={`${routes.stops} stops · v${routes.version}`} />
        <Tile
          label="Official fares"
          value={operatorTotal ? `${Math.round((operatorOfficial / operatorTotal) * 100)}%` : "—"}
          hint={`${operatorOfficial}/${operatorTotal} BRT & LAMATA services`}
        />
        <Tile label="Rider feedback" value={String(feedback.total)} hint="recorded on 0G Chain" />
        <Tile label="Corrections in force" value={String(applied.length)} hint="changing answers now" />
        <Tile
          label="Questions answered"
          value={questions.stats.total ? `${questions.stats.planned}/${questions.stats.total}` : "—"}
          hint={`${questions.stats.unanswered} with no trip`}
        />
        <Tile
          label="Voice"
          value={voice.configured ? (voice.problem ? "problem" : "working") : "off"}
          hint={voice.problem ?? "Intron speech in and out"}
        />
      </div>

      <Section
        title="What riders have changed"
        note="A fare only replaces the published one once two or more riders report it. These are live in answers right now."
      >
        {applied.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            No correction has reached the agreement threshold yet.
          </p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Route</th>
                <th style={th}>New fare</th>
                <th style={th}>Boarding</th>
                <th style={th}>Riders</th>
                <th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {applied.map((o) => (
                <tr key={o.key}>
                  <td style={td}>{o.route ?? o.key}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{naira(o.fare)}</td>
                  <td style={td}>{o.board ?? "—"}</td>
                  <td style={td}>{o.reports}</td>
                  <td style={{ ...td, color: "var(--muted)" }}>{o.notes.slice(0, 2).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Routes riders dispute"
        note="Thumbs-down and “that route doesn’t run” reports. These are demoted in planning until checked — verify them on the ground, then fix or remove the route."
      >
        {disputed.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>Nothing disputed often enough to demote.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Route</th>
                <th style={th}>Against</th>
                <th style={th}>For</th>
                <th style={th}>What riders said</th>
              </tr>
            </thead>
            <tbody>
              {disputed.map((o) => (
                <tr key={o.key}>
                  <td style={td}>{o.route ?? o.key}</td>
                  <td style={{ ...td, color: "var(--bad)", fontWeight: 600 }}>{o.disputes}</td>
                  <td style={td}>{o.reports}</td>
                  <td style={{ ...td, color: "var(--muted)" }}>{o.notes.join(" · ") || "no note given"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Rider feedback" note={`Newest first, read from 0G Chain.${feedback.chainError ? " Chain read failed: " + feedback.chainError : ""}`}>
        {feedback.recent.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No feedback recorded yet.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Route</th>
                <th style={th}>Feedback</th>
                <th style={th}>Upvotes</th>
              </tr>
            </thead>
            <tbody>
              {feedback.recent.map((c, i) => (
                <tr key={`${c.timestamp}-${i}`}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {ago(c.timestamp * 1000)}
                  </td>
                  <td style={td}>
                    {c.from === "app" && c.to === "feedback" ? (
                      <span style={{ color: "var(--muted)" }}>no trip attached</span>
                    ) : (
                      `${c.from} → ${c.to}`
                    )}
                  </td>
                  <td style={td}>{readDetail(c.detail)}</td>
                  <td style={td}>{c.upvotes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Questions DanfoAI couldn’t answer"
        note="The best list of what to add next. Held in the app’s memory, so this is a recent sample rather than a full history — it resets when the app restarts."
      >
        {questions.unanswered.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Nothing unanswered in the current sample.
          </p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Asked</th>
                <th style={th}>Times</th>
                <th style={th}>Why no trip</th>
                <th style={th}>Last</th>
              </tr>
            </thead>
            <tbody>
              {questions.unanswered.map((q) => (
                <tr key={q.text}>
                  <td style={td}>{q.text}</td>
                  <td style={td}>{q.count}</td>
                  <td style={{ ...td, color: "var(--muted)" }}>{STATUS_MEANING[q.status] ?? q.status}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "var(--muted)" }}>{ago(q.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Fare data quality"
        note="BRT and LAMATA blue buses charge a published fare, so every one of those should be official. Danfo and keke fares are negotiated in cash and are always ranges."
      >
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, marginBottom: 14 }}>
          <thead>
            <tr>
              <th style={th}>Mode</th>
              <th style={th}>Routes</th>
              <th style={th}>Official fare</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(fares.byMode).map(([mode, m]) => (
              <tr key={mode}>
                <td style={td}>{mode}</td>
                <td style={td}>{m.total}</td>
                <td style={td}>
                  {mode === "brt" || mode === "lamata" ? (
                    <span style={{ color: m.official === m.total ? "var(--ok)" : "var(--warn)" }}>
                      {m.official}/{m.total}
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>n/a — cash fare</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {fares.operatorGaps.length > 0 && (
          <>
            <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>
              Operator services still on an estimate ({fares.operatorGaps.length})
            </h3>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
              Find these in LAMATA&apos;s published table and set an exact fare.
            </p>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {fares.operatorGaps
                .map((g) => `${g.from} → ${g.to} (${g.mode}, ${naira(g.fare)})`)
                .join(" · ")}
            </div>
          </>
        )}
      </Section>

      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 18 }}>
        Route data v{routes.version} ({routes.updatedAt}, loaded from {routes.source}) · feedback from
        0G Chain · generated {new Date(data.generatedAt).toLocaleString()}
      </p>
    </>
  );
}

export default async function AdminPage() {
  if (!signedIn()) redirect("/login");
  const { data, error } = await fetchOverview();

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 18px 56px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 21 }}>🚌 DanfoAI Admin</h1>
          <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 13 }}>
            What riders are telling us, and what to fix next.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a
            href="/"
            style={{
              border: "1.5px solid var(--border)",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
              color: "var(--text)",
            }}
          >
            Refresh
          </a>
          <form method="post" action="/api/logout">
            <button
              type="submit"
              style={{
                border: "1.5px solid var(--border)",
                borderRadius: 999,
                padding: "6px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                background: "transparent",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {error || !data ? (
        <div style={{ ...card, borderColor: "var(--bad)" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: 15, color: "var(--bad)" }}>
            Couldn&apos;t load the dashboard
          </h2>
          <p style={{ margin: 0, fontSize: 13 }}>{error}</p>
        </div>
      ) : (
        <Dashboard data={data} />
      )}
    </main>
  );
}
