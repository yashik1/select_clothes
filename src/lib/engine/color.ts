/**
 * Outfit colour scoring.
 *
 * Three separate questions, deliberately kept apart because they can disagree:
 *   1. Do these colours work *with each other*? (harmony)
 *   2. Do they work *on this person*? (palette match)
 *   3. Is the outfit's light-to-dark contrast pitched at the level this
 *      person's own colouring can carry? (contrast)
 *
 * A navy-and-camel outfit is beautifully harmonious and can still wash out a
 * Deep Winter. Most apps collapse these into one "colour score" and end up
 * unable to say anything useful.
 */
import { deriveSeason, matchColorToSeason, type SeasonBand } from "../color/palette";
import {
  NEUTRAL_CHROMA,
  describeColor,
  hexToLch,
  hueDistance,
  type LCh,
} from "../color/space";
import { subcategoryDef } from "../data/garmentTypes";
import type { Garment, Profile, Reason, SubScore } from "../types";

/** How much of the visible outfit each slot occupies. */
const AREA_WEIGHT: Record<string, number> = {
  dress: 1.0,
  top: 0.75,
  bottom: 0.85,
  outerwear: 0.95,
  shoes: 0.3,
  bag: 0.2,
  accessory: 0.12,
};

/** Colours worn near the face do the most work for or against your complexion. */
const FACE_PROXIMITY: Record<string, number> = {
  top: 1.0,
  dress: 0.85,
  outerwear: 0.9,
  accessory: 0.5,
  bottom: 0.25,
  shoes: 0.1,
  bag: 0.15,
};

interface ColorEntry {
  garment: Garment;
  hex: string;
  lch: LCh;
  area: number;
  face: number;
  neutral: boolean;
}

function entries(garments: Garment[]): ColorEntry[] {
  const out: ColorEntry[] = [];
  for (const g of garments) {
    const area = AREA_WEIGHT[g.category] ?? 0.3;
    const face = FACE_PROXIMITY[g.category] ?? 0.3;
    for (const c of g.colors.slice(0, 2)) {
      const lch = hexToLch(c.hex);
      out.push({
        garment: g,
        hex: c.hex,
        lch,
        area: area * (c.share || 1),
        face: face * (c.share || 1),
        neutral: lch.C < NEUTRAL_CHROMA,
      });
    }
  }
  return out;
}

/** Named relationship between two chromatic hues. */
function harmonyOf(h1: number, h2: number): { kind: string; score: number } {
  const d = hueDistance(h1, h2);
  if (d < 18) return { kind: "monochrome", score: 88 };
  if (d < 48) return { kind: "analogous", score: 92 };
  if (d < 95) return { kind: "unresolved", score: 56 };
  if (d < 145) return { kind: "split-complementary", score: 80 };
  if (d <= 180) return { kind: "complementary", score: 82 };
  return { kind: "unresolved", score: 60 };
}

