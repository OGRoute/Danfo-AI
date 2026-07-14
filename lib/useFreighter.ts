"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isConnected,
  requestAccess,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api";

interface UseFreighterResult {
  /** Freighter extension is installed. */
  installed: boolean;
  /** Connected Stellar public key (G…), or null. */
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Sign an XDR with Freighter and submit it via /api/stellar/pay. */
  signAndSubmit: (xdr: string) => Promise<string>;
}

const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "TESTNET";

/**
 * Freighter (Stellar browser wallet) integration.
 *
 * Lets a rider connect their Stellar account, pay fares, and receive rewards
 * for accepted route corrections.
 */
export function useFreighter(): UseFreighterResult {
  const [installed, setInstalled] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await isConnected();
        if (!alive) return;
        setInstalled(!!res?.isConnected);
        // If already authorized, surface the address without prompting.
        const addr = await getAddress();
        if (alive && addr?.address) setAddress(addr.address);
      } catch {
        if (alive) setInstalled(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const res = await requestAccess();
      if (res?.error) throw new Error(String(res.error));
      if (!res?.address) throw new Error("No Stellar account authorized.");
      setAddress(res.address);
    } catch (e: any) {
      setError(
        installed
          ? e?.message || "Couldn't connect Freighter."
          : "Freighter wallet not found. Install it from freighter.app."
      );
    } finally {
      setConnecting(false);
    }
  }, [installed]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
  }, []);

  const signAndSubmit = useCallback(
    async (xdr: string): Promise<string> => {
      const signed = await signTransaction(xdr, { networkPassphrase: undefined as any, network: NETWORK } as any);
      const signedXdr = (signed as any)?.signedTxXdr ?? signed;
      if ((signed as any)?.error) throw new Error(String((signed as any).error));

      const res = await fetch("/api/stellar/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedXdr }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Submit failed");
      return data.hash as string;
    },
    []
  );

  return {
    installed,
    address,
    connecting,
    error,
    connect,
    disconnect,
    signAndSubmit,
  };
}
