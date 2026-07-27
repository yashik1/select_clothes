/**
 * Personal colour analysis.
 *
 * The 12-season system is usually taught as a lookup table of swatch cards.
 * Here it's expressed as three continuous axes — temperature, depth and chroma
 * — because continuous axes give us two things a lookup table can't: a
 * *confidence* value, and a smooth score for colours that sit between seasons
 * rather than a binary in/out.
 */
import type { ColoringProfile, SeasonName } from "../types";
import { hexToLch, lchToHex, type LCh } from "./space";

export interface SeasonBand {
  /** Centre of the flattering lightness range, in L*. */
  L: number;
  /** Half-width of that range. */
  wL: number;
  /** Centre of the flattering chroma range, in C*. */
  C: number;
  wC: number;
  /** -1 (needs cool colours) to +1 (needs warm colours). */
  warm: number;
  blurb: string;
}

export const SEASONS: Record<SeasonName, SeasonBand> = {
  "Bright Winter": { L: 50, wL: 28, C: 62, wC: 28, warm: -0.35, blurb: "Clear, icy and saturated. You can carry colour at full volume." },
  "True Winter": { L: 45, wL: 28, C: 55, wC: 26, warm: -0.9, blurb: "Cool and crisp. Pure white, true red, and blue-based everything." },
  "Deep Winter": { L: 32, wL: 24, C: 48, wC: 26, warm: -0.45, blurb: "Dark and cool. Your best colours are the ones that look almost black." },
  "Bright Spring": { L: 60, wL: 26, C: 62, wC: 28, warm: 0.5, blurb: "Warm and vivid. Clarity matters more than temperature here." },
  "True Spring": { L: 62, wL: 26, C: 55, wC: 26, warm: 0.9, blurb: "Golden and lively. Warm, clear, medium-light colours." },
  "Light Spring": { L: 74, wL: 22, C: 42, wC: 24, warm: 0.55, blurb: "Delicate and warm. Keep everything light — depth overwhelms you." },
  "Light Summer": { L: 72, wL: 22, C: 32, wC: 22, warm: -0.5, blurb: "Soft, cool and light. Think watercolour rather than poster paint." },
  "True Summer": { L: 60, wL: 26, C: 30, wC: 20, warm: -0.9, blurb: "Cool and gently muted. Navy, rose and slate over black and orange." },
  "Soft Summer": { L: 55, wL: 26, C: 22, wC: 18, warm: -0.35, blurb: "Muted and cool-neutral. Dusty, greyed colours are your whole game." },
  "Soft Autumn": { L: 56, wL: 26, C: 26, wC: 20, warm: 0.4, blurb: "Muted and warm. Colours that look like they've been left in the sun." },
  "True Autumn": { L: 48, wL: 26, C: 42, wC: 24, warm: 0.9, blurb: "Rich, warm and earthy. Rust, olive, moss, camel, bronze." },
  "Deep Autumn": { L: 34, wL: 24, C: 44, wC: 26, warm: 0.5, blurb: "Deep and warm. Spice tones and forest darks, no pastels." },
};

export const SEASON_NAMES = Object.keys(SEASONS) as SeasonName[];

/** Where each season sits on the three axes, for the derivation step. */
const SEASON_AXES: Record<SeasonName, { temp: number; depth: number; chroma: number }> = {
  "Bright Winter": { temp: -0.4, depth: 0.6, chroma: 1.0 },
  "True Winter": { temp: -1.0, depth: 0.72, chroma: 0.8 },
  "Deep Winter": { temp: -0.5, depth: 1.0, chroma: 0.7 },
  "Bright Spring": { temp: 0.5, depth: 0.4, chroma: 1.0 },
  "True Spring": { temp: 1.0, depth: 0.35, chroma: 0.8 },
  "Light Spring": { temp: 0.5, depth: 0.15, chroma: 0.62 },
  "Light Summer": { temp: -0.5, depth: 0.15, chroma: 0.4 },
  "True Summer": { temp: -1.0, depth: 0.4, chroma: 0.3 },
  "Soft Summer": { temp: -0.4, depth: 0.5, chroma: 0.1 },
  "Soft Autumn": { temp: 0.4, depth: 0.5, chroma: 0.1 },
  "True Autumn": { temp: 1.0, depth: 0.6, chroma: 0.35 },
  "Deep Autumn": { temp: 0.5, depth: 1.0, chroma: 0.5 },
};

