import { NextRequest, NextResponse } from "next/server";
import * as stellar from "../../../lib/stellar-corrections";
import { isStellarConfigured } from "../../../lib/stellar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Community route corrections, backed by the Danfo registry contract on
 * Stellar. Reads are chain simulations; server-signed writes are a fallback
 * for users without a wallet (the primary path is Freighter, client-signed).
 */
export async function GET() {
  try {
    if (!isStellarConfigured()) {
      return NextResponse.json({
        corrections: [],
        total: 0,
        error: "Stellar contract not configured",
      });
    }
    const [corrections, total] = await Promise.all([
      stellar.recent(10),
      stellar.total(),
    ]);
    return NextResponse.json({ corrections, total, chain: "stellar" });
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
    const { fromStop, toStop, detail, storageHash } = await req.json();
    if (!fromStop || !toStop || !detail) {
      return NextResponse.json(
        { error: "fromStop, toStop, detail required" },
        { status: 400 }
      );
    }
    const txHash = await stellar.submitCorrection(
      fromStop,
      toStop,
      detail,
      storageHash || ""
    );
    return NextResponse.json({ txHash, chain: "stellar" });
  } catch (e) {
    console.error("/api/corrections error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Upvote a correction. */
export async function PATCH(req: NextRequest) {
  try {
    if (!isStellarConfigured()) {
      return NextResponse.json(
        { error: "Stellar contract not configured" },
        { status: 503 }
      );
    }
    const { id } = await req.json();
    if (typeof id !== "number") {
      return NextResponse.json({ error: "numeric id required" }, { status: 400 });
    }
    const txHash = await stellar.upvoteCorrection(id);
    return NextResponse.json({ txHash, chain: "stellar" });
  } catch (e) {
    console.error("/api/corrections upvote error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
