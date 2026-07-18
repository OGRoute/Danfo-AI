/**
 * 0G Storage integration for DanfoAI.
 *
 * Stores the route knowledge base (and conversation history) on 0G's
 * decentralized storage. Data is content-addressed by a Merkle root hash,
 * so the AI provably reasons over the community's actual route data.
 *
 * Critical rules (from 0G agent-skills):
 *  - ALWAYS close ZgFile handles with file.close() in finally blocks.
 *  - Upload returns a root hash; download verifies via Merkle proof.
 *
 * NOTE: @0glabs/0g-ts-sdk is a Node SDK. These functions must run
 * server-side only (API routes / scripts), never in the browser.
 */
import { ZgFile, Indexer } from "@0glabs/0g-ts-sdk";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { getWallet } from "./zg-provider";

// Still needed for indexer.upload(), which takes the RPC URL directly.
const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";
const INDEXER_RPC =
  process.env.STORAGE_INDEXER ||
  "https://indexer-storage-testnet-turbo.0g.ai";

function getSigner() {
  return getWallet();
}

/**
 * Upload a JSON-serializable object to 0G Storage.
 * Returns the Merkle root hash (use it to retrieve later).
 */
export async function uploadJson(obj: unknown): Promise<string> {
  const signer = getSigner();
  const indexer = new Indexer(INDEXER_RPC);

  const tmpPath = join(tmpdir(), `danfo-${randomUUID()}.json`);
  await writeFile(tmpPath, JSON.stringify(obj));

  let file: ZgFile | null = null;
  try {
    file = await ZgFile.fromFilePath(tmpPath);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr) throw new Error(`merkleTree failed: ${treeErr}`);
    const rootHash = tree?.rootHash();
    if (!rootHash) throw new Error("Could not compute root hash");

    const [, uploadErr] = await indexer.upload(file, RPC_URL, signer as any);
    if (uploadErr) throw new Error(`upload failed: ${uploadErr}`);

    return rootHash;
  } finally {
    if (file) await file.close();
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Download and parse a JSON object from 0G Storage by root hash.
 * The third arg `true` enables Merkle proof verification.
 */
export async function downloadJson<T = unknown>(rootHash: string): Promise<T> {
  const indexer = new Indexer(INDEXER_RPC);
  const outPath = join(tmpdir(), `danfo-dl-${randomUUID()}.json`);

  try {
    const err = await indexer.download(rootHash, outPath, true);
    if (err) throw new Error(`download failed: ${err}`);
    const { readFile } = await import("fs/promises");
    const raw = await readFile(outPath, "utf-8");
    return JSON.parse(raw) as T;
  } finally {
    await unlink(outPath).catch(() => {});
  }
}
