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

type Broker = Awaited<ReturnType<typeof createZGComputeNetworkBroker>>;

// Cache the broker across requests (init is expensive).
let brokerPromise: Promise<Broker> | null = null;
const acknowledgedProviders = new Set<string>();

/** Shared, cost-capped broker for every 0G Compute call (chat + speech). */
export async function getComputeBroker(): Promise<Broker> {
  if (!brokerPromise) {
    brokerPromise = createZGComputeNetworkBroker(getWallet()).then((broker) => {
      capAutoTopUp(broker);
      return broker;
    });
  }
  return brokerPromise;
}

// 0G Compute locks funds in a PER-PROVIDER sub-account. Funds flow:
// wallet --deposit--> main ledger --transferFund--> provider sub-account.
//
// The contract itself only needs a small balance (LedgerManager on Galileo
// testnet: MIN_ACCOUNT_BALANCE 0.1 0G, MIN_TRANSFER_AMOUNT 0.01 0G). What costs
// money is the SDK's own automation, which would:
//   - transfer 1 0G whenever a provider sub-account doesn't exist yet, and
//   - inside getRequestHeaders(), try to keep the sub-account topped up to
//     2,000,000 × (input + output price per token) — about 8.8 0G for the
//     current testnet chatbot — whenever it holds less than half of that.
// So we create and fund the sub-account ourselves with a small balance, turn
// the SDK's automatic top-up off (capAutoTopUp), and re-check the balance
// periodically, topping it back up in small steps when it runs low.
const MIN_BALANCE_OG = Number(process.env.COMPUTE_MIN_BALANCE_OG || 0.2);
const TARGET_BALANCE_OG = Math.max(
  Number(process.env.COMPUTE_TARGET_BALANCE_OG || 0.5),
  MIN_BALANCE_OG + 0.05
);
// Room for a detailed, step-by-step route answer (≈0.003 0G of output at
// current testnet prices).
const MAX_TOKENS = Number(process.env.COMPUTE_MAX_TOKENS || 900);
// How often to re-read the sub-account balance while requests keep flowing.
const BALANCE_RECHECK_MS = 10 * 60_000;

const ogToNeuron = (og: number) => BigInt(Math.round(og * 1e18)); // 1 0G = 1e18 neuron
const neuronToOg = (n: bigint) => Number(n) / 1e18;

/**
 * Disable the SDK's automatic sub-account top-up. The thresholds are plain
 * fields on the broker's request processor; with both at zero the SDK never
 * moves funds for an existing account, leaving funding to ensureProviderFunded.
 */
function capAutoTopUp(broker: Broker) {
  const processor = (broker.inference as any)?.requestProcessor;
  if (processor && "topUpTriggerThreshold" in processor && "topUpTargetThreshold" in processor) {
    processor.topUpTriggerThreshold = 0n;
    processor.topUpTargetThreshold = 0n;
  } else {
    console.warn(
      "0G broker internals changed: couldn't disable the SDK's automatic sub-account " +
        "top-up, so it may lock more 0G than COMPUTE_TARGET_BALANCE_OG."
    );
  }
}

// When each provider's balance was last confirmed healthy.
const balanceCheckedAt = new Map<string, number>();

/**
 * Make sure the provider's sub-account holds at least MIN_BALANCE_OG, creating
 * the main ledger and moving funds through it as needed. Cheap when healthy:
 * one balance read every BALANCE_RECHECK_MS.
 */
