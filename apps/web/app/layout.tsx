import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "../components/Providers";

export const metadata: Metadata = {
  title: "DanfoAI — Lagos transit, in your language",
  description:
    "Conversational Nigerian transit agent for danfo and BRT routes, powered by 0G decentralized AI.",
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
 * Applied before React hydrates so the correct theme paints on first frame
 * (no flash of the wrong theme). Reads a saved preference, else falls back to
 * the OS setting. Kept tiny and dependency-free on purpose.
 */
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("danfo-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
