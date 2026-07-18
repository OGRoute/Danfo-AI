import { config } from "dotenv";
config({ path: ".env.local" });
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);
  const services = await broker.inference.listService();
  console.log("Found", services.length, "providers:\n");
  for (const s of services) {
    console.log({
      provider: s.provider,
      model: s.model,
      serviceType: s.serviceType,
      verifiability: s.verifiability,
      url: s.url,
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
