import { NextResponse } from "next/server";
import { listGarments, newId, nowIso, saveGarment } from "@/lib/db";
import { compact, garmentInputSchema } from "@/lib/validate";
import type { Garment } from "@/lib/types";

export async function GET() {
  return NextResponse.json({ garments: listGarments() });
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = garmentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid garment", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = nowIso();
  const input = parsed.data;
  const garment: Garment = {
    ...(compact(input) as unknown as Garment),
    id: input.id || newId(),
    measurements: compact(input.measurements ?? {}),
    wearCount: 0,
    lastWornAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  saveGarment(garment);
  return NextResponse.json({ garment }, { status: 201 });
}
