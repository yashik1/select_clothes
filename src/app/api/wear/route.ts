import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deletePlan, listFitFeedback, listGarments, logWear, newId, nowIso,
  saveCalibration, saveFitFeedback, getOrCreateProfile,
} from "@/lib/db";
import { computeCalibrations } from "@/lib/engine/calibration";
import { occasionSchema } from "@/lib/validate";
import { parseJsonBody } from "@/lib/http";
import { requireApiUser } from "@/lib/server/session";
import { LIMITS, consume, tooMany } from "@/lib/server/rateLimit";

const schema = z.object({
  garmentIds: z.array(z.string()).min(1),
  outfitId: z.string().optional(),
  date: z.string().optional(),
  /*
   * Set when this wear is confirming a plan: the calendar day whose plan should
   * now stop being a plan. Sent explicitly rather than derived from `date`,
   * because `date` may be a UTC instant and the plan is keyed on a local day —
   * inferring one from the other gets the answer wrong by a day for anyone west
   * of Greenwich after their evening.
   */
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  const now = nowIso();

  /*
   * `wear_log` and `fit_feedback` are the two tables with no ceiling on how
   * many rows an account may own — a wear is a fact about a day, so capping
   * the total would eventually refuse a real one. This route is therefore the
   * one place a session with a loop could still fill the disk, and its own
   * export would then be an unbounded response. A per-account rate limit
   * bounds it without ever bounding a person: nobody logs sixty outfits in an
   * hour, and the counter is keyed on the account, so filling it costs only
   * the account that filled it.
   */
  const verdict = await consume(`wear:${userId}`, LIMITS.wear);
  if (!verdict.ok) return tooMany(verdict.retryAfter, "entries");

  await logWear(userId, {
    id: newId(),
    date: input.date ?? now,
    garmentIds: input.garmentIds,
    outfitId: input.outfitId ?? null,
    occasion: input.occasion,
    comfortRating: input.comfortRating,
    notes: input.notes,
    createdAt: now,
  });

  // A plan that has happened is no longer a plan. After the wear, so a failed
  // write leaves the intention in place rather than losing both.
  if (input.planDate) await deletePlan(userId, input.planDate);

  let calibrationsUpdated = 0;
  if (input.fitFeedback?.length) {
    for (const f of input.fitFeedback) {
      await saveFitFeedback(userId, {
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
      await listFitFeedback(userId),
      await listGarments(userId, { includeArchived: true }),
      await getOrCreateProfile(userId),
    );
    for (const c of calibrations) await saveCalibration(userId, c);
    calibrationsUpdated = calibrations.length;
  }

  return NextResponse.json({ ok: true, calibrationsUpdated });
}
