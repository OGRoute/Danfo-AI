"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BrowserProvider } from "ethers";
import { useUser, useClerk } from "@clerk/nextjs";

type Status = "loading" | "unauthenticated" | "anonymous" | "connected";
type Method = "clerk" | "wallet" | "anonymous" | null;

interface LocalSession {
  mode: "anonymous" | "wallet";
  address?: string;
}

interface AuthValue {
  status: Status;
  method: Method;
  /** Stable key for scoping chat history / notifications (null = anonymous). */
  identityKey: string | null;
  /** Human label for the current identity. */
  displayName: string | null;
  /** Wallet address, when signed in with a wallet. */
  address: string | null;
  /** Whether hosted sign-in (Clerk: Google / email / etc.) is configured. */
  clerkEnabled: boolean;
  connecting: boolean;
  error: string | null;
  connectWallet: () => Promise<void>;
  /** Open hosted sign-in (Google / email / …). No-op if Clerk isn't configured. */
  signIn: () => void;
  continueAnonymous: () => void;
  signOut: () => void;
}

const STORAGE_KEY = "danfo-session";

const AuthContext = createContext<AuthValue | null>(null);

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getEthereum(): any {
  return typeof window !== "undefined" ? (window as any).ethereum : undefined;
}

/**
 * Shared wallet + anonymous session logic used by both provider variants.
 * (Kept separate from Clerk so it works with or without Clerk configured.)
 */
function useLocalIdentity() {
  const [local, setLocal] = useState<LocalSession | null>(null);
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback((session: LocalSession | null) => {
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — memory only */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as LocalSession;
        setLocal(s);
        if (s.mode === "wallet" && s.address) setAddress(s.address);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const continueAnonymous = useCallback(() => {
    setError(null);
    const s: LocalSession = { mode: "anonymous" };
    setLocal(s);
    persist(s);
  }, [persist]);

  const connectWallet = useCallback(async () => {
    setError(null);
    const eth = getEthereum();
    if (!eth) {
      setError(
        "No crypto wallet detected. Install MetaMask (metamask.io) and refresh, " +
          "or use another sign-in option."
      );
      return;
    }
    setConnecting(true);
    try {
      // Request accounts. Try EIP-1193 directly first (most reliable trigger of
      // the wallet popup), falling back to ethers' provider.send.
      let accounts: string[] = [];
      if (typeof eth.request === "function") {
        accounts = await eth.request({ method: "eth_requestAccounts" });
      } else {
        const provider = new BrowserProvider(eth);
        accounts = await provider.send("eth_requestAccounts", []);
      }

      const addr = accounts?.[0];
      if (!addr) {
        setError("No wallet account was authorized.");
        return;
      }

      // Client-only session (no backend to verify a signature against), so we
      // connect on account authorization alone — no second signing popup.
      setAddress(addr);
      const s: LocalSession = { mode: "wallet", address: addr };
      setLocal(s);
      persist(s);
    } catch (e: any) {
      setError(
        e?.code === 4001 || /reject|denied/i.test(e?.message || "")
          ? "Wallet connection was rejected."
          : e?.message || "Couldn't connect wallet."
      );
    } finally {
      setConnecting(false);
    }
  }, [persist]);

  const clearLocal = useCallback(() => {
    setAddress(null);
    setLocal(null);
    persist(null);
    setError(null);
  }, [persist]);

  // React to wallet account switches / disconnects.
  useEffect(() => {
    const eth = getEthereum();
    if (!eth?.on) return;
    const onAccountsChanged = (accounts: string[]) => {
      setLocal((prev) => {
        if (prev?.mode !== "wallet") return prev;
        if (!accounts?.length) {
          setAddress(null);
          persist(null);
          return null;
        }
        setAddress(accounts[0]);
        const s: LocalSession = { mode: "wallet", address: accounts[0] };
        persist(s);
        return s;
      });
    };
    eth.on("accountsChanged", onAccountsChanged);
    return () => eth.removeListener?.("accountsChanged", onAccountsChanged);
  }, [persist]);

  return {
    local,
    ready,
    address,
    connecting,
    error,
    setError,
    connectWallet,
    continueAnonymous,
    clearLocal,
  };
}

/** Compute the wallet/anonymous portion of the identity (no hosted sign-in). */
function localValue(id: ReturnType<typeof useLocalIdentity>) {
  let status: Status = id.ready ? "unauthenticated" : "loading";
  let method: Method = null;
  let identityKey: string | null = null;
  let displayName: string | null = null;

  if (id.ready) {
    if (id.local?.mode === "wallet" && id.address) {
      status = "connected";
      method = "wallet";
      identityKey = id.address;
      displayName = shorten(id.address);
    } else if (id.local?.mode === "anonymous") {
      status = "anonymous";
      method = "anonymous";
      displayName = "Guest (anonymous)";
    }
  }
  return { status, method, identityKey, displayName };
}

/** Provider used when Clerk is NOT configured (wallet + anonymous only). */
export function LocalAuthProvider({ children }: { children: React.ReactNode }) {
  const id = useLocalIdentity();

  const value = useMemo<AuthValue>(() => {
    const base = localValue(id);
    return {
      ...base,
      address: id.address,
      clerkEnabled: false,
      connecting: id.connecting,
      error: id.error,
      connectWallet: id.connectWallet,
      signIn: () => id.setError("Hosted sign-in isn't configured."),
      continueAnonymous: id.continueAnonymous,
      signOut: id.clearLocal,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id.ready, id.local, id.address, id.connecting, id.error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Provider used when Clerk IS configured (hosted sign-in + wallet + anonymous). */
export function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  const id = useLocalIdentity();
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();

  const value = useMemo<AuthValue>(() => {
    const loading = !isLoaded || !id.ready;

    // Hosted (Clerk) session takes priority over local wallet/anonymous.
    if (!loading && isSignedIn && user) {
      const name =
        user.fullName ||
        user.primaryEmailAddress?.emailAddress ||
        user.username ||
        "Account";
      return {
        status: "connected",
        method: "clerk",
        identityKey: `clerk:${user.id}`,
        displayName: name,
        address: id.address,
        clerkEnabled: true,
        connecting: id.connecting,
        error: id.error,
        connectWallet: id.connectWallet,
        signIn: () => clerk.openSignIn(),
        continueAnonymous: id.continueAnonymous,
        signOut: () => {
          id.clearLocal();
          clerk.signOut();
        },
      };
    }

    const base = loading
      ? { status: "loading" as Status, method: null, identityKey: null, displayName: null }
      : localValue(id);

    return {
      ...base,
      address: id.address,
      clerkEnabled: true,
      connecting: id.connecting,
      error: id.error,
      connectWallet: id.connectWallet,
      signIn: () => clerk.openSignIn(),
      continueAnonymous: id.continueAnonymous,
      signOut: () => {
        id.clearLocal();
        if (isSignedIn) clerk.signOut();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoaded,
    isSignedIn,
    user,
    clerk,
    id.ready,
    id.local,
    id.address,
    id.connecting,
    id.error,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an Auth provider");
  return ctx;
}
