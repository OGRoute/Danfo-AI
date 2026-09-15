"use client";

import { ClerkAuthProvider, LocalAuthProvider } from "../lib/useAuth";

/**
 * Client-side context providers, mounted once around the whole app.
 * `clerk` is decided in layout.tsx, which also mounts <ClerkProvider> (it has
 * to be the server component for Clerk's keyless dev mode to work).
 */
export default function Providers({
  children,
  clerk,
}: {
  children: React.ReactNode;
  clerk: boolean;
}) {
  if (clerk) return <ClerkAuthProvider>{children}</ClerkAuthProvider>;
  // No Clerk → wallet + anonymous only.
  return <LocalAuthProvider>{children}</LocalAuthProvider>;
}
