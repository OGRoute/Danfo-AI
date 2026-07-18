/**
 * Chain-state sync. Polls the registry for new corrections and refreshes the
 * status/votes of pending ones. State lives in the Correction struct itself,
 * so no event-cursor bookkeeping is needed and the indexer heals itself after
 * downtime.
 */
import { RegistryClient } from "@danfo/sdk";
import { logger } from "./logger";
import { maxId, pendingIds, upsertCorrection } from "./db";

export async function pollOnce(registry: RegistryClient): Promise<void> {
  const total = await registry.total();

  // New corrections since the last sync.
  for (let id = maxId() + 1; id < total; id++) {
    upsertCorrection(await registry.get(id));
    logger.info({ id }, "indexed new correction");
  }

  // Refresh pending ones (votes / finalization may have changed).
  for (const id of pendingIds()) {
    upsertCorrection(await registry.get(id));
  }
}

export function startPoller(registry: RegistryClient, intervalMs: number): void {
  const run = () =>
    pollOnce(registry).catch((e) => logger.warn({ err: e.message }, "poll failed"));
  run();
  setInterval(run, intervalMs);
}
