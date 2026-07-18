import { config } from "dotenv";
config({ path: ".env.local" });
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const PROVIDER = "0xa48f01287233509FD694a22Bf840225062E67836"; // qwen chatbot

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  console.log("Transferring funds to provider sub-account…");
  const amount = ethers.parseEther("1.2"); // 0.05 in neuron, as bigint
  await broker.ledger.transferFund(PROVIDER, "inference", amount);
  console.log("✅ Sub-account initialized for", PROVIDER);
}
main().catch((e) => { console.error(e); process.exit(1); });