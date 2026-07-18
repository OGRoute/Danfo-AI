/**
 * Pluggable LLM inference for Danfo.
 *
 * Talks to any OpenAI-compatible chat-completions endpoint — a hosted API
 * (Groq, Together, OpenAI, …) or a local server (Ollama, llama.cpp, vLLM).
 * The chain owns the knowledge base; inference is deliberately off-chain
 * and swappable.
 *
 * Env:
 *   INFERENCE_BASE_URL    e.g. https://api.groq.com/openai/v1 or http://localhost:11434/v1
 *   INFERENCE_API_KEY     bearer token (optional for local servers)
 *   INFERENCE_MODEL       model name at the endpoint
 *   INFERENCE_MAX_TOKENS  reply cap (default 512)
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  reply: string;
  model: string;
}

export function isInferenceConfigured(): boolean {
  return !!process.env.INFERENCE_BASE_URL;
}

export async function chatCompletion(messages: ChatMessage[]): Promise<ChatResult> {
  const base = process.env.INFERENCE_BASE_URL;
  if (!base) {
    throw new Error(
      "INFERENCE_BASE_URL is not set — point it at any OpenAI-compatible endpoint"
    );
  }
  const model = process.env.INFERENCE_MODEL || "llama-3.1-8b-instant";

  const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.INFERENCE_API_KEY
        ? { Authorization: `Bearer ${process.env.INFERENCE_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: Number(process.env.INFERENCE_MAX_TOKENS || 512),
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`inference failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.length) {
    throw new Error("inference returned no reply");
  }
  return { reply, model: data.model || model };
}
