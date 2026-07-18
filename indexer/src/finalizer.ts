/**
 * The crank: finalizes corrections whose challenge window has elapsed and
 * claims rewards for newly accepted ones. Earns nothing — the contracts only
 * ever move funds to recorded addresses — it just pays the fees.
 */
import { Keypair } from "@stellar/stellar-sdk";
import {
  CorrectionStatus,
  RegistryClient,
  RewardsClient,
  makeServer,
  signAndSend,
} from "@danfo/sdk";
import { config } from "./config";
import { logger } from "./logger";
import { acceptedUnclaimedIds, markClaimed, pendingIds, upsertCorrection } from "./db";

export async function crankOnce(
  registry: RegistryClient,
  rewards: RewardsClient | null
): Promise<void> {
  if (!config.crankSecret) return;
  const keypair = Keypair.fromSecret(config.crankSecret);
  const server = makeServer(config.rpcUrl);
  const source = keypair.publicKey();
  const now = Math.floor(Date.now() / 1000);

  // Finalize pending corrections whose window has elapsed.
  for (const id of pendingIds()) {
    const c = await registry.get(id);
    upsertCorrection(c);
    if (c.status !== CorrectionStatus.Pending || c.finalizeAfter > now) continue;
    try {
      const xdr = await registry.buildFinalizeXdr(source, id);
      const hash = await signAndSend(server, config.networkPassphrase, xdr, keypair);
      upsertCorrection(await registry.get(id));
      logger.info({ id, hash }, "finalized correction");
    } catch (e) {
      logger.warn({ id, err: (e as Error).message }, "finalize failed");
    }
  }

  // Claim rewards for accepted corrections (skips when the pool is short).
  if (!rewards) return;
  for (const id of acceptedUnclaimedIds()) {
    try {
      if (await rewards.isClaimed(id)) {
        markClaimed(id);
        continue;
      }
      const xdr = await rewards.buildClaimXdr(source, id);
      const hash = await signAndSend(server, config.networkPassphrase, xdr, keypair);
      markClaimed(id);
      logger.info({ id, hash }, "claimed reward");
    } catch (e) {
      logger.warn({ id, err: (e as Error).message }, "claim failed");
    }
  }
}

export function startFinalizer(
  registry: RegistryClient,
  rewards: RewardsClient | null,
  intervalMs: number
): void {
  if (!config.crankSecret) {
    logger.warn("INDEXER_SECRET_KEY unset — finalize/claim crank disabled");
    return;
  }
  const run = () =>
    crankOnce(registry, rewards).catch((e) =>
      logger.warn({ err: e.message }, "crank failed")
    );
  run();
  setInterval(run, intervalMs);
}
