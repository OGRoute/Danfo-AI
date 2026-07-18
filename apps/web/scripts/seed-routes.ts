/**
 * Seeds the Lagos route knowledge base onto 0G Storage.
 * Prints the root hash — put it in .env.local as ROUTES_ROOT_HASH.
 *
 *   npm run seed
 */
import "dotenv/config";
import { uploadJson } from "../lib/zg-storage";
import seed from "../data/lagos-routes.json";

async function main() {
  console.log("Uploading route knowledge base to 0G Storage…");
  const rootHash = await uploadJson(seed);
  console.log("\n✅ Uploaded. Root hash:\n");
  console.log("   " + rootHash + "\n");
  console.log("Add this to .env.local:");
  console.log("   ROUTES_ROOT_HASH=" + rootHash + "\n");
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