export function scoreColor(garments: Garment[], profile: Profile): SubScore {
  const reasons: Reason[] = [];
  const missingData: string[] = [];
  const items = entries(garments);

  if (items.length === 0) {
    return {
      key: "color", label: "Colour", score: 70, confidence: 0, weight: 1,
      reasons: [], missingData: ["colours for these items"],
    };
  }

  const season = deriveSeason(profile.coloring);
  const band: SeasonBand = season.band;
  if (season.missing.length) {
    missingData.push(...season.missing.map((m) => `your ${m}`));
  }

  /* ------------------------------------------------- 1. palette match -- */
  let paletteWeighted = 0;
  let paletteWeight = 0;
  const paletteFindings: { entry: ColorEntry; score: number; note: string }[] = [];

  for (const e of items) {
    const m = matchColorToSeason(e.hex, band);
    const w = e.face;
    paletteWeighted += m.score * w;
    paletteWeight += w;
    paletteFindings.push({ entry: e, score: m.score, note: m.note });
  }
  const paletteScore = paletteWeight > 0 ? paletteWeighted / paletteWeight : 70;

  paletteFindings.sort((a, b) => a.score - b.score);
  const worstPalette = paletteFindings[0];
  if (worstPalette && worstPalette.score < 55 && worstPalette.entry.face >= 0.5) {
    reasons.push({
      severity: "warn",
      text: `The ${describeColor(worstPalette.entry.hex)} ${worstPalette.entry.garment.name.toLowerCase()} ${worstPalette.note} (${season.season}).`,
      fix: "Move it away from your face — as a bottom or a jacket worn open — or pair it with a collar in one of your palette colours.",
      garmentIds: [worstPalette.entry.garment.id],
      impact: -12,
    });
  }
  const bestPalette = paletteFindings[paletteFindings.length - 1];
  if (bestPalette && bestPalette.score >= 80 && bestPalette.entry.face >= 0.5) {
    reasons.push({
      severity: "good",
      text: `${describeColor(bestPalette.entry.hex)} is one of your ${season.season} colours and it's sitting right by your face.`,
      garmentIds: [bestPalette.entry.garment.id],
      impact: 6,
    });
  }

  /* ----------------------------------------------------- 2. harmony -- */
  const chromatic = items.filter((e) => !e.neutral);
  let harmonyScore = 90;

  if (chromatic.length === 0) {
    reasons.push({
      severity: "info",
      text: "All neutrals. Safe and quiet — texture is what will keep it from reading flat.",
      impact: 0,
    });
    harmonyScore = 82;
  } else if (chromatic.length === 1) {
    harmonyScore = 93;
    reasons.push({
      severity: "good",
      text: `One colour against neutrals: the ${describeColor(chromatic[0].hex)} ${chromatic[0].garment.name.toLowerCase()} carries the outfit.`,
      impact: 4,
    });
  } else {
    let total = 0;
    let weight = 0;
    let worst: { a: ColorEntry; b: ColorEntry; kind: string; score: number } | null = null;

    for (let i = 0; i < chromatic.length; i++) {
      for (let j = i + 1; j < chromatic.length; j++) {
        const a = chromatic[i];
        const b = chromatic[j];
        if (a.garment.id === b.garment.id) continue;
        const h = harmonyOf(a.lch.h, b.lch.h);

        // Two colours both shouting at full saturation is the actual clash;
        // the same hue pair at lower chroma is simply a colour scheme.
        const bothVivid = a.lch.C > 55 && b.lch.C > 55;
        const score = h.score - (bothVivid && h.kind === "unresolved" ? 14 : 0);

        const w = a.area * b.area;
        total += score * w;
        weight += w;
        if (!worst || score < worst.score) worst = { a, b, kind: h.kind, score };
      }
    }
    harmonyScore = weight > 0 ? total / weight : 85;

    if (worst && worst.score < 65) {
      reasons.push({
        severity: "warn",
        text: `${describeColor(worst.a.hex)} and ${describeColor(worst.b.hex)} sit in an awkward part of the colour wheel — close enough to compete, far enough to jar.`,
        fix: `Push one of them to a neutral, or swap the ${worst.b.garment.name.toLowerCase()} for something in the same family as the ${describeColor(worst.a.hex)}.`,
        garmentIds: [worst.a.garment.id, worst.b.garment.id],
        impact: -14,
      });
    } else if (worst && worst.score >= 80) {
      // Two navies a few ΔE apart get the same name, and "deep muted blue and
      // deep muted blue form a monochrome pairing" reads like a bug. When the
      // names collide, say what is actually true: they're two shades of one
      // colour, which is the whole point of a monochrome pairing anyway.
      const a = describeColor(worst.a.hex);
      const b = describeColor(worst.b.hex);
      reasons.push({
        severity: "good",
        text:
          a === b
            ? `Two shades of ${a} — a ${worst.kind} pairing that reads as deliberate.`
            : `${a} and ${b} form a ${worst.kind} pairing.`,
        impact: 5,
      });
    }

    if (chromatic.length >= 4) {
      harmonyScore -= 10;
      reasons.push({
        severity: "warn",
        text: `${chromatic.length} separate colours competing for attention.`,
        fix: "Drop one to a neutral. Three colours is a scheme; four is a collision.",
        impact: -10,
      });
    }
  }

  /* ---------------------------------------------------- 3. contrast -- */
  const areaWeighted = items.filter((e) => e.area >= 0.3);
  const Ls = areaWeighted.map((e) => e.lch.L);
  const outfitContrast = Ls.length >= 2 ? (Math.max(...Ls) - Math.min(...Ls)) / 100 : 0.3;
  const personal = season.axes.contrast;
  const contrastGap = outfitContrast - personal;

  let contrastScore = 100 - Math.abs(contrastGap) * 85;
  contrastScore = Math.max(30, Math.min(100, contrastScore));

  if (contrastGap < -0.28) {
    reasons.push({
      severity: "warn",
      text: "This outfit is flatter in light-to-dark than your own colouring, so it will read washed out next to your face.",
      fix: "Swap one piece for something markedly darker or lighter — a white tee under a mid-tone jacket does it.",
      impact: -10,
    });
  } else if (contrastGap > 0.32) {
    reasons.push({
      severity: "warn",
      text: "The contrast here is higher than your own — the clothes will get looked at before you do.",
      fix: "Bring the two main pieces closer in depth, or break the hard edge with a mid-tone layer.",
      impact: -8,
    });
  } else {
    reasons.push({
      severity: "good",
      text: "Light-to-dark contrast is pitched at about your own level.",
      impact: 4,
    });
  }

  /* ----------------------------------------------------- 4. pattern -- */
  const bold = garments.filter(
    (g) => g.pattern !== "solid" && (g.patternScale === "bold" || g.patternScale === "medium"),
  );
  let patternPenalty = 0;
  if (bold.length >= 2) {
    const sameScale = bold[0].patternScale === bold[1].patternScale;
    patternPenalty = sameScale ? 12 : 5;
    reasons.push({
      severity: sameScale ? "warn" : "info",
      text: sameScale
        ? `Two ${bold[0].patternScale} patterns at the same scale fight each other.`
        : "Two patterns, different scales — this works if you meant it.",
      fix: sameScale ? "Keep the pattern you like most and take the other to a solid." : undefined,
      garmentIds: bold.slice(0, 2).map((g) => g.id),
      impact: -patternPenalty,
    });
  }

  const score = Math.max(
    0,
    Math.min(100, paletteScore * 0.34 + harmonyScore * 0.42 + contrastScore * 0.24 - patternPenalty),
  );

  const coverage = Math.min(1, items.length / Math.max(2, garments.length));
  const confidence = Math.max(0.15, Math.min(0.95, season.confidence * 0.55 + coverage * 0.45));

  return {
    key: "color",
    label: "Colour",
    score,
    confidence,
    weight: 1,
    reasons,
    missingData,
  };
}
