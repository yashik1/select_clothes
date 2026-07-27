/**
 * The fit engine.
 *
 * This is the part every other app skips. Virtual try-on renders show you a
 * plausible picture; they do not know whether the shirt will actually close
 * across your chest. This engine answers that question with arithmetic instead
 * of a generative model, which means it is instant, free, deterministic, and —
 * most importantly — able to explain itself in centimetres.
 *
 * The pipeline for each landmark:
 *   garment circumference − body circumference        = raw ease
 *   + stretch beyond the fabric the band assumes      = comfort credit
 *   + learned brand bias                              = calibration
 *   → compared against a preference-shifted ease band → verdict + advice
 */
import {
  MEASURE_META,
  subcategoryDef,
  type EaseBand,
  type SubcategoryDef,
} from "../data/garmentTypes";
import { fabricStretch } from "../data/fabrics";
import { adjacentSize, bodyForSize } from "../data/sizeCharts";
import type {
  BodyMeasurements,
  BrandCalibration,
  FitFinding,
  FitPreference,
  FitVerdict,
  Garment,
  GarmentFitReport,
  GarmentMeasurements,
  Profile,
} from "../types";

/** How far the whole ease band shifts for each preferred cut, in centimetres. */
export const PREFERENCE_SHIFT: Record<FitPreference, number> = {
  slim: -3,
  regular: 0,
  relaxed: 4.5,
  oversized: 11,
};

const VERDICT_LABEL: Record<FitVerdict, string> = {
  "too-tight": "Too tight",
  snug: "Snug",
  ideal: "Ideal",
  relaxed: "Relaxed",
  oversized: "Oversized",
  "too-loose": "Too loose",
};

export function verdictLabel(v: FitVerdict): string {
  return VERDICT_LABEL[v];
}

/**
 * A representative ease value for each verdict — the centre of that verdict's
 * region. Used by the calibration loop to turn "this ran tight" into a number.
 */
export function representativeEase(verdict: FitVerdict, b: EaseBand): number {
  switch (verdict) {
    case "too-tight": return b.tooTight - 3;
    case "snug": return (b.tooTight + b.snug) / 2;
    case "ideal": return (b.snug + b.idealHi) / 2;
    case "relaxed": return (b.idealHi + b.relaxed) / 2;
    case "oversized": return (b.relaxed + b.oversized) / 2;
    case "too-loose": return b.oversized + 4;
  }
}

export function shiftBand(band: EaseBand, cm: number): EaseBand {
  return {
    tooTight: band.tooTight + cm,
    snug: band.snug + cm,
    idealHi: band.idealHi + cm,
    relaxed: band.relaxed + cm,
    oversized: band.oversized + cm,
  };
}

function classify(ease: number, b: EaseBand): FitVerdict {
  if (ease < b.tooTight) return "too-tight";
  if (ease < b.snug) return "snug";
  if (ease <= b.idealHi) return "ideal";
  if (ease <= b.relaxed) return "relaxed";
  if (ease <= b.oversized) return "oversized";
  return "too-loose";
}

/**
 * 0-100 for a single landmark. Too-tight falls away much faster than too-loose
 * because a garment you cannot close is unwearable, while one that's a bit
 * roomy is merely not ideal.
 */
function landmarkScore(ease: number, b: EaseBand, verdict: FitVerdict): number {
  switch (verdict) {
    case "ideal": {
      const mid = (b.snug + b.idealHi) / 2;
      const half = Math.max(1, (b.idealHi - b.snug) / 2);
      return Math.max(92, 100 - (Math.abs(ease - mid) / half) * 8);
    }
    case "snug": {
      const t = (ease - b.tooTight) / Math.max(0.5, b.snug - b.tooTight);
      return 72 + t * 20;
    }
    case "relaxed": {
      const t = (ease - b.idealHi) / Math.max(0.5, b.relaxed - b.idealHi);
      return 92 - t * 18;
    }
    case "oversized": {
      const t = (ease - b.relaxed) / Math.max(0.5, b.oversized - b.relaxed);
      return 74 - t * 19;
    }
    case "too-tight":
      return Math.max(0, 68 - (b.tooTight - ease) * 9);
    case "too-loose":
      return Math.max(0, 55 - (ease - b.oversized) * 3.5);
  }
}

