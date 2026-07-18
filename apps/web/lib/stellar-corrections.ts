/**
 * Server-side client for the Danfo registry + rewards contracts.
 *
 * Reads run as chain simulations (or come from the indexer, see the API
 * route). Writes have two paths:
 *   - Freighter (primary): prepare an XDR here, the browser signs it, and
 *     /api/stellar/pay submits it.
 *   - App key (fallback, wallet-less users): sign with STELLAR_SECRET here.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import {
  Correction,
  CorrectionKind,
  DanfoConfig,
  RegistryClient,
  RewardsClient,
  makeServer,
  signAndSend,
} from "@danfo/sdk";
import {
  getNetworkPassphrase,
  getRegistryContractId,
  getRewardsContractId,
  getRpcUrl,
} from "./stellar";

export type { Correction };
export { CorrectionKind };

function appKeypair(): Keypair {
  const secret = process.env.STELLAR_SECRET;
  if (!secret) throw new Error("STELLAR_SECRET is not set");
  return Keypair.fromSecret(secret);
}

/** Public key used as the source for read-only simulations. */
function readSourceKey(): string {
  const pk = process.env.STELLAR_PUBLIC_KEY;
  if (pk) return pk;
  return appKeypair().publicKey();
}

function danfoCfg(): DanfoConfig {
  const registryId = getRegistryContractId();
  if (!registryId) throw new Error("registry contract is not configured");
  return {
    rpcUrl: getRpcUrl(),
    networkPassphrase: getNetworkPassphrase(),
    registryId,
    rewardsId: getRewardsContractId() || undefined,
    readSource: readSourceKey(),
  };
}

function registry(): RegistryClient {
  return new RegistryClient(danfoCfg());
}

function rewards(): RewardsClient | null {
  const cfg = danfoCfg();
  return cfg.rewardsId ? new RewardsClient(cfg) : null;
}

/** sha256 over the canonical off-chain payload for a correction. */
export function payloadHash(
  routeId: string,
  kind: CorrectionKind,
  summary: string
): Uint8Array {
  return new Uint8Array(
    createHash("sha256")
      .update(JSON.stringify({ routeId, kind, summary }))
      .digest()
  );
}

// ---- reads ------------------------------------------------------------------

export function total(): Promise<number> {
  return registry().total();
}

export function recent(n = 10): Promise<Correction[]> {
  return registry().recent(n);
}

export function reputation(who: string) {
  return registry().reputation(who);
}

export async function poolStats(): Promise<{ pool: string; totalPaid: string }> {
  const r = rewards();
  if (!r) return { pool: "0", totalPaid: "0" };
  const [pool, totalPaid] = await Promise.all([r.pool(), r.totalPaid()]);
  return { pool: pool.toString(), totalPaid: totalPaid.toString() };
}

// ---- Freighter path: prepare XDRs for the browser to sign -------------------

export function prepareSubmit(
  contributor: string,
  routeId: string,
  kind: CorrectionKind,
  summary: string
): Promise<string> {
  return registry().buildSubmitXdr({
    contributor,
    routeId,
    kind,
    payloadHash: payloadHash(routeId, kind, summary),
    summary,
  });
}

export function prepareAttest(
  voter: string,
  id: number,
  approve: boolean
): Promise<string> {
  return registry().buildAttestXdr({ voter, id, approve });
}

// ---- app-key fallback path --------------------------------------------------

export async function submitCorrection(
  routeId: string,
  kind: CorrectionKind,
  summary: string
): Promise<string> {
  const kp = appKeypair();
  const xdr = await prepareSubmit(kp.publicKey(), routeId, kind, summary);
  return signAndSend(makeServer(getRpcUrl()), getNetworkPassphrase(), xdr, kp);
}

export async function attestCorrection(
  id: number,
  approve: boolean
): Promise<string> {
  const kp = appKeypair();
  const xdr = await prepareAttest(kp.publicKey(), id, approve);
  return signAndSend(makeServer(getRpcUrl()), getNetworkPassphrase(), xdr, kp);
}
