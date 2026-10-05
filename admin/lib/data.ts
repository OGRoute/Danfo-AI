/**
 * Reads the admin view from the rider-facing app.
 *
 * The dashboard holds no database of its own: rider corrections live on 0G
 * Chain and the route data lives with the app that serves it, so this fetches
 * the live picture server-side with the shared admin token and never exposes
 * that token to the browser.
 */
export interface Overview {
  generatedAt: string;
  routes: {
    version: number;
    updatedAt: string;
    count: number;
    stops: number;
    modes: Record<string, number>;
    source: string;
    fareNote?: string;
  };
  fares: {
    byMode: Record<string, { total: number; official: number }>;
    operatorGaps: Array<{ from: string; to: string; mode: string; fare: [number, number] }>;
  };
  feedback: {
    total: number;
    chainError: string | null;
    inForce: Array<{
      key: string;
      route?: string;
      fare?: [number, number];
      board?: string;
      disputed?: boolean;
      reports: number;
      disputes: number;
      notes: string[];
    }>;
    recent: Array<{
      from: string;
      to: string;
      detail: string;
      upvotes: number;
      timestamp: number;
      contributor: string;
    }>;
  };
  questions: {
    stats: { total: number; planned: number; unanswered: number; byStatus: Record<string, number> };
    unanswered: Array<{ text: string; count: number; status: string; at: number }>;
    recent: Array<{
      at: number;
      text: string;
      language: string;
      status: string;
      origin?: string;
      destination?: string;
      fare?: [number, number];
      legs?: number;
    }>;
  };
  voice: { configured: boolean; problem: string | null };
}

export async function fetchOverview(): Promise<{ data: Overview | null; error: string | null }> {
  const base = (process.env.DANFO_API_BASE || "").replace(/\/$/, "");
  const token = process.env.ADMIN_TOKEN || "";
  if (!base || !token) return { data: null, error: "DANFO_API_BASE and ADMIN_TOKEN must be set." };
  try {
    const res = await fetch(`${base}/api/admin/overview`, {
      headers: { "x-admin-token": token },
      cache: "no-store",
    });
    if (res.status === 401) {
      return { data: null, error: "The app rejected this ADMIN_TOKEN — check both deployments use the same value." };
    }
    if (!res.ok) return { data: null, error: `${base} answered ${res.status}.` };
    return { data: (await res.json()) as Overview, error: null };
  } catch (e) {
    return { data: null, error: `Couldn't reach ${base}: ${(e as Error).message}` };
  }
}