function lengthScore(deltaCm: number, tol: number): { score: number; verdict: FitVerdict } {
  const over = Math.abs(deltaCm) - tol;
  if (over <= 0) return { score: 100 - (Math.abs(deltaCm) / Math.max(0.5, tol)) * 6, verdict: "ideal" };
  const score = Math.max(0, 92 - over * 11);
  return { score, verdict: deltaCm > 0 ? "too-loose" : "too-tight" };
}

/** Which body landmark a garment measurement compares against, with bottoms
 *  preferring the waistband position the user actually wears. */
function bodyKeyFor(
  key: keyof GarmentMeasurements,
  garment: Garment,
  body: BodyMeasurements,
): keyof BodyMeasurements | undefined {
  const meta = MEASURE_META[key];
  if (key === "waistFlat" && garment.category !== "top" && typeof body.waistWorn === "number") {
    return "waistWorn";
  }
  return meta.body;
}

/** Flat measurements are doubled; widths and lengths are used as entered. */
function toComparable(key: keyof GarmentMeasurements, value: number): number {
  return MEASURE_META[key].kind === "circumference" ? value * 2 : value;
}

function calibrationFor(
  garment: Garment,
  calibrations: BrandCalibration[] | undefined,
): BrandCalibration | undefined {
  if (!garment.brand || !calibrations) return undefined;
  const brand = garment.brand.trim().toLowerCase();
  return calibrations.find(
    (c) => c.brand.trim().toLowerCase() === brand && c.category === garment.category,
  );
}

/**
 * Fill in garment measurements we don't have from the size label.
 *
 * A size chart tells us the body a garment was cut for; adding the
 * subcategory's ideal ease gives an estimated garment measurement. It's a real
 * signal — just a weaker one — so everything derived this way is marked
 * `inferred` and drags confidence down.
 */
function inferMeasurements(
  garment: Garment,
  def: SubcategoryDef,
): { measurements: GarmentMeasurements; inferredKeys: Set<keyof GarmentMeasurements> } {
  const measurements: GarmentMeasurements = { ...garment.measurements };
  const inferredKeys = new Set<keyof GarmentMeasurements>();

  const targetBody = bodyForSize(garment.sizeSystem, garment.size, garment.category);
  if (!targetBody) return { measurements, inferredKeys };

  const intentShift = PREFERENCE_SHIFT[garment.fitIntent] ?? 0;

  for (const [k, band] of Object.entries(def.ease) as [keyof GarmentMeasurements, EaseBand][]) {
    if (typeof measurements[k] === "number") continue;
    const meta = MEASURE_META[k];
    const bodyKey = meta.body;
    if (!bodyKey) continue;
    const cutFor = targetBody[bodyKey];
    if (typeof cutFor !== "number") continue;

    const idealEase = (band.snug + band.idealHi) / 2 + intentShift;
    const comparable = cutFor + idealEase;
    measurements[k] = meta.kind === "circumference" ? comparable / 2 : comparable;
    inferredKeys.add(k);
  }

  if (targetBody.inseam && typeof measurements.inseam !== "number") {
    measurements.inseam = targetBody.inseam;
    inferredKeys.add("inseam");
  }

  return { measurements, inferredKeys };
}