export interface SeasonAnalysis {
  season: SeasonName;
  band: SeasonBand;
  axes: { temp: number; depth: number; chroma: number; contrast: number };
  /** 0-1. Low when the user only filled in part of the colouring profile. */
  confidence: number;
  runnerUp: SeasonName;
  missing: string[];
}

/**
 * A colour's own temperature, derived from hue angle: yellow (~60°) is the
 * warmest point on the wheel, blue (~240°) the coolest.
 */
export function colorTemperature(h: number): number {
  return Math.cos(((h - 60) * Math.PI) / 180);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function deriveSeason(coloring: ColoringProfile): SeasonAnalysis {
  const missing: string[] = [];
  let signals = 0;

  // --- depth: how dark the whole person reads -----------------------------
  let depth = 0.5;
  if (typeof coloring.skinDepth === "number") {
    depth = clamp((coloring.skinDepth - 1) / 9, 0, 1);
    signals++;
  } else {
    missing.push("skin depth");
  }
  let hair: LCh | null = null;
  if (coloring.hairHex) {
    hair = hexToLch(coloring.hairHex);
    depth = depth * 0.55 + clamp(1 - hair.L / 85, 0, 1) * 0.45;
    signals++;
  } else {
    missing.push("hair colour");
  }

  // --- temperature --------------------------------------------------------
  let temp = 0;
  if (coloring.undertone) {
    temp =
      coloring.undertone === "warm" ? 0.85
      : coloring.undertone === "cool" ? -0.85
      : coloring.undertone === "olive" ? 0.15
      : 0;
    signals++;
  } else {
    missing.push("undertone");
  }
  if (hair && hair.C > 8) {
    // Golden and red hair pull warm; ash and blue-black pull cool.
    temp = temp * 0.7 + clamp(colorTemperature(hair.h), -1, 1) * 0.3;
  }

  // --- contrast and chroma ------------------------------------------------
  let eye: LCh | null = null;
  if (coloring.eyeHex) {
    eye = hexToLch(coloring.eyeHex);
    signals++;
  } else {
    missing.push("eye colour");
  }

  // Skin lightness estimated from the depth scale, so contrast is available
  // even when the user skipped the hair/eye swatches.
  const skinL = 95 - depth * 70;
  const contrast = hair ? clamp(Math.abs(hair.L - skinL) / 60, 0, 1) : 0.5;

  // Clear/bright people have saturated eyes and high hair-to-skin contrast.
  const eyeClarity = eye ? clamp(eye.C / 45, 0, 1) : 0.45;
  const chroma = clamp(eyeClarity * 0.55 + contrast * 0.45, 0, 1);

  const axes = { temp, depth, chroma, contrast };

  const scored = SEASON_NAMES.map((name) => {
    const t = SEASON_AXES[name];
    const err =
      1.35 * (temp - t.temp) ** 2 + 1.0 * (depth - t.depth) ** 2 + 0.9 * (chroma - t.chroma) ** 2;
    return { name, err };
  }).sort((a, b) => a.err - b.err);

  const season = coloring.seasonOverride ?? scored[0].name;

  // Confidence combines "how much did you tell us" with "how clearly did one
  // season win". A dead heat between two seasons should not look certain.
  const coverage = signals / 4;
  const margin = clamp((scored[1].err - scored[0].err) * 2.2, 0, 1);
  const confidence = coloring.seasonOverride
    ? 1
    : clamp(coverage * 0.65 + margin * 0.35, 0.1, 0.97);

  return {
    season,
    band: SEASONS[season],
    axes,
    confidence,
    runnerUp: scored[1].name,
    missing,
  };
}

/** Personal contrast level, 0-1. Drives the "is this outfit flatter than you" check. */
export function personalContrast(coloring: ColoringProfile): number {
  return deriveSeason(coloring).axes.contrast;
}

const gauss = (value: number, centre: number, width: number) =>
  Math.exp(-((value - centre) ** 2) / (2 * (width / 1.6) ** 2));

export interface ColorMatch {
  /** 0-100: how well this colour suits the person. */
  score: number;
  temperatureFit: number;
  lightnessFit: number;
  chromaFit: number;
  note: string;
}

/** How flattering a single colour is against a season band. */
export function matchColorToSeason(hex: string, band: SeasonBand): ColorMatch {
  const { L, C, h } = hexToLch(hex);

  // Near-neutrals barely carry temperature, so their temperature error counts
  // proportionally less. A stark white still reads cool, though, so it never
  // drops to zero weight.
  const chromaWeight = clamp(C / 40, 0.28, 1);
  const temperatureFit = 1 - (Math.abs(band.warm - colorTemperature(h)) / 2) * chromaWeight;

  const lightnessFit = gauss(L, band.L, band.wL);
  // Neutrals are exempt from the chroma band — grey is grey in every season.
  const chromaFit = C < 12 ? 0.92 : gauss(C, band.C, band.wC);

  const score = clamp(
    (temperatureFit * 0.4 + lightnessFit * 0.3 + chromaFit * 0.3) * 100,
    0,
    100,
  );

  // Every note is phrased as a predicate ("is one of…", "reads cool…") so
  // callers can drop it straight after a garment name without patching grammar.
  let note = "sits comfortably in your palette";
  const worst = Math.min(temperatureFit, lightnessFit, chromaFit);
  if (score >= 78) {
    note = "is one of your strongest colours";
  } else if (worst === temperatureFit) {
    note = band.warm > 0 ? "reads cool against your warm colouring" : "reads warm against your cool colouring";
  } else if (worst === lightnessFit) {
    note = L > band.L ? "is lighter than your best range" : "is darker than your best range";
  } else {
    note = C > band.C ? "is more saturated than your palette likes" : "is more muted than your palette likes";
  }

  return { score, temperatureFit, lightnessFit, chromaFit, note };
}

/**
 * Generate the season's swatch card. Deriving it from the same band the
 * scoring uses guarantees the palette shown to the user and the palette the
 * engine grades against can never drift apart.
 */
export function paletteSwatches(band: SeasonBand): { hex: string; label: string }[] {
  const out: { hex: string; label: string }[] = [];

  for (let h = 0; h < 360; h += 15) {
    if (Math.abs(band.warm - colorTemperature(h)) / 2 > 0.42) continue;
    out.push({ hex: lchToHex({ L: band.L, C: band.C, h }), label: "" });
  }

  // Two lighter and two deeper variants of the best hue keep the card usable
  // as an actual shopping reference rather than a flat row.
  const anchor = out.length ? hexToLch(out[Math.floor(out.length / 2)].hex).h : 220;
  const extras: LCh[] = [
    { L: clamp(band.L + band.wL * 0.8, 20, 94), C: band.C * 0.7, h: anchor },
    { L: clamp(band.L - band.wL * 0.8, 12, 90), C: band.C * 0.85, h: anchor },
  ];

  // Neutrals, tinted toward the season's temperature so "white" is the right white.
  const neutralHue = band.warm > 0 ? 70 : 250;
  const neutrals: LCh[] = [
    { L: 94, C: 4, h: neutralHue },
    { L: 68, C: 5, h: neutralHue },
    { L: 40, C: 6, h: neutralHue },
    { L: 18, C: 5, h: neutralHue },
  ];

  return [
    ...out.map((s) => ({ hex: s.hex, label: "" })),
    ...extras.map((l) => ({ hex: lchToHex(l), label: "" })),
    ...neutrals.map((l) => ({ hex: lchToHex(l), label: "neutral" })),
  ];
}
