/**
 * The composite scorer.
 *
 * Every dimension returns a score *and* a confidence, and the composite weights
 * by both. That's the design decision the whole app hangs on: a dimension we
 * had to guess at should not be allowed to shout as loudly as one we measured.
 * It's also what lets the UI answer "why should I believe this?" — which is the
 * question that actually decides whether someone trusts a styling app twice.
 */
import type {
  DimensionKey,
  Garment,
  GarmentFitReport,
  OutfitScore,
  Profile,
  Reason,
  ScoringContext,
  SubScore,
  Verdict,
} from "../types";
import { evaluateGarmentFit, verdictLabel } from "./fit";
import { scoreColor } from "./color";
import { scoreProportion } from "./proportion";
import { scoreFormality } from "./formality";
import { scoreWeather } from "./weather";
import { scoreNovelty } from "./novelty";

export * from "./fit";
export * from "./bodyShape";
export { garmentVolume } from "./proportion";
export { garmentClo, outfitClo, neutralTemp, cloForTemp, describeClo } from "./weather";
export { OCCASIONS, OCCASION_KEYS, outfitFormality } from "./formality";
export { daysSince } from "./novelty";

/* ------------------------------------------------------------- fit roll-up -- */

export function scoreFit(
  garments: Garment[],
  profile: Profile,
  ctx: ScoringContext,
): { sub: SubScore; reports: GarmentFitReport[] } {
  const reports = garments
    .filter((g) => g.category !== "accessory" && g.category !== "bag" && g.category !== "shoes")
    .map((g) => {
      const cached = ctx.fitCache?.get(g.id);
      if (cached) return cached;
      const report = evaluateGarmentFit(g, profile, ctx.calibrations);
      ctx.fitCache?.set(g.id, report);
      return report;
    });

  if (!reports.length) {
    return {
      sub: {
        key: "fit", label: "Fit", score: 75, confidence: 0, weight: 1.5,
        reasons: [], missingData: ["clothing measurements or size labels"],
      },
      reports,
    };
  }

  const byId = new Map(garments.map((g) => [g.id, g]));
  const reasons: Reason[] = [];
  const missingData = new Set<string>();

  for (const r of reports) {
    for (const m of r.missingData) missingData.add(m);
    const g = byId.get(r.garmentId);
    if (!g) continue;

    for (const f of r.findings) {
      if (f.verdict === "ideal" || f.verdict === "relaxed") continue;
      const severity =
        f.verdict === "too-tight" || f.verdict === "too-loose"
          ? f.score < 40 ? "bad" : "warn"
          : "info";
      reasons.push({
        severity,
        text: `${g.name}: ${verdictLabel(f.verdict).toLowerCase()} at the ${f.label.toLowerCase()} (${f.effectiveEaseCm >= 0 ? "+" : ""}${f.effectiveEaseCm.toFixed(1)}cm of room).`,
        fix: f.advice,
        garmentIds: [g.id],
        impact: Math.round((f.score - 92) * 0.35),
      });
    }

    if (r.findings.length && r.findings.every((f) => f.verdict === "ideal")) {
      reasons.push({
        severity: "good",
        text: `${g.name} fits you correctly everywhere we can check.`,
        garmentIds: [g.id],
        impact: 6,
      });
    }
    if (r.inferred) {
      missingData.add(`measured dimensions for ${g.name} (currently estimated from its size label)`);
    }
  }

  // Worst-item-dominant: one unwearable piece makes the outfit unwearable.
  const mean = reports.reduce((s, r) => s + r.score, 0) / reports.length;
  const worst = Math.min(...reports.map((r) => r.score));
  const score = mean * 0.4 + worst * 0.6;
  const confidence = reports.reduce((s, r) => s + r.confidence, 0) / reports.length;

  return {
    sub: {
      key: "fit",
      label: "Fit",
      score,
      confidence,
      // Fit outranks everything else: a garment that doesn't fit cannot be
      // rescued by good colour.
      weight: 1.5,
      reasons: reasons.sort((a, b) => (a.impact ?? 0) - (b.impact ?? 0)).slice(0, 8),
      missingData: Array.from(missingData),
    },
    reports,
  };
}

/* ------------------------------------------------------------- completeness -- */

function completenessReasons(garments: Garment[]): Reason[] {
  const has = (c: string) => garments.some((g) => g.category === c);
  const out: Reason[] = [];
  if (!has("dress") && !has("bottom")) {
    out.push({ severity: "bad", text: "No bottom half — add trousers, a skirt or a dress.", impact: -100 });
  }
  if (!has("dress") && !has("top") && !has("outerwear")) {
    out.push({ severity: "bad", text: "No top half yet.", impact: -100 });
  }
  if (!has("shoes")) {
    out.push({ severity: "info", text: "No shoes picked. Shoes change the register of an outfit more than anything else.", impact: -4 });
  }
  return out;
}

