import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clerk Frontend API proxy.
 * https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi
 *
 * A Clerk *production* instance normally needs DNS records on a domain you
 * own, which isn't possible under *.vercel.app. This instance is instead
 * configured with proxy_url https://<app>/__clerk, so every request the Clerk
 * browser SDK makes to /__clerk/* is forwarded from here to Clerk's Frontend
 * API — body and headers intact, plus the three headers Clerk requires.
 *
 * /__clerk/* is rewritten to this route in next.config.js, because App Router
 * treats folders starting with "_" as private.
 * (@clerk/nextjs v7 ships createFrontendApiProxyHandlers(); this app is on v6.)
 */
// frontend-api.clerk.dev is the host that answers proxied requests;
// frontend-api.clerk.services (the CNAME target) does not.
const FRONTEND_API = (process.env.CLERK_FRONTEND_API_HOST || "frontend-api.clerk.dev")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

// Hop-by-hop headers, and ones the fetch layer must set itself.
const STRIP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
]);

async function proxy(req: NextRequest) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const proxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
  if (!secretKey || !proxyUrl) {
    return NextResponse.json(
      { error: "Clerk proxy is not configured (CLERK_SECRET_KEY / NEXT_PUBLIC_CLERK_PROXY_URL)" },
      { status: 503 }
    );
  }

  // /__clerk/v1/... and /api/clerk-proxy/v1/... both map to /v1/... upstream.
  const path = req.nextUrl.pathname.replace(/^\/(?:__clerk|api\/clerk-proxy)/, "");
  const target = `https://${FRONTEND_API}${path}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Clerk-Proxy-Url", proxyUrl);
  headers.set("Clerk-Secret-Key", secretKey);
  // Clerk needs the original end user's IP first for rate limiting and bot risk.
  const clientIp = (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "").trim();
  if (clientIp) headers.set("X-Forwarded-For", clientIp);

  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    const out = new Headers(upstream.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    out.delete("transfer-encoding");
    // Keep each Set-Cookie separate; a single joined header breaks sessions.
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    if (cookies.length) {
      out.delete("set-cookie");
      for (const cookie of cookies) out.append("set-cookie", cookie);
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  } catch (e) {
    console.error("Clerk proxy failed:", (e as Error).message);
    return NextResponse.json({ error: "Clerk proxy request failed" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
