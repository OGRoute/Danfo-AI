import { NextRequest, NextResponse } from "next/server";
import {
  buildFarePaymentXdr,
  submitSignedXdr,
  rewardContributor,
  getBalance,
} from "../../../../lib/stellar-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?address=G… -> XLM balance of an account. */
export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get("address");
    if (!address) {
      return NextResponse.json({ error: "address required" }, { status: 400 });
    }
    return NextResponse.json({ balance: await getBalance(address) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST body:
 *   { rider, amount }   -> build an unsigned fare-payment XDR for Freighter
 *   { signedXdr }       -> submit a Freighter-signed transaction
 *   { reward, amount? } -> reward a contributor from the app account
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.signedXdr) {
      const hash = await submitSignedXdr(body.signedXdr);
      return NextResponse.json({ hash });
    }

    if (body.rider && body.amount) {
      const xdr = await buildFarePaymentXdr(
        body.rider,
        String(body.amount),
        body.memo || "DanfoAI fare"
      );
      return NextResponse.json({ xdr });
    }

    if (body.reward) {
      const hash = await rewardContributor(body.reward, body.amount);
      return NextResponse.json({ hash });
    }

    return NextResponse.json(
      { error: "expected { rider, amount } | { signedXdr } | { reward }" },
      { status: 400 }
    );
  } catch (e) {
    console.error("/api/stellar/pay error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
