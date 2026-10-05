/**
 * A short, in-memory record of what riders asked and whether DanfoAI could
 * answer it.
 *
 * The questions that plan no trip are the most useful training signal there
 * is: they name places the route data is missing, spellings the matcher can't
 * read, and trips riders expect to exist. The admin site reads this to decide
 * what to add next.
 *
 * It lives in memory on purpose — no rider's question is written to disk or
 * on-chain. That also means each serverless instance keeps its own slice and a
 * restart clears it, so the admin site presents it as a recent sample rather
 * than analytics.
 */
export interface QueryRecord {
  at: number;
  /** The rider's question, trimmed and capped. */
  text: string;
  language: string;
  status: string;
  origin?: string;
  destination?: string;
  /** Fare of the chosen trip, when one was planned. */
  fare?: [number, number];
  legs?: number;
}

const MAX = Number(process.env.QUERY_LOG_SIZE || 200);
const MAX_TEXT = 180;
const log: QueryRecord[] = [];

export function recordQuery(entry: Omit<QueryRecord, "at">) {
  log.unshift({
    ...entry,
    text: entry.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT),
    at: Date.now(),
  });
  if (log.length > MAX) log.length = MAX;
}

export function recentQueries(limit = MAX): QueryRecord[] {
  return log.slice(0, limit);
}

/** Unanswered questions grouped by what the rider typed, commonest first. */
export function unansweredSummary(): Array<{ text: string; count: number; status: string; at: number }> {
  const groups = new Map<string, { text: string; count: number; status: string; at: number }>();
  for (const q of log) {
    if (q.status === "ok") continue;
    const key = q.text.toLowerCase();
    const hit = groups.get(key);
    if (hit) {
      hit.count += 1;
      hit.at = Math.max(hit.at, q.at);
    } else {
      groups.set(key, { text: q.text, count: 1, status: q.status, at: q.at });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.at - a.at);
}

export function queryStats() {
  const total = log.length;
  const planned = log.filter((q) => q.status === "ok").length;
  const byStatus: Record<string, number> = {};
  for (const q of log) byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
  return { total, planned, unanswered: total - planned, byStatus };
}
