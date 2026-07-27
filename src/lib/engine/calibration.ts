/**
 * Brand fit calibration — the part that compounds.
 *
 * Every size chart is a polite fiction: a "medium" at one brand is a different
 * garment from a "medium" at another, and both differ from the medium that
 * actually fits *you*. Rather than pretend otherwise, we ask one question after
 * a wear ("how did that fit?") and use the answer to learn a per-brand,
 * per-category offset.
 *
 * After a handful of answers the app knows that a given brand runs 6cm small on
 * you and silently applies that to everything from that brand — including
 * things you haven't bought yet. That is the asset a competitor cannot copy by
 * shipping a better image model.
 */
import { subcategoryDef, type EaseBand } from "../data/garmentTypes";
import type {
  BrandCalibration,
  FitFeedback,
  Garment,
  GarmentMeasurements,
  Profile,
} from "../types";
import { PREFERENCE_SHIFT, evaluateGarmentFit, representativeEase, shiftBand } from "./fit";

/** The landmark an "overall" verdict should be attributed to. */
function primaryLandmark(g: Garment): keyof GarmentMeasurements {
  return g.category === "bottom" ? "waistFlat" : "chestFlat";
}

/** Cap on how far one brand can be pushed, so a single odd answer can't
 *  poison every future prediction. */
const MAX_BIAS_CM = 12;

export function computeCalibrations(
  feedback: FitFeedback[],
  garments: Garment[],
  profile: Profile,
): BrandCalibration[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  const buckets = new Map<string, { brand: string; category: Garment["category"]; deltas: number[] }>();

  for (const f of feedback) {
    const g = byId.get(f.garmentId);
    if (!g?.brand) continue;

    const def = subcategoryDef(g.subcategory, g.category);
    const landmark = f.landmark === "overall" ? primaryLandmark(g) : f.landmark;
    const rawBand: EaseBand | undefined = def.ease[landmark as keyof GarmentMeasurements];
    if (!rawBand) continue;

    // What did we predict, before any calibration?
    const report = evaluateGarmentFit(g, profile);
    const finding = report.findings.find((x) => x.landmark === landmark);
    if (!finding) continue;

    const preference = profile.fitPreferences[g.category] ?? "regular";
    const band = shiftBand(rawBand, PREFERENCE_SHIFT[preference]);

    // If they say it's tighter than we predicted, the garment really has less
    // ease than our model thought — that difference is the brand's bias.
    const actual = representativeEase(f.verdict, band);
    const delta = actual - finding.effectiveEaseCm;

    const key = `${g.brand.trim().toLowerCase()}::${g.category}`;
    const bucket = buckets.get(key) ?? { brand: g.brand.trim().toLowerCase(), category: g.category, deltas: [] };
    bucket.deltas.push(delta);
    buckets.set(key, bucket);
  }

  const now = new Date().toISOString();
  const out: BrandCalibration[] = [];
  for (const { brand, category, deltas } of buckets.values()) {
    const n = deltas.length;
    const mean = deltas.reduce((s, d) => s + d, 0) / n;
    // Shrink toward zero while the sample is small: one data point moves the
    // needle a third of the way, five move it most of the way.
    const damped = mean * (n / (n + 2));
    out.push({
      brand,
      category,
      easeBiasCm: Math.max(-MAX_BIAS_CM, Math.min(MAX_BIAS_CM, damped)),
      sampleCount: n,
      updatedAt: now,
    });
  }
  return out;
}

export function describeCalibration(c: BrandCalibration): string {
  const cm = Math.abs(c.easeBiasCm).toFixed(1);
  if (Math.abs(c.easeBiasCm) < 1.5) {
    return `${titleCase(c.brand)} ${c.category} sizing matches the standard chart on you.`;
  }
  const direction = c.easeBiasCm < 0 ? "smaller" : "larger";
  return `${titleCase(c.brand)} ${c.category} runs about ${cm}cm ${direction} on you than the chart says (${c.sampleCount} data point${c.sampleCount === 1 ? "" : "s"}).`;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
