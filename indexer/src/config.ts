import "dotenv/config";
import { Keypair } from "@stellar/stellar-sdk";
import type { DanfoConfig } from "@danfo/sdk";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export const config = {
  port: Number(process.env.INDEXER_PORT || 8787),
  dbPath: process.env.INDEXER_DB_PATH || "./danfo.db",
  pollMs: Number(process.env.INDEXER_POLL_MS || 10_000),
  crankMs: Number(process.env.INDEXER_CRANK_MS || 60_000),
  rpcUrl: process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org",
  networkPassphrase:
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    "Test SDF Network ; September 2015",
  registryId: required("REGISTRY_CONTRACT"),
  rewardsId: process.env.REWARDS_CONTRACT || "",
  /** Crank account. Finalize/claim cranking is disabled when unset. */
  crankSecret: process.env.INDEXER_SECRET_KEY || "",
};

export function danfoConfig(): DanfoConfig {
  return {
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    registryId: config.registryId,
    rewardsId: config.rewardsId || undefined,
    readSource: config.crankSecret
      ? Keypair.fromSecret(config.crankSecret).publicKey()
      : required("READ_SOURCE_ACCOUNT"),
  };
}
