/** Shared types and ScVal codecs for the Danfo contracts. */
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export enum CorrectionKind {
  Fare = 0,
  Route = 1,
  Closure = 2,
}

export enum CorrectionStatus {
  Pending = 0,
  Accepted = 1,
  Rejected = 2,
}

export interface Correction {
  /** Present when the id is known from context (recent/get). */
  id?: number;
  contributor: string;
  routeId: string;
  kind: CorrectionKind;
  /** sha256 of the off-chain JSON payload (32 bytes). */
  payloadHash: Uint8Array;
  summary: string;
  /** Stake locked at submission, in token base units. */
  stake: bigint;
  status: CorrectionStatus;
  submittedAt: number;
  finalizeAfter: number;
  approvals: number;
  rejections: number;
}

export interface Reputation {
  submitted: number;
  accepted: number;
}

/** Config every client needs. */
export interface DanfoConfig {
  rpcUrl: string;
  networkPassphrase: string;
  registryId: string;
  rewardsId?: string;
  /** Funded public key used as the source of read-only simulations. */
  readSource: string;
}

// ---- ScVal encoding helpers -------------------------------------------------

export function addressToScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

export function stringToScVal(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "string" });
}

export function u32ToScVal(n: number): xdr.ScVal {
  return nativeToScVal(n, { type: "u32" });
}

export function i128ToScVal(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" });
}

export function boolToScVal(b: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(b);
}

export function bytes32ToScVal(bytes: Uint8Array): xdr.ScVal {
  if (bytes.length !== 32) {
    throw new Error(`payload hash must be 32 bytes, got ${bytes.length}`);
  }
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

// ---- decoding ---------------------------------------------------------------

/** Map a scValToNative'd registry Correction struct into SDK shape. */
export function decodeCorrection(raw: any, id?: number): Correction {
  return {
    id,
    contributor: String(raw.contributor),
    routeId: String(raw.route_id),
    kind: Number(raw.kind) as CorrectionKind,
    payloadHash:
      raw.payload_hash instanceof Uint8Array
        ? raw.payload_hash
        : new Uint8Array(raw.payload_hash ?? []),
    summary: String(raw.summary),
    stake: BigInt(raw.stake),
    status: Number(raw.status) as CorrectionStatus,
    submittedAt: Number(raw.submitted_at),
    finalizeAfter: Number(raw.finalize_after),
    approvals: Number(raw.approvals),
    rejections: Number(raw.rejections),
  };
}
