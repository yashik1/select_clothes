import { NextResponse } from "next/server";
import { getOrCreateProfile, saveProfile } from "@/lib/db";
import { compact, profileInputSchema } from "@/lib/validate";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";
import type { Profile } from "@/lib/types";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  return NextResponse.json({ profile: await getOrCreateProfile(userId) });
}

export async function PUT(req: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, profileInputSchema, "Invalid profile");
  if (!parsed.ok) return parsed.response;

  const existing = await getOrCreateProfile(userId);
  const input = parsed.data;

  const profile: Profile = {
    ...existing,
    ...(compact(input) as unknown as Profile),
    measurements: compact(input.measurements ?? {}),
    coloring: {
      ...compact(input.coloring ?? {}),
      seasonOverride: (input.coloring?.seasonOverride as Profile["coloring"]["seasonOverride"]) ?? null,
    },
    fitPreferences: (input.fitPreferences ?? {}) as Profile["fitPreferences"],
    bodyShapeOverride: input.bodyShapeOverride ?? null,
    id: existing.id,
    createdAt: existing.createdAt,
  };

  await saveProfile(userId, profile);
  return NextResponse.json({ profile });
}
