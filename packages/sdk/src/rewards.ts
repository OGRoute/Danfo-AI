/** Client for the danfo-rewards contract (sponsor pool + claims). */
import { rpc } from "@stellar/stellar-sdk";
import { buildInvokeXdr, makeServer, simulateRead } from "./tx";
import {
  DanfoConfig,
  addressToScVal,
  i128ToScVal,
  u32ToScVal,
} from "./types";

export class RewardsClient {
  private server: rpc.Server;
  private rewardsId: string;

  constructor(private cfg: DanfoConfig) {
    if (!cfg.rewardsId) throw new Error("rewardsId missing from DanfoConfig");
    this.rewardsId = cfg.rewardsId;
    this.server = makeServer(cfg.rpcUrl);
  }

  // ---- reads ----------------------------------------------------------------

  async pool(): Promise<bigint> {
    return BigInt(await this.read("pool"));
  }

  async totalPaid(): Promise<bigint> {
    return BigInt(await this.read("total_paid"));
  }

  async isClaimed(id: number): Promise<boolean> {
    return Boolean(await this.read("is_claimed", [u32ToScVal(id)]));
  }

  // ---- writes (return prepared XDR for the caller to sign) ------------------

  buildFundXdr(sponsor: string, amount: bigint): Promise<string> {
    return this.build(sponsor, "fund", [
      addressToScVal(sponsor),
      i128ToScVal(amount),
    ]);
  }

  /** No auth on-chain; pays the recorded contributor, `source` pays the fee. */
  buildClaimXdr(source: string, id: number): Promise<string> {
    return this.build(source, "claim", [u32ToScVal(id)]);
  }

  // ---- plumbing -------------------------------------------------------------

  private read(method: string, args: any[] = []): Promise<any> {
    return simulateRead(
      this.server,
      this.cfg.networkPassphrase,
      this.cfg.readSource,
      this.rewardsId,
      method,
      args
    );
  }

  private build(source: string, method: string, args: any[]): Promise<string> {
    return buildInvokeXdr(
      this.server,
      this.cfg.networkPassphrase,
      source,
      this.rewardsId,
      method,
      args
    );
  }
}
