import { NextRequest, NextResponse } from "next/server";
import * as stellar from "../../../lib/stellar-corrections";
import { isStellarConfigured } from "../../../lib/stellar";
import {
  submitCorrection as zgSubmit,
  getRecentCorrections as zgRecent,
} from "../../../lib/zg-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Community route corrections.
 *
 * Backed by the RouteCorrections Soroban contract on Stellar when
 * STELLAR_CORRECTIONS_CONTRACT is set; otherwise falls back to the original
 * 0G Chain contract. (0G Compute still powers the chat AI either way.)
 */
export async function GET() {
  try {
    if (isStellarConfigured()) {
      const [corrections, total] = await Promise.all([
        stellar.recent(10),
        stellar.total(),
      ]);
      return NextResponse.json({ corrections, total, chain: "stellar" });
    }
    const corrections = await zgRecent(10);
    return NextResponse.json({ corrections, chain: "0g" });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, corrections: [] },
      { status: 200 } // soft-fail so the UI still renders
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { fromStop, toStop, detail, storageHash } = await req.json();
    if (!fromStop || !toStop || !detail) {
      return NextResponse.json(
        { error: "fromStop, toStop, detail required" },
        { status: 400 }
      );
    }

    if (isStellarConfigured()) {
      const txHash = await stellar.submitCorrection(
        fromStop,
        toStop,
        detail,
        storageHash || ""
      );
      return NextResponse.json({ txHash, chain: "stellar" });
    }

    const txHash = await zgSubmit(fromStop, toStop, detail, storageHash || "");
    return NextResponse.json({ txHash, chain: "0g" });
  } catch (e) {
    console.error("/api/corrections error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Upvote a correction (Stellar only). */
export async function PATCH(req: NextRequest) {
  try {
    if (!isStellarConfigured()) {
      return NextResponse.json(
        { error: "Upvoting requires the Stellar contract" },
        { status: 400 }
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