async function ensureProviderFunded(broker: Broker, provider: string) {
  const key = provider.toLowerCase();
  const checked = balanceCheckedAt.get(key);
  if (checked && Date.now() - checked < BALANCE_RECHECK_MS) return;

  const MIN = ogToNeuron(MIN_BALANCE_OG);
  const TARGET = ogToNeuron(TARGET_BALANCE_OG);

  // Funds locked for this provider; a sub-account that doesn't exist reads as 0.
  let subBalance = 0n;
  try {
    const account = await broker.inference.getAccount(provider);
    subBalance = BigInt(account.balance) - BigInt(account.pendingRefund);
  } catch {
    subBalance = 0n;
  }

  if (subBalance >= MIN) {
    balanceCheckedAt.set(key, Date.now());
    return;
  }

  const shortfall = TARGET - subBalance; // > 0 here
  try {
    let available: bigint | null = null; // null = no main ledger yet
    try {
      const ledger = await broker.ledger.getLedger();
      available = BigInt(ledger.availableBalance);
    } catch {
      available = null;
    }

    // Deposit only what the transfer needs (plus a little dust for rounding).
    if (available === null) {
      await broker.ledger.addLedger(neuronToOg(shortfall) + 0.005);
    } else if (available < shortfall) {
      await broker.ledger.depositFund(neuronToOg(shortfall - available) + 0.005);
    }

    await broker.ledger.transferFund(provider, "inference", shortfall);
    balanceCheckedAt.set(key, Date.now());
  } catch (e) {
    throw new Error(
      `Could not fund the 0G Compute sub-account for provider ${provider} to ` +
        `${TARGET_BALANCE_OG} 0G (currently ~${neuronToOg(subBalance).toFixed(3)} 0G). ` +
        `Make sure the wallet holds enough testnet 0G (get some from the 0G faucet), or ` +
        `pre-fund manually: 0g-compute-cli deposit --amount 1 && 0g-compute-cli ` +
        `transfer-fund --provider ${provider} --amount ${TARGET_BALANCE_OG}. ` +
        `Underlying error: ${(e as Error).message}`
    );
  }
}

/**
 * Ensure the provider sub-account is funded and the provider is acknowledged.
 * Funding MUST come first: acknowledging a provider with no sub-account makes
 * the SDK transfer a full 1 0G on its own.
 */
export async function ensureComputeReady(providerAddress: string) {
  const broker = await getComputeBroker();

  await ensureProviderFunded(broker, providerAddress);

  const key = providerAddress.toLowerCase();
  if (!acknowledgedProviders.has(key)) {
    try {
      await broker.inference.acknowledgeProviderSigner(providerAddress);
    } catch (e) {
      // If it's already acknowledged the broker reverts; treat as fine.
      console.warn("acknowledge note:", (e as Error).message);
    }
    acknowledgedProviders.add(key);
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
  messages: { role: string; content: string }[],
  options: { temperature?: number } = {}
): Promise<DanfoChatResult> {
  const broker = await getComputeBroker();

  await ensureComputeReady(providerAddress);

  const { endpoint, model } = await broker.inference.getServiceMetadata(
    providerAddress
  );

  // The "content" passed to getRequestHeaders is the billed content —
  // use the last user message.
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";

  const send = async () => {
    // Request headers are single-use, so build fresh ones for every attempt.
    const headers = await broker.inference.getRequestHeaders(providerAddress, lastUser);
    return fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: MAX_TOKENS,
        // Low temperature: stick to the computed trip plan instead of improvising.
        temperature: options.temperature ?? 0.3,
      }),
    });
  };

  let res = await send();
  if (!res.ok) {
    const detail = await res.text();
    // The balance is only re-read every few minutes; if the provider says it
    // ran out in between, top up once and retry.
    if (!/insufficient|balance/i.test(detail)) {
      throw new Error(`0G Compute request failed: ${res.status} ${detail}`);
    }
    balanceCheckedAt.delete(providerAddress.toLowerCase());
    await ensureProviderFunded(broker, providerAddress);
    res = await send();
    if (!res.ok) {
      throw new Error(`0G Compute request failed: ${res.status} ${await res.text()}`);
    }
  }

  // ChatID: header first, body fallback (per 0G critical rules).
  const headerChatId = res.headers.get("ZG-Res-Key") || res.headers.get("zg-res-key");
  const data = await res.json();
  const bodyChatId = data.id || null;
  const chatId = headerChatId || bodyChatId;

  const reply: string = data.choices?.[0]?.message?.content ?? "";

  // Verify the response. processResponse confirms the provider's signature
  // over the output (TEE-backed) and settles the fee from the usage data.
  let verified = false;
  try {
    if (chatId) {
      verified = Boolean(
        await broker.inference.processResponse(
          providerAddress,
          chatId,
          JSON.stringify(data.usage ?? {})
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

  const broker = await getComputeBroker();
  const services = await broker.inference.listService();
  // Prefer TEE-verifiable chat providers.
  const chat = services.filter((s: any) => !s.serviceType || s.serviceType === "chatbot");
  const chosen = chat.find((s: any) => s.verifiability === "TeeML") || chat[0];
  if (!chosen) throw new Error("No 0G Compute chat providers available");
  return chosen.provider;
}
