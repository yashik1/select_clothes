import { NextResponse } from "next/server";
import { QUOTA, countOwned, getGarment, listGarments, newId, nowIso, saveGarment } from "@/lib/db";
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

  const input = parsed.data;

  /*
   * The cap counts rows, so it must not fire on a write that replaces one.
   * A client may supply its own id, and an id already owned means this is an
   * overwrite rather than a new garment.
   */
  const replacing = input.id ? Boolean(await getGarment(userId, input.id)) : false;
  if (!replacing && (await countOwned(userId, "garment")) >= QUOTA.garments) {
    return NextResponse.json(
      { error: `A wardrobe holds up to ${QUOTA.garments} garments. Archive or delete some first.` },
      { status: 409 },
    );
  }

  const now = nowIso();
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
