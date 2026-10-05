import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, passwordMatches, sessionValue } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sign in with the shared dashboard password. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const attempt = String(form.get("password") ?? "");
  if (!passwordMatches(attempt)) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), { status: 303 });
  }
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
