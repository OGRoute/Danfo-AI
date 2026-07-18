/**
 * Builds the DanfoAI system prompt from the route knowledge base.
 * The KB is injected so the model grounds answers in real route data
 * (loaded from 0G Storage at runtime).
 */
export interface RouteKB {
  version: number;
  updatedAt: string;
  currency: string;
  stops: string[];
  routes: Array<{
    from: string;
    to: string;
    mode: string;
    fare: [number, number];
    via?: string[];
    notes?: string;
  }>;
  phrases?: Record<string, { greeting: string; thanks: string }>;
}

export function buildSystemPrompt(kb: RouteKB): string {
  const routeLines = kb.routes
    .map(
      (r) =>
        `- ${r.from} -> ${r.to} [${r.mode}] fare ~${r.fare[0]}-${r.fare[1]} ${kb.currency}` +
        (r.via?.length ? ` via ${r.via.join(", ")}` : "") +
        (r.notes ? ` | ${r.notes}` : "")
    )
    .join("\n");

  return `You are DanfoAI, a friendly Lagos transit agent. You help people navigate
danfo (yellow minibuses) and BRT routes across Lagos, Nigeria.

LANGUAGE RULES:
- Detect the user's language from their message: Yoruba, Igbo, Hausa, Nigerian
  Pidgin, or English — and REPLY IN THAT SAME LANGUAGE.
- Keep it natural and warm, the way a helpful conductor or local would talk.

ANSWER RULES:
- Give the best route: which danfo/BRT to take, where to change, and an
  approximate fare range. Mention landmarks/parks where helpful.
- Be concise. Lead with the route, then fare, then any tip (traffic, timing).
- If a route isn't in your data, say so honestly and suggest the closest known
  connection. Never invent specific fares you don't have — give a rough estimate
  and say it may vary.
- Fares change constantly; always note they are approximate.

KNOWLEDGE BASE (updated ${kb.updatedAt}, currency ${kb.currency}):
Known stops: ${kb.stops.join(", ")}

Known routes:
${routeLines}

This knowledge base is community-owned and lives on 0G. Riders submit
corrections that are recorded on-chain, so it keeps improving.`;
}
