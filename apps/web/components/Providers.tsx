"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { ClerkAuthProvider, LocalAuthProvider } from "../lib/useAuth";

// Inlined at build. When present, hosted sign-in (Google / email / …) is enabled.
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/** Client-side context providers, mounted once around the whole app. */
export default function Providers({ children }: { children: React.ReactNode }) {
  if (clerkKey) {
    return (
      <ClerkProvider publishableKey={clerkKey}>
        <ClerkAuthProvider>{children}</ClerkAuthProvider>
      </ClerkProvider>
    );
  }
  // No Clerk configured → wallet + anonymous only, no ClerkProvider mounted.
  return <LocalAuthProvider>{children}</LocalAuthProvider>;
}
