import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

/**
 * A single shared password, kept out of the URL and verified in constant time.
 *
 * The dashboard carries no rider's personal data and no write access, so a
 * password plus a signed cookie is the right weight of lock: enough that the
 * page isn't open to anyone who finds the URL, without standing up an identity
 * provider for a two-person team.
 */
const COOKIE = "danfo_admin";
const MAX_AGE_SECONDS = 12 * 60 * 60;

const secret = () => process.env.ADMIN_SESSION_SECRET || "";
const password = () => process.env.ADMIN_PASSWORD || "";

function sign(issuedAt: number): string {
  return createHmac("sha256", secret()).update(`admin:${issuedAt}`).digest("hex");
}

const equals = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function passwordMatches(attempt: string): boolean {
  return !!password() && !!attempt && equals(attempt, password());
}

export function sessionValue(): string {
  const issuedAt = Date.now();
  return `${issuedAt}.${sign(issuedAt)}`;
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE_SECONDS;

/** True when the caller holds a cookie this deployment signed and it's fresh. */
export function signedIn(): boolean {
  if (!secret() || !password()) return false;
  const raw = cookies().get(COOKIE)?.value ?? "";
  const [issuedAt, mac] = raw.split(".");
  const at = Number(issuedAt);
  if (!Number.isFinite(at) || !mac) return false;
  if (Date.now() - at > MAX_AGE_SECONDS * 1000) return false;
  return equals(mac, sign(at));
}

/** Set when the dashboard hasn't been given its password or secret yet. */
export function missingConfig(): string[] {
  const gaps: string[] = [];
  if (!password()) gaps.push("ADMIN_PASSWORD");
  if (!secret()) gaps.push("ADMIN_SESSION_SECRET");
  if (!process.env.ADMIN_TOKEN) gaps.push("ADMIN_TOKEN");
  if (!process.env.DANFO_API_BASE) gaps.push("DANFO_API_BASE");
  return gaps;
}
