/**
 * Shared ethers provider/wallet for all 0G integrations.
 *
 * The public 0G Galileo testnet RPC is slow and bursty (a plain eth_chainId can
 * take several seconds). A bare `new ethers.JsonRpcProvider(url)` makes things
 * worse: ethers re-detects the network (an extra eth_chainId round-trip) and
 * uses defaults that surface as `TIMEOUT (code=TIMEOUT)` errors under load.
 *
 * This module returns a single, tuned, cached provider:
 *  - staticNetwork: never re-detect the chain id (saves a round-trip per call)
 *  - explicit, generous request timeout (configurable via RPC_TIMEOUT_MS)
 *
 * All values are overridable by env so a faster/private RPC can be dropped in.
 */
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
// 0G Galileo testnet chain id (0x40da).
const CHAIN_ID = Number(process.env.ZG_CHAIN_ID || 16602);
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 120_000);

let cachedProvider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (cachedProvider) return cachedProvider;

  const request = new ethers.FetchRequest(RPC_URL);
  request.timeout = RPC_TIMEOUT_MS;

  const network = new ethers.Network("0g-galileo-testnet", CHAIN_ID);
  cachedProvider = new ethers.JsonRpcProvider(request, network, {
    // Pin the network so ethers never issues a detection call.
    staticNetwork: network,
  });
  return cachedProvider;
}

export function getWallet(): ethers.Wallet {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing from environment");
  return new ethers.Wallet(pk, getProvider());
}

/** True when an error is (or wraps) an ethers/network timeout. */
export function isTimeoutError(e: unknown): boolean {
  const err = e as any;
  return (
    err?.code === "TIMEOUT" ||
    /timeout|timed out|ETIMEDOUT/i.test(err?.message || "")
  );
}
