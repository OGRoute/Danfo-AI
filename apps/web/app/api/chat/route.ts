import { NextRequest, NextResponse } from "next/server";
import { chatCompletion } from "../../../lib/inference";
import { loadRouteKB } from "../../../lib/routes-kb";
import { buildSystemPrompt } from "../../../lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 });
    }

    const { kb, source } = await loadRouteKB();
    const system = buildSystemPrompt(kb);

    const fullMessages = [
      { role: "system" as const, content: system },
      ...messages.map((m: any) => ({ role: m.role, content: String(m.content) })),
    ];

    const result = await chatCompletion(fullMessages);

    return NextResponse.json({
      reply: result.reply,
      model: result.model,
      kbSource: source,
    });
  } catch (e) {
    console.error("/api/chat error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "inference failed" },
      { status: 500 }
    );
  }
}