/* ------------------------------------------------------------- composite -- */

const DIMENSION_ORDER: DimensionKey[] = ["fit", "color", "proportion", "formality", "weather", "novelty"];

export interface ScoreResult extends OutfitScore {
  fitReports: GarmentFitReport[];
}

export function scoreOutfit(
  garments: Garment[],
  profile: Profile,
  ctx: ScoringContext = {},
): ScoreResult {
  const completeness = completenessReasons(garments);
  const blocking = completeness.filter((r) => r.severity === "bad");

  const { sub: fitSub, reports } = scoreFit(garments, profile, ctx);
  const dimensions: SubScore[] = [
    fitSub,
    scoreColor(garments, profile),
    scoreProportion(garments, profile),
    scoreFormality(garments, ctx.occasion),
    scoreWeather(garments, ctx.weather),
    scoreNovelty(garments, ctx),
  ].sort((a, b) => DIMENSION_ORDER.indexOf(a.key) - DIMENSION_ORDER.indexOf(b.key));

  // A dimension we're unsure about still counts, but quietly.
  let weighted = 0;
  let weightTotal = 0;
  for (const d of dimensions) {
    const w = d.weight * (0.35 + 0.65 * d.confidence);
    weighted += d.score * w;
    weightTotal += w;
  }
  let total = weightTotal > 0 ? weighted / weightTotal : 60;

  // A garment that physically doesn't fit can't be talked up by anything else.
  if (fitSub.score < 45 && fitSub.confidence > 0.3) total = Math.min(total, 55);
  if (blocking.length) total = Math.min(total, 30);

  const confidence = dimensions.reduce((s, d) => s + d.confidence * d.weight, 0) /
    dimensions.reduce((s, d) => s + d.weight, 0);

  const verdict: Verdict = blocking.length ? "skip" : total >= 76 ? "wear-it" : total >= 60 ? "close" : "skip";

  /* ------------------------------------------------------------- fixes -- */
  const allReasons = [...completeness, ...dimensions.flatMap((d) => d.reasons)];
  const seen = new Set<string>();
  const topFixes = allReasons
    .filter((r) => (r.severity === "warn" || r.severity === "bad") && r.fix)
    .sort((a, b) => (a.impact ?? 0) - (b.impact ?? 0))
    .filter((r) => {
      if (seen.has(r.fix!)) return false;
      seen.add(r.fix!);
      return true;
    })
    .slice(0, 4);

  return {
    total: Math.round(total),
    verdict,
    headline: headlineFor(verdict, total, dimensions, blocking, garments),
    confidence,
    dimensions,
    topFixes,
    fitReports: reports,
  };
}

function headlineFor(
  verdict: Verdict,
  total: number,
  dimensions: SubScore[],
  blocking: Reason[],
  garments: Garment[],
): string {
  if (blocking.length) return blocking[0].text;

  const ranked = [...dimensions].sort((a, b) => a.score - b.score);
  const weakest = ranked[0];
  const strongest = ranked[ranked.length - 1];

  if (verdict === "wear-it") {
    if (total >= 88) return `Wear it. ${strongest.label} is doing real work here.`;
    return `Wear it — ${strongest.label.toLowerCase()} is strong and nothing is fighting it.`;
  }
  if (verdict === "close") {
    return `Almost. ${weakest.label} is the piece holding it back.`;
  }
  if (weakest.key === "fit") {
    const bad = weakest.reasons.find((r) => r.severity === "bad" || r.severity === "warn");
    return bad ? `Skip it — ${bad.text.toLowerCase()}` : "Skip it — the fit isn't there.";
  }
  return `Skip it. ${weakest.label} is too far off to rescue with a tweak.`;
}

/* ------------------------------------------------------------ formatting -- */

export const VERDICT_COPY: Record<Verdict, { label: string; tone: string }> = {
  "wear-it": { label: "Wear it", tone: "good" },
  close: { label: "Close — one tweak", tone: "warn" },
  skip: { label: "Skip it", tone: "bad" },
};

/** Everything the user could add, ranked by how much it would sharpen the answer. */
export function confidenceGaps(score: OutfitScore): { text: string; dimension: string }[] {
  const out: { text: string; dimension: string }[] = [];
  for (const d of score.dimensions) {
    if (d.confidence >= 0.8) continue;
    for (const m of d.missingData ?? []) out.push({ text: m, dimension: d.label });
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true))).slice(0, 6);
}
