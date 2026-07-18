import { NextRequest, NextResponse } from "next/server";
import { danfoChat, discoverProvider } from "../../../lib/zg-compute";
import { loadRouteKB } from "../../../lib/routes-kb";
import { buildSystemPrompt } from "../../../lib/prompt";
import { isTimeoutError } from "../../../lib/zg-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The 0G testnet RPC is slow; give the request room before the platform kills it.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 });
    }

    const { kb, source } = await loadRouteKB();
    const system = buildSystemPrompt(kb);

    const provider = await discoverProvider();

    const fullMessages = [
      { role: "system", content: system },
      ...messages.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    const result = await danfoChat(provider, fullMessages);

    return NextResponse.json({
      reply: result.reply,
      verified: result.verified,
      model: result.model,
      provider: result.provider,
      chatId: result.chatId,
      kbSource: source,
    });
  } catch (e) {
    console.error("/api/chat error:", e);
    if (isTimeoutError(e)) {
      return NextResponse.json(
        {
          error:
            "The 0G testnet is responding slowly right now — please try again in a moment.",
        },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: (e as Error).message || "inference failed" },
      { status: 500 }
    );
  }
}
