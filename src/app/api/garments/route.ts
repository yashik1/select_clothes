import { NextResponse } from "next/server";
import { listGarments, newId, nowIso, saveGarment } from "@/lib/db";
import { compact, garmentInputSchema } from "@/lib/validate";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";
import type { Garment } from "@/lib/types";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  return NextResponse.json({ garments: await listGarments(userId) });
}

export async function POST(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, garmentInputSchema, "Invalid garment");
  if (!parsed.ok) return parsed.response;

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

  await saveGarment(userId, garment);
  return NextResponse.json({ garment }, { status: 201 });
}
