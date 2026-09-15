import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import Providers from "../components/Providers";

export const metadata: Metadata = {
  title: "DanfoAI — Lagos transit, in your language",
  description:
    "Conversational Nigerian transit agent for danfo and BRT routes, powered by 0G decentralized AI.",
  icons: { icon: "/danfoai_logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Keep the brand colour on the mobile browser chrome, per theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffd400" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1a12" },
  ],
};

/**
 * Clerk handles sign-in (Google, email, …). With keys configured it uses your
 * Clerk application; in local development without keys it runs in Clerk's
 * keyless mode (a temporary dev instance you can claim from the Clerk badge).
 * In production without keys the app falls back to wallet + anonymous only.
 */
const clerkEnabled =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  (process.env.NODE_ENV === "development" &&
    !/^(1|true)$/i.test(process.env.NEXT_PUBLIC_CLERK_KEYLESS_DISABLED || ""));

/**
 * Applied before React hydrates so the correct theme paints on first frame
 * (no flash of the wrong theme). The saved preference is "light", "dark" or
 * "system" (default); "system" resolves from the OS setting. Kept tiny and
 * dependency-free on purpose — lib/useTheme.ts takes over after hydration.
 */
const themeInitScript = `
(function () {
  var root = document.documentElement;
  try {
    var stored = localStorage.getItem("danfo-theme");
    var pref = stored === "light" || stored === "dark" ? stored : "system";
    var theme =
      pref !== "system"
        ? pref
        : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    root.setAttribute("data-theme-pref", pref);
    root.setAttribute("data-theme", theme);
  } catch (e) {
    root.setAttribute("data-theme-pref", "system");
    root.setAttribute("data-theme", "light");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const app = <Providers clerk={clerkEnabled}>{children}</Providers>;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{clerkEnabled ? <ClerkProvider>{app}</ClerkProvider> : app}</body>
    </html>
  );
}
