/**
 * 0G Chain integration for DanfoAI.
 *
 * Reads and writes community route corrections on the RouteCorrections
 * contract deployed to 0G's EVM L1 (Galileo testnet). ethers v6 only.
 */
import { ethers } from "ethers";
import { getProvider, getWallet } from "./zg-provider";

const CONTRACT_ADDRESS = process.env.CORRECTIONS_CONTRACT || "";

// Minimal ABI matching RouteCorrections.sol.
export const CORRECTIONS_ABI = [
  "function submitCorrection(string fromStop, string toStop, string detail, string storageHash) external returns (uint256)",
  "function upvote(uint256 id) external",
  "function total() external view returns (uint256)",
  "function recent(uint256 n) external view returns (tuple(address contributor,string fromStop,string toStop,string detail,string storageHash,uint256 timestamp,uint256 upvotes)[])",
  "event CorrectionSubmitted(uint256 indexed id, address indexed contributor, string fromStop, string toStop)",
];

function getSigner() {
  return getWallet();
}

function readContract() {
  if (!CONTRACT_ADDRESS) throw new Error("CORRECTIONS_CONTRACT not set");
  return new ethers.Contract(CONTRACT_ADDRESS, CORRECTIONS_ABI, getProvider());
}

function writeContract() {
  if (!CONTRACT_ADDRESS) throw new Error("CORRECTIONS_CONTRACT not set");
  return new ethers.Contract(CONTRACT_ADDRESS, CORRECTIONS_ABI, getSigner());
}

export interface Correction {
  contributor: string;
  fromStop: string;
  toStop: string;
  detail: string;
  storageHash: string;
  timestamp: number;
  upvotes: number;
}

export async function submitCorrection(
  fromStop: string,
  toStop: string,
  detail: string,
  storageHash = ""
): Promise<string> {
  const c = writeContract();
  const tx = await c.submitCorrection(fromStop, toStop, detail, storageHash);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function getRecentCorrections(n = 10): Promise<Correction[]> {
  const c = readContract();
  const rows = await c.recent(n);
  return rows.map((r: any) => ({
    contributor: r.contributor,
    fromStop: r.fromStop,
    toStop: r.toStop,
    detail: r.detail,
    storageHash: r.storageHash,
    timestamp: Number(r.timestamp),
    upvotes: Number(r.upvotes),
  }));
}

export async function totalCorrections(): Promise<number> {
  const c = readContract();
  return Number(await c.total());
}
