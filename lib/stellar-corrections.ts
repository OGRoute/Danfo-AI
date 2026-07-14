/**
 * Client for the RouteCorrections Soroban contract on Stellar.
 *
 * Reads (total / recent) run as read-only simulations. Writes (submit / upvote)
 * are signed server-side by the app's Stellar key (STELLAR_SECRET) and sent to
 * the network — the Freighter path (user-signed) is handled client-side.
 */
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Address,
  Keypair,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  getRpcServer,
  getNetworkPassphrase,
  getCorrectionsContractId,
} from "./stellar";

export interface Correction {
  contributor: string;
  fromStop: string;
  toStop: string;
  detail: string;
  storageHash: string;
  timestamp: number;
  upvotes: number;
}

function appKeypair(): Keypair {
  const secret = process.env.STELLAR_SECRET;
  if (!secret) throw new Error("STELLAR_SECRET is not set");
  return Keypair.fromSecret(secret);
}

/** Public key used as the source for read-only simulations. */
function readSourceKey(): string {
  const pk = process.env.STELLAR_PUBLIC_KEY;
  if (pk) return pk;
  return appKeypair().publicKey();
}

function contract(): Contract {
  const id = getCorrectionsContractId();
  if (!id) throw new Error("STELLAR_CORRECTIONS_CONTRACT is not set");
  return new Contract(id);
}

/** Simulate a read-only contract call and return the decoded native value. */
async function read(method: string, args: xdr.ScVal[] = []): Promise<any> {
  const server = getRpcServer();
  const source = await server.getAccount(readSourceKey());
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract().call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed: ${sim.error}`);
  }
  return scValToNative(sim.result!.retval);
}

function mapCorrection(c: any): Correction {
  return {
    contributor: String(c.contributor),
    fromStop: c.from_stop,
    toStop: c.to_stop,
    detail: c.detail,
    storageHash: c.storage_hash,
    timestamp: Number(c.timestamp),
    upvotes: Number(c.upvotes),
  };
}

export async function total(): Promise<number> {
  return Number(await read("total"));
}

export async function recent(n = 10): Promise<Correction[]> {
  const raw = await read("recent", [nativeToScVal(n, { type: "u32" })]);
  return (raw as any[]).map(mapCorrection);
}

/** Submit a correction, signed by the app key. Returns the tx hash. */
export async function submitCorrection(
  fromStop: string,
  toStop: string,
  detail: string,
  storageHash = ""
): Promise<string> {
  const server = getRpcServer();
  const kp = appKeypair();
  const source = await server.getAccount(kp.publicKey());

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      contract().call(
        "submit",
        new Address(kp.publicKey()).toScVal(),
        nativeToScVal(fromStop, { type: "string" }),
        nativeToScVal(toStop, { type: "string" }),
        nativeToScVal(detail, { type: "string" }),
        nativeToScVal(storageHash, { type: "string" })
      )
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  return sendAndConfirm(server, prepared);
}

/** Upvote a correction, signed by the app key. */
export async function upvoteCorrection(id: number): Promise<string> {
  const server = getRpcServer();
  const kp = appKeypair();
  const source = await server.getAccount(kp.publicKey());

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      contract().call(
        "upvote",
        new Address(kp.publicKey()).toScVal(),
        nativeToScVal(id, { type: "u32" })
      )
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  return sendAndConfirm(server, prepared);
}

async function sendAndConfirm(
  server: rpc.Server,
  tx: Awaited<ReturnType<rpc.Server["prepareTransaction"]>>
): Promise<string> {
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }
  // Poll until the transaction is included.
  for (let i = 0; i < 30; i++) {
    const got = await server.getTransaction(sent.hash);
    if (got.status === "SUCCESS") return sent.hash;
    if (got.status === "FAILED") {
      throw new Error(`transaction failed: ${sent.hash}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`transaction not confirmed in time: ${sent.hash}`);
}
