import { NextRequest, NextResponse } from "next/server";
import { loadRouteKB } from "../../../../lib/routes-kb";
import { getRecentCorrections } from "../../../../lib/zg-chain";
import { aggregate, overrideKey, type RouteOverride } from "../../../../lib/corrections";
import { queryStats, recentQueries, unansweredSummary } from "../../../../lib/query-log";
import { intronSttProblem, isIntronConfigured } from "../../../../lib/intron-speech";
import type { KBRoute } from "../../../../lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Everything the admin site needs in one call: rider feedback from 0G Chain
 * and what it has changed, the routes riders dispute, questions DanfoAI could
 * not answer, and how much of the fare table is an operator's published price
 * rather than an estimate.
 *
 * Read-only, and separate from the rider-facing API: the admin site runs on its
 * own deployment and calls this server-to-server with ADMIN_TOKEN.
 */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function authorised(req: NextRequest): boolean {
  if (!ADMIN_TOKEN) return false;
  const header = req.headers.get("x-admin-token") ?? "";
  const query = new URL(req.url).searchParams.get("token") ?? "";
  // Both sides are short and non-secret in length; compare in full either way.
  return header === ADMIN_TOKEN || query === ADMIN_TOKEN;
}

/** How much of the fare data is a published fare, and what still isn't. */
function fareAudit(routes: KBRoute[]) {
  const byMode: Record<string, { total: number; official: number }> = {};
  for (const r of routes) {
    const entry = (byMode[r.mode] ??= { total: 0, official: 0 });
    entry.total += 1;
    if (r.official) entry.official += 1;
  }
  // Operator services charge a published fare, so an unofficial one there is a
  // gap worth filling; danfo and keke fares are negotiated and never official.
  const operatorGaps = routes
    .filter((r) => (r.mode === "brt" || r.mode === "lamata") && !r.official)
    .map((r) => ({ from: r.from, to: r.to, mode: r.mode, fare: r.fare }));
  return { byMode, operatorGaps };
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const { kb, source } = await loadRouteKB();

  let corrections: Awaited<ReturnType<typeof getRecentCorrections>> = [];
  let chainError: string | null = null;
  try {
    corrections = await getRecentCorrections(200);
  } catch (e) {
    chainError = (e as Error).message;
  }
  const overrides = aggregate(corrections);

  // Which overrides are actually changing answers right now.
  const inForce: Array<{ key: string; route?: string } & RouteOverride> = [];
  for (const [key, o] of overrides) {
    if (!o.fare && !o.board && !o.disputed) continue;
    const match = kb.routes.find(
      (r) =>
        overrideKey(r.from, r.to, r.mode) === key || overrideKey(r.to, r.from, r.mode) === key
    );
    inForce.push({ key, route: match ? `${match.from} → ${match.to} (${match.mode})` : undefined, ...o });
  }

  const modes: Record<string, number> = {};
  for (const r of kb.routes) modes[r.mode] = (modes[r.mode] ?? 0) + 1;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    routes: {
      version: kb.version,
      updatedAt: kb.updatedAt,
      count: kb.routes.length,
      stops: kb.stops.length,
      modes,
      source,
      fareNote: kb.fareNote,
    },
    fares: fareAudit(kb.routes),
    feedback: {
      total: corrections.length,
      chainError,
      inForce: inForce.sort((a, b) => b.reports + b.disputes - (a.reports + a.disputes)),
      recent: corrections.slice(0, 60).map((c) => ({
        from: c.fromStop,
        to: c.toStop,
        detail: c.detail,
        upvotes: c.upvotes,
        timestamp: c.timestamp,
        contributor: c.contributor,
      })),
    },
    questions: {
      stats: queryStats(),
      unanswered: unansweredSummary().slice(0, 40),
      recent: recentQueries(40),
    },
    voice: {
      configured: isIntronConfigured(),
      problem: await intronSttProblem(),
    },
  });
}
