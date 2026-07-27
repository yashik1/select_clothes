import { NextResponse } from "next/server";
import { z } from "zod";
import { planPacking } from "@/lib/engine/packing";
import { appContext } from "@/lib/server/context";
import { parseJsonBody } from "@/lib/http";

const schema = z.object({
  days: z.number().min(1).max(30),
  itinerary: z.array(
    z.enum([
      "loungewear", "errands", "casual-social", "smart-casual", "office",
      "business-formal", "date-night", "cocktail", "black-tie", "workout", "travel",
    ]),
  ),
  tempLowC: z.number().min(-40).max(50),
  tempHighC: z.number().min(-40).max(55),
  rain: z.boolean(),
  maxItems: z.number().min(3).max(30),
});

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, schema, "Invalid trip");
  if (!parsed.ok) return parsed.response;
  const { profile, wardrobe, scoring } = await appContext();
  const result = planPacking(wardrobe, profile, parsed.data, scoring);

  return NextResponse.json({
    ...result,
    items: result.items.map((g) => ({
      id: g.id, name: g.name, category: g.category, subcategory: g.subcategory,
      colors: g.colors, imageIds: g.imageIds,
    })),
    outfits: result.outfits.map((o) => ({
      day: o.day,
      occasion: o.occasion,
      score: o.score,
      garments: o.garments.map((g) => ({ id: g.id, name: g.name })),
    })),
  });
}
