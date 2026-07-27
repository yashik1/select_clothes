import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listFitFeedback, listGarments, logWear, newId, nowIso,
  saveCalibration, saveFitFeedback, getOrCreateProfile,
} from "@/lib/db";
import { computeCalibrations } from "@/lib/engine/calibration";
import { occasionSchema } from "@/lib/validate";

const schema = z.object({
  garmentIds: z.array(z.string()).min(1),
  outfitId: z.string().optional(),
  date: z.string().optional(),
  occasion: occasionSchema,
  comfortRating: z.number().min(1).max(5).optional(),
  notes: z.string().max(500).optional(),
  /** Post-wear fit answers. This is what trains brand calibration. */
  fitFeedback: z
    .array(
      z.object({
        garmentId: z.string(),
        landmark: z.string(),
        verdict: z.enum(["too-tight", "snug", "ideal", "relaxed", "oversized", "too-loose"]),
      }),
    )
    .optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;
  const now = nowIso();

  await logWear({
    id: newId(),
    date: input.date ?? now,
    garmentIds: input.garmentIds,
    outfitId: input.outfitId ?? null,
    occasion: input.occasion,
    comfortRating: input.comfortRating,
    notes: input.notes,
    createdAt: now,
  });

  let calibrationsUpdated = 0;
  if (input.fitFeedback?.length) {
    for (const f of input.fitFeedback) {
      await saveFitFeedback({
        id: newId(),
        garmentId: f.garmentId,
        landmark: f.landmark as never,
        verdict: f.verdict,
        createdAt: now,
      });
    }
    // Recompute from the full history rather than incrementally — the dataset
    // is tiny and this keeps the maths honest if a garment is later edited.
    const calibrations = computeCalibrations(
      await listFitFeedback(),
      await listGarments({ includeArchived: true }),
      await getOrCreateProfile(),
    );
    for (const c of calibrations) await saveCalibration(c);
    calibrationsUpdated = calibrations.length;
  }

  return NextResponse.json({ ok: true, calibrationsUpdated });
}
