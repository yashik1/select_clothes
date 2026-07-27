import { NextResponse } from "next/server";
import { getOrCreateProfile, saveProfile } from "@/lib/db";
import { compact, profileInputSchema } from "@/lib/validate";
import type { Profile } from "@/lib/types";

export async function GET() {
  return NextResponse.json({ profile: getOrCreateProfile() });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const parsed = profileInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid profile", issues: parsed.error.issues }, { status: 400 });
  }

  const existing = getOrCreateProfile();
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

  saveProfile(profile);
  return NextResponse.json({ profile });
}
