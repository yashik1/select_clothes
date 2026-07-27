import { NextResponse } from "next/server";
import { deleteGarment, getGarment, saveGarment } from "@/lib/db";
import { compact, garmentInputSchema } from "@/lib/validate";
import type { Garment } from "@/lib/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const garment = getGarment(id);
  if (!garment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ garment });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getGarment(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();

  // Small toggles (laundry state, rating, archive) shouldn't require the client
  // to round-trip the whole garment.
  if (body.__patch === true) {
    const updated: Garment = {
      ...existing,
      careState: body.careState ?? existing.careState,
      rating: body.rating ?? existing.rating,
      archivedAt: body.archivedAt !== undefined ? body.archivedAt : existing.archivedAt,
    };
    saveGarment(updated);
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
  saveGarment(updated);
  return NextResponse.json({ garment: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteGarment(id);
  return NextResponse.json({ ok: true });
}
