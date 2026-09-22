import { NextRequest, NextResponse } from "next/server";
import { getRecentCorrections, submitCorrection } from "../../../lib/zg-chain";
import {
  aggregate,
  invalidateOverrides,
  type CorrectionKind,
  type CorrectionPayload,
} from "../../../lib/corrections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Rider feedback. A thumbs up or down, or a concrete correction ("the fare was
 * ₦800", "that bus boards at the other side of the bridge"). Corrections are
 * recorded on 0G Chain, then folded back into the route data by
 * lib/corrections.ts, so later answers use what riders actually paid.
 *
 * Writing on-chain costs gas from the app wallet, so submissions are rate
 * limited and capped in length.
 */
const KINDS: CorrectionKind[] = ["fare", "board", "missing", "wrong", "praise", "other"];
const MAX_NOTE = 400;
const MAX_PER_HOUR = Number(process.env.FEEDBACK_MAX_PER_HOUR || 6);
const MAX_PER_DAY = Number(process.env.FEEDBACK_MAX_PER_DAY || 200);

const recent = new Map<string, number[]>();
let dayCount = { day: new Date().toDateString(), n: 0 };

function rateLimited(ip: string): string | null {
  const today = new Date().toDateString();
  if (dayCount.day !== today) dayCount = { day: today, n: 0 };
  if (dayCount.n >= MAX_PER_DAY) return "DanfoAI has taken a lot of feedback today — please try tomorrow.";

  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 60 * 60_000);
  if (hits.length >= MAX_PER_HOUR) return "Thanks — that's a lot of feedback in one hour. Please try again later.";
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 500) recent.delete(recent.keys().next().value as string);
  return null;
}

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

function fareRange(v: unknown): [number, number] | undefined {
  const nums = Array.isArray(v) ? v : typeof v === "number" ? [v, v] : null;
  if (!nums) return undefined;
  const [lo, hi] = [Number(nums[0]), Number(nums[1] ?? nums[0])];
  if (!Number.isFinite(lo) || lo <= 0 || lo > 100_000) return undefined;
  const high = Number.isFinite(hi) && hi >= lo && hi <= 100_000 ? hi : lo;
  return [Math.round(lo), Math.round(high)];
}

/** Recent corrections and how many routes they currently change. */
export async function GET() {
  try {
    const corrections = await getRecentCorrections(50);
    const overrides = aggregate(corrections);
    return NextResponse.json({
      total: corrections.length,
      routesCorrected: [...overrides.values()].filter((o) => o.fare || o.board).length,
      recent: corrections.slice(0, 10).map((c) => ({
        from: c.fromStop,
        to: c.toStop,
        detail: c.detail,
        upvotes: c.upvotes,
        timestamp: c.timestamp,
      })),
    });
  } catch (e) {
    // Contract not deployed yet, or chain unreachable.
    return NextResponse.json({ total: 0, routesCorrected: 0, recent: [], note: (e as Error).message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] || "local").trim();
    const limit = rateLimited(ip);
    if (limit) return NextResponse.json({ error: limit }, { status: 429 });

    const rating = body?.rating === "up" || body?.rating === "down" ? body.rating : undefined;
    const kind: CorrectionKind = KINDS.includes(body?.kind) ? body.kind : rating ? "praise" : "other";
    const note = clean(body?.note, MAX_NOTE);
    const from = clean(body?.from, 60) || "app";
    const to = clean(body?.to, 60) || "feedback";
    const mode = clean(body?.mode, 20) || undefined;
    const board = clean(body?.board, 200) || undefined;
    const fare = fareRange(body?.fare);

    if (!rating && !note && !fare && !board) {
      return NextResponse.json({ error: "Tell us what to fix, or rate the answer." }, { status: 400 });
    }

    const payload: CorrectionPayload = { kind, mode, fare, board, note, rating };
    // Strip empties so the on-chain string stays small (gas).
    const detail = JSON.stringify(
      Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined && v !== ""))
    );

    try {
      const txHash = await submitCorrection(from, to, detail, "");
      invalidateOverrides();
      return NextResponse.json({ ok: true, recorded: "0g-chain", txHash });
    } catch (e) {
      // No contract configured (or the chain is down): the feedback still
      // reached us in the logs, but say plainly that it wasn't recorded.
      console.warn("feedback not recorded on chain:", (e as Error).message, detail);
      return NextResponse.json({
        ok: true,
        recorded: "none",
        note: "Saved for review, but not yet recorded on 0G Chain.",
      });
    }
  } catch (e) {
    console.error("/api/feedback error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
