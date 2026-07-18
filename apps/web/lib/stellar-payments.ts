/**
 * Stellar payments for DanfoAI.
 *
 * This is where Stellar earns its keep: fast, near-free payments.
 *  - Fare payments: a rider pays a danfo/BRT fare in XLM.
 *  - Contributor rewards: the app tips a rider whose route correction was
 *    accepted (community-owned knowledge, actually rewarded).
 *
 * Classic Stellar payments go through Horizon (not Soroban).
 */
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Memo,
} from "@stellar/stellar-sdk";
import { getHorizonUrl, getNetworkPassphrase } from "./stellar";

function horizon(): Horizon.Server {
  const url = getHorizonUrl();
  return new Horizon.Server(url, { allowHttp: url.startsWith("http://") });
}

function appKeypair(): Keypair {
  const secret = process.env.STELLAR_SECRET;
  if (!secret) throw new Error("STELLAR_SECRET is not set");
  return Keypair.fromSecret(secret);
}

/** XLM balance of an account, as a string (e.g. "10000.0000000"). */
export async function getBalance(publicKey: string): Promise<string> {
  const account = await horizon().loadAccount(publicKey);
  const native = account.balances.find((b: any) => b.asset_type === "native");
  return native ? native.balance : "0";
}

/**
 * Send XLM from the app account to `destination`.
 * Used for contributor rewards (and as the fare-settlement primitive).
 */
export async function pay(
  destination: string,
  amount: string,
  memo?: string
): Promise<string> {
  const server = horizon();
  const kp = appKeypair();
  const source = await server.loadAccount(kp.publicKey());

  const builder = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount,
      })
    )
    .setTimeout(60);

  // Memos are capped at 28 bytes on Stellar.
  if (memo) builder.addMemo(Memo.text(memo.slice(0, 28)));

  const tx = builder.build();
  tx.sign(kp);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

/** Reward a contributor whose correction was accepted. */
export async function rewardContributor(
  contributor: string,
  amount = process.env.STELLAR_REWARD_AMOUNT || "1"
): Promise<string> {
  return pay(contributor, amount, "DanfoAI reward");
}

/**
 * Build an UNSIGNED fare-payment transaction (XDR) for a rider to sign in
 * Freighter. The rider pays the app/operator account.
 */
export async function buildFarePaymentXdr(
  riderPublicKey: string,
  amount: string,
  memo = "DanfoAI fare"
): Promise<string> {
  const server = horizon();
  const source = await server.loadAccount(riderPublicKey);
  const operator =
    process.env.STELLAR_FARE_DESTINATION || appKeypair().publicKey();

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      Operation.payment({
        destination: operator,
        asset: Asset.native(),
        amount,
      })
    )
    .addMemo(Memo.text(memo.slice(0, 28)))
    .setTimeout(120)
    .build();

  return tx.toXDR();
}

/** Submit a transaction that was signed client-side (e.g. by Freighter). */
export async function submitSignedXdr(signedXdr: string): Promise<string> {
  const server = horizon();
  const tx = TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase());
  const res = await server.submitTransaction(tx as any);
  return res.hash;
}
