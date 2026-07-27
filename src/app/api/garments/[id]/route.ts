import { NextResponse } from "next/server";
import { deleteGarment, getGarment, saveGarment } from "@/lib/db";
import { compact, garmentInputSchema, garmentPatchSchema } from "@/lib/validate";
import { readJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";
import type { Garment } from "@/lib/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const garment = await getGarment(auth.user.id, id);
  if (!garment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ garment });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const { id } = await params;
  const existing = await getGarment(userId, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const read = await readJsonBody(req);
  if (!read.ok) return read.response;
  const body = read.data;

  // Small toggles (laundry state, rating, archive) shouldn't require the client
  // to round-trip the whole garment. The flag is read defensively because the
  // body is whatever the caller sent — including `null`, which would throw on a
  // property access and surface as a 500.
  const isQuickPatch =
    typeof body === "object" && body !== null && (body as { __patch?: unknown }).__patch === true;

  if (isQuickPatch) {
    const quick = garmentPatchSchema.safeParse(body);
    if (!quick.success) {
      return NextResponse.json({ error: "Invalid patch", issues: quick.error.issues }, { status: 400 });
    }
    const updated: Garment = {
      ...existing,
      careState: quick.data.careState ?? existing.careState,
      rating: quick.data.rating ?? existing.rating,
      archivedAt:
        quick.data.archivedAt !== undefined ? quick.data.archivedAt : existing.archivedAt,
    };
    await saveGarment(userId, updated);
    return NextResponse.json({ garment: updated });
  }

  const parsed = garmentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid garment", issues: parsed.error.issues }, { status: 400 });
  }

  const updated: Garment = {
    ...existing,
    ...(compact(parsed.data) as unknown as Garment),
    id: existing.id,
    measurements: compact(parsed.data.measurements ?? {}),
    archivedAt: parsed.data.archivedAt ?? existing.archivedAt ?? null,
    wearCount: existing.wearCount,
    lastWornAt: existing.lastWornAt,
    createdAt: existing.createdAt,
  };
  await saveGarment(userId, updated);
  return NextResponse.json({ garment: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  // A garment belonging to someone else is reported exactly as one that never
  // existed — anything else would confirm the id is real.
  const deleted = await deleteGarment(auth.user.id, id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
