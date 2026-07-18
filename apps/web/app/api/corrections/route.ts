import { NextRequest, NextResponse } from "next/server";
import * as stellar from "../../../lib/stellar-corrections";
import { CorrectionKind } from "../../../lib/stellar-corrections";
import { getIndexerUrl, isStellarConfigured } from "../../../lib/stellar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Community route corrections, backed by the Danfo registry contract on
 * Stellar.
 *
 * GET    -> feed + stats (indexer-first, chain simulation fallback)
 * POST   -> submit; with `contributor` returns a prepared XDR for Freighter,
 *           without it the app key stakes and signs (wallet-less fallback)
 * PATCH  -> attest; same dual path with `voter`
 */

function parseKind(v: unknown): CorrectionKind | null {
  const n = Number(v);
  return n === 0 || n === 1 || n === 2 ? (n as CorrectionKind) : null;
}

export async function GET() {
  try {
    if (!isStellarConfigured()) {
      return NextResponse.json({
        corrections: [],
        total: 0,
        error: "Stellar contract not configured",
      });
    }

    const indexer = getIndexerUrl();
    if (indexer) {
      try {
        const [feed, statsRes] = await Promise.all([
          fetch(`${indexer}/corrections?limit=20`, { cache: "no-store" }),
          fetch(`${indexer}/stats`, { cache: "no-store" }),
        ]);
        if (feed.ok) {
          const { corrections } = await feed.json();
          const stats = statsRes.ok ? await statsRes.json() : {};
          return NextResponse.json({
            corrections: (corrections as any[]).map((r) => ({
              id: r.id,
              contributor: r.contributor,
              routeId: r.route_id,
              kind: r.kind,
              summary: r.summary,
              status: r.status,
              approvals: r.approvals,
              rejections: r.rejections,
              submittedAt: r.submitted_at,
              finalizeAfter: r.finalize_after,
            })),
            total: stats.total ?? corrections.length,
            stats,
            source: "indexer",
          });
        }
      } catch {
        /* indexer down — fall through to chain reads */
      }
    }

    const [corrections, total, stats] = await Promise.all([
      stellar.recent(20),
      stellar.total(),
      stellar.poolStats().catch(() => ({ pool: "0", totalPaid: "0" })),
    ]);
    return NextResponse.json({
      corrections: corrections.map((c) => ({
        ...c,
        stake: c.stake.toString(),
        payloadHash: undefined,
      })),
      total,
      stats,
      source: "chain",
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, corrections: [] },
      { status: 200 } // soft-fail so the UI still renders
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!isStellarConfigured()) {
      return NextResponse.json(
        { error: "Stellar contract not configured" },
        { status: 503 }
      );
    }
    const { routeId, kind, summary, contributor } = await req.json();
    const parsedKind = parseKind(kind);
    if (!routeId || !summary || parsedKind === null) {
      return NextResponse.json(
        { error: "routeId, kind (0|1|2), summary required" },
        { status: 400 }
      );
    }

    if (contributor) {
      // Freighter path: browser signs, /api/stellar/pay submits.
      const xdr = await stellar.prepareSubmit(
        contributor,
        routeId,
        parsedKind,
        summary
      );
      return NextResponse.json({ xdr });
    }

    const txHash = await stellar.submitCorrection(routeId, parsedKind, summary);
    return NextResponse.json({ txHash });
  } catch (e) {
    console.error("/api/corrections error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Attest (approve/reject) a pending correction. */
export async function PATCH(req: NextRequest) {
  try {
    if (!isStellarConfigured()) {
      return NextResponse.json(
        { error: "Stellar contract not configured" },
        { status: 503 }
      );
    }
    const { id, approve, voter } = await req.json();
    if (typeof id !== "number" || typeof approve !== "boolean") {
      return NextResponse.json(
        { error: "numeric id and boolean approve required" },
        { status: 400 }
      );
    }

    if (voter) {
      const xdr = await stellar.prepareAttest(voter, id, approve);
      return NextResponse.json({ xdr });
    }

    const txHash = await stellar.attestCorrection(id, approve);
    return NextResponse.json({ txHash });
  } catch (e) {
    console.error("/api/corrections attest error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