function adviceFor(
  key: keyof GarmentMeasurements,
  verdict: FitVerdict,
  gapCm: number,
  garment: Garment,
  def: SubcategoryDef,
): string | undefined {
  const label = MEASURE_META[key].label.replace(/ \(flat\)/, "").toLowerCase();
  const sizeUp = garment.sizeSystem && garment.size ? adjacentSize(garment.sizeSystem, garment.size, 1) : null;
  const sizeDown = garment.sizeSystem && garment.size ? adjacentSize(garment.sizeSystem, garment.size, -1) : null;
  const cm = Math.abs(Math.round(gapCm * 10) / 10);

  switch (verdict) {
    case "too-tight":
      if (key === "chestFlat" && def.category === "outerwear") {
        return `${cm}cm short across the ${label}. Wear it open over a thinner layer${sizeUp ? `, or look for a ${sizeUp}` : ""}.`;
      }
      if (key === "waistFlat" && def.category === "bottom") {
        return `${cm}cm tight at the waist — it will sit below your natural waist and roll.${sizeUp ? ` A ${sizeUp} is the honest answer.` : ""}`;
      }
      if (key === "shoulderFlat") {
        return "Shoulder seams fall inside your shoulder point. This is the one thing a tailor cannot fix — treat it as the wrong size.";
      }
      return `${cm}cm tighter than comfortable at the ${label}.${sizeUp ? ` Try a ${sizeUp}.` : ""}`;
    case "snug":
      return `Close through the ${label}. Fine standing, tight when you sit.`;
    case "oversized":
      return `Deliberately roomy through the ${label} — works if the rest of the outfit is fitted.`;
    case "too-loose":
      if (key === "shoulderFlat") return "Shoulder seams hang well past your shoulder — the whole garment will read borrowed.";
      if (key === "waistFlat" && def.category === "bottom") return `${cm}cm loose at the waist. A belt fixes the waist but not the seat.`;
      return `${cm}cm past even a relaxed fit at the ${label}.${sizeDown ? ` A ${sizeDown} would sit better.` : ""}`;
    default:
      return undefined;
  }
}

function lengthAdvice(
  key: keyof GarmentMeasurements,
  deltaCm: number,
  rule: { longAdvice?: string; shortAdvice?: string },
): string | undefined {
  if (deltaCm > 0) return rule.longAdvice ?? `Runs ${Math.round(deltaCm)}cm long.`;
  return rule.shortAdvice ?? `Runs ${Math.round(-deltaCm)}cm short.`;
}

