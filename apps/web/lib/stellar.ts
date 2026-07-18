/**
 * Stellar / Soroban configuration for DanfoAI.
 *
 * The community corrections registry runs as a Soroban smart contract on
 * Stellar (testnet by default). Stellar owns the corrections ledger, stakes,
 * rewards, and payments; AI inference is off-chain and pluggable.
 *
 * Env is read lazily (not at module load) so it works regardless of when the
 * environment is populated.
 */
import { rpc, Networks } from "@stellar/stellar-sdk";

export function getRpcUrl(): string {
  return process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
}

export function getNetworkPassphrase(): string {
  return process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
}

/** Deployed danfo-registry contract id (C…). */
export function getRegistryContractId(): string {
  return (
    process.env.NEXT_PUBLIC_REGISTRY_CONTRACT ||
    process.env.REGISTRY_CONTRACT ||
    ""
  );
}

/** Deployed danfo-rewards contract id (C…), optional. */
export function getRewardsContractId(): string {
  return (
    process.env.NEXT_PUBLIC_REWARDS_CONTRACT ||
    process.env.REWARDS_CONTRACT ||
    ""
  );
}

/** Indexer REST base URL — reads prefer it over chain simulations when set. */
export function getIndexerUrl(): string {
  return process.env.NEXT_PUBLIC_INDEXER_URL || process.env.INDEXER_URL || "";
}

/** Horizon URL (classic operations like payments). */
export function getHorizonUrl(): string {
  return process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
}

export function getRpcServer(): rpc.Server {
  const url = getRpcUrl();
  return new rpc.Server(url, { allowHttp: url.startsWith("http://") });
}

export function isStellarConfigured(): boolean {
  return !!getRegistryContractId();
}
