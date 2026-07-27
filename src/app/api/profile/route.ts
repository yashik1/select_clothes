import { NextResponse } from "next/server";
import { getOrCreateProfile, saveProfile } from "@/lib/db";
import { compact, profileInputSchema } from "@/lib/validate";
import { parseJsonBody } from "@/lib/http";
import type { Profile } from "@/lib/types";

export async function GET() {
  return NextResponse.json({ profile: await getOrCreateProfile() });
}

export async function PUT(req: Request) {
  const parsed = await parseJsonBody(req, profileInputSchema, "Invalid profile");
  if (!parsed.ok) return parsed.response;

  const existing = await getOrCreateProfile();
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

  await saveProfile(profile);
  return NextResponse.json({ profile });
}
