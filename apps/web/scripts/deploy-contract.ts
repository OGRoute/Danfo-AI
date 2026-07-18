/**
 * Compiles and deploys RouteCorrections.sol to 0G Chain (Galileo testnet).
 * Prints the deployed address — put it in .env.local as CORRECTIONS_CONTRACT.
 *
 *   npm run deploy:contract
 *
 * Uses solc directly so there's no Hardhat/Foundry setup needed.
 * IMPORTANT: 0G Chain requires evmVersion "cancun".
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { ethers } from "ethers";
import solc from "solc";

const RPC_URL = process.env.RPC_URL || "https://evmrpc-testnet.0g.ai";

function compile() {
  const source = readFileSync(
    join(process.cwd(), "contracts", "RouteCorrections.sol"),
    "utf8"
  );

  const input = {
    language: "Solidity",
    sources: { "RouteCorrections.sol": { content: source } },
    settings: {
      evmVersion: "cancun", // REQUIRED for 0G Chain
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    const fatal = output.errors.filter((e: any) => e.severity === "error");
    output.errors.forEach((e: any) => console.log(e.formattedMessage));
    if (fatal.length) throw new Error("Compilation failed");
  }
  const c = output.contracts["RouteCorrections.sol"]["RouteCorrections"];
  return { abi: c.abi, bytecode: c.evm.bytecode.object };
}

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing from .env.local");

  console.log("Compiling RouteCorrections.sol (evmVersion: cancun)…");
  const { abi, bytecode } = compile();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(pk, provider);

  console.log("Deploying from:", wallet.address);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✅ Deployed RouteCorrections at:\n");
  console.log("   " + address + "\n");
  console.log("Add this to .env.local:");
  console.log("   CORRECTIONS_CONTRACT=" + address + "\n");
  console.log("View on explorer:");
  console.log("   https://chainscan-galileo.0g.ai/address/" + address + "\n");
}

main().catch((e) => {
  console.error("Deploy failed:", e);
  process.exit(1);
});
