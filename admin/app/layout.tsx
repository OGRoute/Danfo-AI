import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "DanfoAI Admin",
  description: "Rider feedback, route data quality and unanswered questions.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* eslint-disable-next-line react/no-unknown-property */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                color-scheme: light dark;
                --bg: #f6f6f4;
                --surface: #ffffff;
                --border: #e2e1dc;
                --text: #141413;
                --muted: #6b6a66;
                --accent: #0050b3;
                --warn: #b45309;
                --bad: #b91c1c;
                --ok: #15803d;
                --danfo: #e0b000;
              }
              @media (prefers-color-scheme: dark) {
                :root {
                  --bg: #141413;
                  --surface: #1d1d1b;
                  --border: #343431;
                  --text: #f2f2ef;
                  --muted: #9a9892;
                  --accent: #6aa6ff;
                  --warn: #f0b354;
                  --bad: #f08a84;
                  --ok: #74d49b;
                }
              }
              * { box-sizing: border-box; }
              body {
                margin: 0;
                padding: 0;
                background: var(--bg);
                color: var(--text);
                font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
              }
              a { color: var(--accent); }
              h1, h2, h3 { line-height: 1.2; }
            `,
          }}
        />
      </body>
    </html>
  );
}
