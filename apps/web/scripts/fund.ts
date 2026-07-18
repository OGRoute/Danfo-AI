import { config } from "dotenv";
config({ path: ".env.local" });
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  // Show current ledger (if any)
  try {
    const ledger = await broker.ledger.getLedger();
    console.log("Existing ledger:", ledger);
  } catch {
    console.log("No ledger yet — creating one.");
    await broker.ledger.addLedger(0.1);
    console.log("Created ledger with 0.1 0G.");
    return;
  }
  // Top up an existing ledger
  await broker.ledger.depositFund(0.1);
  console.log("Topped up ledger by 0.1 0G.");
}
main().catch((e) => { console.error(e); process.exit(1); });