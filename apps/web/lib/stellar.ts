/**
 * Stellar / Soroban configuration for DanfoAI.
 *
 * The community RouteCorrections registry runs as a Soroban smart contract on
 * Stellar (testnet by default). 0G Compute still powers the chat AI — Stellar
 * handles the on-chain corrections ledger and payments.
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

/** Deployed RouteCorrections contract id (C…). */
export function getCorrectionsContractId(): string {
  return process.env.STELLAR_CORRECTIONS_CONTRACT || "";
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
  return !!getCorrectionsContractId();
}
