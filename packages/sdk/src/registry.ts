/** Client for the danfo-registry contract (correction lifecycle). */
import { rpc } from "@stellar/stellar-sdk";
import { buildInvokeXdr, makeServer, simulateRead } from "./tx";
import {
  Correction,
  CorrectionKind,
  DanfoConfig,
  Reputation,
  addressToScVal,
  boolToScVal,
  bytes32ToScVal,
  decodeCorrection,
  stringToScVal,
  u32ToScVal,
} from "./types";

export class RegistryClient {
  private server: rpc.Server;

  constructor(private cfg: DanfoConfig) {
    this.server = makeServer(cfg.rpcUrl);
  }

  // ---- reads ----------------------------------------------------------------

  async total(): Promise<number> {
    return Number(await this.read("total"));
  }

  async get(id: number): Promise<Correction> {
    return decodeCorrection(await this.read("get", [u32ToScVal(id)]), id);
  }

  /** Most recent `n` corrections, newest first, with ids attached. */
  async recent(n = 10): Promise<Correction[]> {
    const [raw, count] = await Promise.all([
      this.read("recent", [u32ToScVal(n)]),
      this.total(),
    ]);
    return (raw as any[]).map((c, i) => decodeCorrection(c, count - 1 - i));
  }

  async reputation(who: string): Promise<Reputation> {
    const [submitted, accepted] = await this.read("reputation", [
      addressToScVal(who),
    ]);
    return { submitted: Number(submitted), accepted: Number(accepted) };
  }

  // ---- writes (return prepared XDR for the caller to sign) ------------------

  buildSubmitXdr(params: {
    contributor: string;
    routeId: string;
    kind: CorrectionKind;
    payloadHash: Uint8Array;
    summary: string;
  }): Promise<string> {
    return this.build(params.contributor, "submit", [
      addressToScVal(params.contributor),
      stringToScVal(params.routeId),
      u32ToScVal(params.kind),
      bytes32ToScVal(params.payloadHash),
      stringToScVal(params.summary),
    ]);
  }

  buildAttestXdr(params: {
    voter: string;
    id: number;
    approve: boolean;
  }): Promise<string> {
    return this.build(params.voter, "attest", [
      addressToScVal(params.voter),
      u32ToScVal(params.id),
      boolToScVal(params.approve),
    ]);
  }

  /** No auth on-chain; `source` just pays the fee (the crank). */
  buildFinalizeXdr(source: string, id: number): Promise<string> {
    return this.build(source, "finalize", [u32ToScVal(id)]);
  }

  // ---- plumbing -------------------------------------------------------------

  private read(method: string, args: any[] = []): Promise<any> {
    return simulateRead(
      this.server,
      this.cfg.networkPassphrase,
      this.cfg.readSource,
      this.cfg.registryId,
      method,
      args
    );
  }

  private build(source: string, method: string, args: any[]): Promise<string> {
    return buildInvokeXdr(
      this.server,
      this.cfg.networkPassphrase,
      source,
      this.cfg.registryId,
      method,
      args
    );
  }
}
