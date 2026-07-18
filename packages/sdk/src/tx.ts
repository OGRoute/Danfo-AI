/**
 * Soroban transaction plumbing shared by the registry and rewards clients.
 *
 * Reads: build → simulate → decode (never submitted).
 * Writes: build → prepare (footprint) → return XDR for the caller to sign —
 * with Freighter in the browser, or a Keypair server-side via signAndSend.
 */
import {
  BASE_FEE,
  Contract,
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export function makeServer(rpcUrl: string): rpc.Server {
  return new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
}

/** Simulate a read-only contract call and return the decoded native value. */
export async function simulateRead(
  server: rpc.Server,
  networkPassphrase: string,
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<any> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed: ${sim.error}`);
  }
  const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  return retval !== undefined ? scValToNative(retval) : undefined;
}

/**
 * Build and prepare (simulate + footprint) an invocation, returning the
 * unsigned XDR. `source` must be the account that will sign.
 */
export async function buildInvokeXdr(
  server: rpc.Server,
  networkPassphrase: string,
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<string> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}

/** Submit a signed XDR and poll until it is included. Returns the tx hash. */
export async function submitSigned(
  server: rpc.Server,
  networkPassphrase: string,
  signedXdr: string
): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  return sendAndConfirm(server, tx as Transaction);
}

/** Server-side path: sign a prepared XDR with a Keypair and submit it. */
export async function signAndSend(
  server: rpc.Server,
  networkPassphrase: string,
  preparedXdr: string,
  keypair: Keypair
): Promise<string> {
  const tx = TransactionBuilder.fromXDR(preparedXdr, networkPassphrase) as Transaction;
  tx.sign(keypair);
  return sendAndConfirm(server, tx);
}

async function sendAndConfirm(server: rpc.Server, tx: Transaction): Promise<string> {
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  }
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
