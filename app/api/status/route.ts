import { NextResponse } from "next/server";
import { loadRouteKB } from "../../../lib/routes-kb";
import { intronSttProblem, isIntronConfigured } from "../../../lib/intron-speech";
import { discoverProvider, getComputeBroker } from "../../../lib/zg-compute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the app is actually running on, for the settings screen: the route
 * database in use, which voice engines are configured, and the 0G Compute
 * model answering questions. The 0G lookup hits the chain, so it's cached.
 */
const COMPUTE_CACHE_MS = 5 * 60_000;
let computeCache: { at: number; value: unknown } | null = null;

async function computeStatus() {
  if (computeCache && Date.now() - computeCache.at < COMPUTE_CACHE_MS) return computeCache.value;
  let value: unknown = { available: false };
  try {
    const provider = await discoverProvider();
    const broker = await getComputeBroker();
    const { model } = await broker.inference.getServiceMetadata(provider);
    value = { available: true, model, provider };
  } catch (e) {
    value = { available: false, error: (e as Error).message };
  }
  computeCache = { at: Date.now(), value };
  return value;
}

export async function GET() {
  const [{ kb, source }, compute] = await Promise.all([loadRouteKB(), computeStatus()]);
  const modes: Record<string, number> = {};
  for (const r of kb.routes) modes[r.mode] = (modes[r.mode] ?? 0) + 1;

  return NextResponse.json({
    routes: {
      version: kb.version,
      updatedAt: kb.updatedAt,
      count: kb.routes.length,
      stops: kb.stops.length,
      modes,
      source,
    },
    voice: {
      speechToText: isIntronConfigured() ? (intronSttProblem() ? "problem" : "intron") : "browser",
      problem: intronSttProblem(),
      textToSpeech: isIntronConfigured() ? "intron" : process.env.YARNGPT_API_URL ? "yarngpt" : "browser",
    },
    compute,
  });
}
