import { NextResponse } from "next/server";
import { z } from "zod";
import { getGarments } from "@/lib/db";
import { scoreOutfit, confidenceGaps } from "@/lib/engine";
import { outfitClo, describeClo } from "@/lib/engine/weather";
import { appContext } from "@/lib/server/context";
import { occasionSchema } from "@/lib/validate";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";

const schema = z.object({
  garmentIds: z.array(z.string()).max(12),
  occasion: occasionSchema,
});

/** Live scoring for the outfit studio. Called on every change, so it stays lean. */
export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const { profile, scoring, forecast } = await appContext(userId, parsed.data.occasion);
  const garments = await getGarments(userId, parsed.data.garmentIds);

  if (!garments.length) {
    return NextResponse.json({ error: "No garments selected" }, { status: 400 });
  }

  const score = scoreOutfit(garments, profile, scoring);

  return NextResponse.json({
    score,
    gaps: confidenceGaps(score),
    insulation: describeClo(outfitClo(garments)),
    weather: forecast,
  });
}
