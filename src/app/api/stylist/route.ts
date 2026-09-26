import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";
import { appContext } from "@/lib/server/context";
import { buildStylistPrompt } from "@/lib/features/stylist";

const schema = z.object({ message: z.string().min(1).max(2000) });

export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const ctx = await appContext(auth.user.id);
  const prompt = buildStylistPrompt(ctx, parsed.data.message);

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ answer: "AI Stylist is configured but no OPENAI_API_KEY is present. The safe next step is to add the key, then ask again. FitCheck will continue using its deterministic fit engine as the source of fit truth.", mode: "fallback" });
  }

  const model = process.env.OPENAI_STYLIST_MODEL || "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model, input: prompt, max_output_tokens: 900 }),
  });

  if (!response.ok) {
    console.error("[stylist] OpenAI error", await response.text());
    return NextResponse.json({ error: "The stylist provider returned an error." }, { status: 502 });
  }

  const data = await response.json();
  const answer = extractText(data);
  return NextResponse.json({ answer: answer || "I couldn't turn the wardrobe evidence into an answer." });
}

function extractText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}