export function evaluateGarmentFit(
  garment: Garment,
  profile: Profile,
  calibrations?: BrandCalibration[],
): GarmentFitReport {
  const def = subcategoryDef(garment.subcategory, garment.category);
  const body = profile.measurements;
  const findings: FitFinding[] = [];
  const missingData: string[] = [];

  const { measurements, inferredKeys } = inferMeasurements(garment, def);

  const preference = profile.fitPreferences[garment.category] ?? "regular";
  const shift = PREFERENCE_SHIFT[preference];

  const stretch = fabricStretch(garment.fabric, def.knit);
  const baseline = def.canonicalStretch ?? (def.knit ? 0.21 : 0.03);
  const stretchDelta = stretch - baseline;

  const calibration = calibrationFor(garment, calibrations);

  /* ------------------------------------------------------ circumferences -- */
  for (const [k, rawBand] of Object.entries(def.ease) as [keyof GarmentMeasurements, EaseBand][]) {
    const bodyKey = bodyKeyFor(k, garment, body);
    const bodyValue = bodyKey ? body[bodyKey] : undefined;
    const garmentValue = measurements[k];

    if (typeof bodyValue !== "number") {
      if (bodyKey) missingData.push(`your ${bodyKey.replace(/([A-Z])/g, " $1").toLowerCase()}`);
      continue;
    }
    if (typeof garmentValue !== "number") {
      missingData.push(`${MEASURE_META[k].label.toLowerCase()} of this ${def.label.toLowerCase()}`);
      continue;
    }

    const garmentCm = toComparable(k, garmentValue);
    const ease = garmentCm - bodyValue;

    // Only half of a fabric's stretch is *comfortable* stretch — the rest is
    // the part that leaves seam marks.
    const stretchCredit =
      MEASURE_META[k].kind === "circumference" ? bodyValue * stretchDelta * 0.5 : 0;
    const calibrationCredit = calibration ? calibration.easeBiasCm : 0;
    const effectiveEase = ease + stretchCredit + calibrationCredit;

    const band = shiftBand(rawBand, shift);
    const verdict = classify(effectiveEase, band);
    const score = landmarkScore(effectiveEase, band, verdict);

    const gap =
      verdict === "too-tight" ? band.tooTight - effectiveEase
      : verdict === "too-loose" ? effectiveEase - band.oversized
      : 0;

    findings.push({
      landmark: k,
      label: MEASURE_META[k].label.replace(/ \(flat\)/, ""),
      bodyCm: bodyValue,
      garmentCm,
      easeCm: ease,
      effectiveEaseCm: effectiveEase,
      verdict,
      score,
      confidence: inferredKeys.has(k) ? 0.45 : 0.95,
      advice: adviceFor(k, verdict, gap, garment, def),
    });
  }

  /* ------------------------------------------------------------ lengths -- */
  for (const [k, rule] of Object.entries(def.lengths) as [
    keyof GarmentMeasurements,
    NonNullable<SubcategoryDef["lengths"][keyof GarmentMeasurements]>,
  ][]) {
    const bodyValue = body[rule.from];
    const garmentValue = measurements[k];
    if (typeof bodyValue !== "number") {
      missingData.push(`your ${String(rule.from).replace(/([A-Z])/g, " $1").toLowerCase()}`);
      continue;
    }
    if (typeof garmentValue !== "number") {
      missingData.push(`${MEASURE_META[k].label.toLowerCase()} of this ${def.label.toLowerCase()}`);
      continue;
    }

    const target = bodyValue + rule.offset;
    const delta = garmentValue - target;
    const { score, verdict } = lengthScore(delta, rule.tol);

    findings.push({
      landmark: k,
      label: MEASURE_META[k].label,
      bodyCm: target,
      garmentCm: garmentValue,
      easeCm: delta,
      effectiveEaseCm: delta,
      verdict,
      score,
      confidence: inferredKeys.has(k) ? 0.45 : 0.95,
      advice: verdict === "ideal" ? undefined : lengthAdvice(k, delta, rule),
    });
  }

  /* ---------------------------------------------------------- aggregate -- */
  if (findings.length === 0) {
    return {
      garmentId: garment.id,
      score: 70,
      confidence: 0.05,
      findings: [],
      inferred: inferredKeys.size > 0,
      missingData: dedupe(missingData),
    };
  }

  const mean = findings.reduce((s, f) => s + f.score, 0) / findings.length;
  const worst = Math.min(...findings.map((f) => f.score));
  // A garment is only as wearable as its worst landmark, but one slightly
  // imperfect sleeve shouldn't condemn an otherwise excellent jacket.
  const score = mean * 0.45 + worst * 0.55;

  const coverage = findings.length / Math.max(1, findings.length + dedupe(missingData).length);
  const dataQuality = findings.reduce((s, f) => s + f.confidence, 0) / findings.length;
  const confidence = Math.max(0.05, Math.min(0.97, coverage * 0.45 + dataQuality * 0.55));

  return {
    garmentId: garment.id,
    score,
    confidence,
    findings: findings.sort((a, b) => a.score - b.score),
    inferred: inferredKeys.size > 0,
    missingData: dedupe(missingData),
  };
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

/** Convenience for the pre-purchase checker: fit a hypothetical garment. */
export function fitSummary(report: GarmentFitReport): string {
  if (!report.findings.length) return "Not enough data to judge the fit yet.";
  const bad = report.findings.filter((f) => f.verdict === "too-tight" || f.verdict === "too-loose");
  if (bad.length) return bad[0].advice ?? `${bad[0].label} is off.`;
  const snug = report.findings.filter((f) => f.verdict === "snug");
  if (snug.length) return `Close through the ${snug[0].label.toLowerCase()}, but wearable.`;
  return "Fits you well at every landmark we can check.";
}
