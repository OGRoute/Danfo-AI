/**
 * 0G Compute integration for DanfoAI.
 *
 * Runs LLM inference on 0G's decentralized GPU network and verifies the
 * response via processResponse() — this is what makes DanfoAI's answers
 * "verifiable & censorship-resistant" rather than a centralized API call.
 *
 * Critical rules (from 0G agent-skills):
 *  - ALWAYS call processResponse() after every inference.
 *  - processResponse param order: (providerAddress, chatID, usageData).
 *  - Extract ChatID from the response (ZG-Res-Key header first, body fallback).
 *  - ethers v6 only.
 */
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { getWallet } from "./zg-provider";

// Cache the broker across requests (init is expensive).
let brokerPromise: ReturnType<typeof createZGComputeNetworkBroker> | null = null;
let acknowledged = false;

async function getBroker() {
  if (!brokerPromise) {
    brokerPromise = createZGComputeNetworkBroker(getWallet());
  }
  return brokerPromise;
}

// 0G Compute locks funds in a PER-PROVIDER sub-account, and the network
// requires that sub-account to hold a minimum reserve (currently 1.0 0G) before
// it accepts a request. Funds flow: wallet --deposit--> main account
// --transferFund--> provider sub-account. We top the sub-account to a small
// buffer above the minimum so request fees don't dip it back under.
const MIN_BALANCE_OG = Number(process.env.COMPUTE_MIN_BALANCE_OG || 1.0);
// Fund to exactly the network minimum by default to consume the least 0G.
const TARGET_BALANCE_OG = Number(process.env.COMPUTE_TARGET_BALANCE_OG || 1.0);
// Cap the response length to reduce 0G Compute token spend per request.
const MAX_TOKENS = Number(process.env.COMPUTE_MAX_TOKENS || 512);

const ogToNeuron = (og: number) => BigInt(Math.round(og * 1e18)); // 1 0G = 1e18 neuron
const neuronToOg = (n: bigint) => Number(n) / 1e18;

// Providers we've already funded this process (avoid redundant on-chain txs).
const fundedProviders = new Set<string>();

/**
 * Make sure the provider's sub-account holds at least MIN_BALANCE_OG, creating
 * the main ledger and moving funds through it as needed. Idempotent: once the
 * sub-account meets the minimum this is a no-op (reads balance and returns).
 */
async function ensureProviderFunded(broker: any, provider: string) {
  if (fundedProviders.has(provider.toLowerCase())) return;

  const MIN = ogToNeuron(MIN_BALANCE_OG);
  const TARGET = ogToNeuron(TARGET_BALANCE_OG);

  let ledgerExists = false;
  let available = 0n; // main-account funds free to transfer to sub-accounts
  let subBalance = 0n; // this provider's locked balance
  try {
    const detail = await broker.ledger.getLedgerWithDetail();
    ledgerExists = true;
    // ledgerInfo = [total, locked, available]; infers = [provider, balance, ...][]
    available = BigInt(detail.ledgerInfo?.[2] ?? 0);
    const sub = (detail.infers ?? []).find(
      (i: any[]) => String(i[0]).toLowerCase() === provider.toLowerCase()
    );
    if (sub) subBalance = BigInt(sub[1]);
  } catch {
    ledgerExists = false; // no ledger yet
  }

  if (subBalance >= MIN) {
    fundedProviders.add(provider.toLowerCase());
    return;
  }

  const subShortfall = TARGET - subBalance; // > 0 here

  try {
    // Ensure the main account can cover the transfer. If we couldn't read the
    // ledger detail, assume nothing is available and fund the full shortfall.
    if (!ledgerExists || available < subShortfall) {
      const depositOg =
        neuronToOg(subShortfall - (ledgerExists ? available : 0n)) + 0.005;
      // Create the ledger on first use; if it already exists, top it up instead.
      try {
        await broker.ledger.addLedger(depositOg);
      } catch (e) {
        if (/already exist/i.test((e as Error).message || "")) {
          await broker.ledger.depositFund(depositOg);
        } else {
          throw e;
        }
      }
    }
    // Lock the shortfall into the provider sub-account.
    await broker.ledger.transferFund(provider, "inference", subShortfall);
    fundedProviders.add(provider.toLowerCase());
  } catch (e) {
    throw new Error(
      `Could not fund the 0G Compute sub-account for provider ${provider} to the ` +
        `required ${MIN_BALANCE_OG} 0G (currently ~${neuronToOg(subBalance).toFixed(3)} 0G). ` +
        `Make sure the wallet holds enough testnet 0G (get some from the 0G faucet), or ` +
        `pre-fund manually: 0g-compute-cli deposit --amount 2 && 0g-compute-cli ` +
        `transfer-fund --provider ${provider} --amount ${TARGET_BALANCE_OG}. ` +
        `Underlying error: ${(e as Error).message}`
    );
  }
}

/**
 * Ensure the provider sub-account is funded to the network minimum and the
 * provider is acknowledged. Call once before the first inference.
 */
export async function ensureComputeReady(providerAddress: string) {
  const broker = await getBroker();

  await ensureProviderFunded(broker, providerAddress);

  // Acknowledge the provider (only needs to happen once per provider).
  if (!acknowledged) {
    try {
      await broker.inference.acknowledgeProviderSigner(providerAddress);
    } catch (e) {
      // If it's already acknowledged the broker reverts; treat as fine.
      console.warn("acknowledge note:", (e as Error).message);
    }
    acknowledged = true;
  }
}

export interface DanfoChatResult {
  reply: string;
  chatId: string | null;
  verified: boolean;
  model: string;
  provider: string;
}

/**
 * Run a chat completion on 0G Compute and verify it.
 * `messages` follows the OpenAI chat format.
 */
export async function danfoChat(
  providerAddress: string,
  messages: { role: string; content: string }[]
): Promise<DanfoChatResult> {
  const broker = await getBroker();

  await ensureComputeReady(providerAddress);

  const { endpoint, model } = await broker.inference.getServiceMetadata(
    providerAddress
  );

  // The "content" passed to getRequestHeaders is the billed content —
  // use the last user message.
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const headers = await broker.inference.getRequestHeaders(
    providerAddress,
    lastUser
  );

  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS }),
  });

  if (!res.ok) {
    throw new Error(`0G Compute request failed: ${res.status} ${await res.text()}`);
  }

  // ChatID: header first, body fallback (per 0G critical rules).
  const headerChatId = res.headers.get("ZG-Res-Key");
  const data = await res.json();
  const bodyChatId = data.id || null;
  const chatId = headerChatId || bodyChatId;

  const reply: string = data.choices?.[0]?.message?.content ?? "";

  // Verify the response. processResponse confirms the provider's signature
  // over the output (TEE-backed). If it returns true, the answer is verified.
  let verified = false;
  try {
    if (chatId) {
      verified = Boolean(
        await broker.inference.processResponse(
          providerAddress,
          chatId,
          data.usage
        )
      );
    }
  } catch (e) {
    console.warn("processResponse failed:", (e as Error).message);
  }

  return { reply, chatId, verified, model, provider: providerAddress };
}

/** Discover a verifiable (TEE) provider. */
export async function discoverProvider(): Promise<string> {
  const explicit = process.env.PROVIDER_ADDRESS;
  if (explicit) return explicit;

  const broker = await getBroker();
  const services = await broker.inference.listService();
  // Prefer TEE-verifiable providers.
  const tee = services.find((s: any) => s.verifiability === "TeeML");
  const chosen = tee || services[0];
  if (!chosen) throw new Error("No 0G Compute providers available");
  return chosen.provider;
}
