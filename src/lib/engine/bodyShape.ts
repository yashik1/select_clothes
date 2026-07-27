/**
 * Body shape and proportion derivation.
 *
 * Shape is scored across all five archetypes rather than matched by a chain of
 * if-statements, so a body that sits between two shapes gets an honest
 * "somewhere between rectangle and pear" instead of being forced into one box.
 */
import type { BodyMeasurements, BodyShape, Profile } from "../types";

export interface BodyAnalysis {
  shape: BodyShape;
  runnerUp: BodyShape | null;
  confidence: number;
  ratios: {
    /** Shoulder (or chest) against hip. >1 = broader up top. */
    shoulderToHip: number | null;
    waistToHip: number | null;
    chestToHip: number | null;
    /** Inseam ÷ height. Population average sits around 0.46. */
    legToHeight: number | null;
  };
  /** Plain-language observations used in advice copy. */
  notes: string[];
  missing: string[];
}

const SHAPES: BodyShape[] = ["hourglass", "pear", "apple", "rectangle", "inverted-triangle"];

export function deriveBodyShape(m: BodyMeasurements, override?: BodyShape | null): BodyAnalysis {
  const missing: string[] = [];
  const need = (v: number | undefined, name: string) => {
    if (typeof v !== "number" || v <= 0) {
      missing.push(name);
      return null;
    }
    return v;
  };

  const chest = need(m.chest, "chest / bust");
  const waist = need(m.waistNatural, "natural waist");
  const hip = need(m.hip, "hip");
  const shoulder = typeof m.shoulderWidth === "number" ? m.shoulderWidth : null;
  const height = typeof m.height === "number" ? m.height : null;
  const inseam = typeof m.inseam === "number" ? m.inseam : null;

  // Shoulder width is a span, not a circumference, so it can't be compared to
  // the hip directly. Chest is the usable proxy; shoulder only nudges it.
  const upper = chest !== null ? (shoulder !== null ? chest + (shoulder - chest * 0.44) * 1.2 : chest) : null;

  const ratios = {
    shoulderToHip: upper !== null && hip !== null ? upper / hip : null,
    waistToHip: waist !== null && hip !== null ? waist / hip : null,
    chestToHip: chest !== null && hip !== null ? chest / hip : null,
    legToHeight: inseam !== null && height !== null ? inseam / height : null,
  };

  if (ratios.chestToHip === null || ratios.waistToHip === null) {
    return {
      shape: override ?? "unknown",
      runnerUp: null,
      confidence: override ? 1 : 0,
      ratios,
      notes: [],
      missing,
    };
  }

  const ch = ratios.chestToHip;
  const wh = ratios.waistToHip;
  const chestWaist = chest !== null && waist !== null ? waist / chest : wh;

  // Each archetype scores how well the two governing ratios match it. Lower is
  // better; the winner is the smallest error.
  const err: Record<BodyShape, number> = {
    hourglass: sq(ch - 1.0) * 3.2 + sq(Math.max(0, wh - 0.75)) * 6 + sq(Math.max(0, chestWaist - 0.78)) * 5,
    pear: sq(Math.max(0, ch - 0.94)) * 6 + sq(Math.max(0, wh - 0.82)) * 2.5,
    "inverted-triangle": sq(Math.max(0, 1.07 - ch)) * 6 + sq(Math.max(0, wh - 0.85)) * 2,
    apple: sq(Math.max(0, 0.86 - wh)) * 7 + sq(ch - 1.0) * 1.6,
    rectangle: sq(ch - 1.0) * 3.0 + sq(Math.max(0, 0.8 - wh)) * 6 + sq(Math.max(0, 0.8 - chestWaist)) * 4,
    unknown: 99,
  };

  const ranked = SHAPES.map((s) => ({ s, e: err[s] })).sort((a, b) => a.e - b.e);
  const shape = override ?? ranked[0].s;
  const margin = Math.min(1, (ranked[1].e - ranked[0].e) * 9);
  const coverage = (chest !== null ? 1 : 0) * 0.35 + (waist !== null ? 1 : 0) * 0.35 + (hip !== null ? 1 : 0) * 0.2 + (shoulder !== null ? 1 : 0) * 0.1;
  const confidence = override ? 1 : Math.max(0.1, Math.min(0.95, coverage * 0.6 + margin * 0.4));

  const notes: string[] = [];
  if (ratios.legToHeight !== null) {
    if (ratios.legToHeight < 0.44) notes.push("long torso relative to your legs");
    else if (ratios.legToHeight > 0.485) notes.push("long legs relative to your torso");
    else notes.push("balanced torso-to-leg proportion");
  } else {
    missing.push("height and inseam (for leg-to-torso proportion)");
  }
  if (wh < 0.72) notes.push("a strongly defined waist");
  else if (wh > 0.86) notes.push("a straight waistline");

  return { shape, runnerUp: ranked[1].s, confidence, ratios, notes, missing };
}

const sq = (x: number) => x * x;

export const SHAPE_LABEL: Record<BodyShape, string> = {
  hourglass: "Hourglass",
  pear: "Pear / triangle",
  apple: "Apple / round",
  rectangle: "Rectangle",
  "inverted-triangle": "Inverted triangle",
  unknown: "Not enough data",
};

/**
 * What each shape is trying to achieve. These aren't rules about hiding
 * anything — they're the geometry of where the eye lands, which is what makes
 * an outfit read as intentional.
 */
export const SHAPE_STRATEGY: Record<BodyShape, { goal: string; likes: string[]; watch: string[] }> = {
  hourglass: {
    goal: "Keep the waist visible; your proportions already balance themselves.",
    likes: ["waist-defining seams and belts", "wrap and fit-and-flare shapes", "single-layer silhouettes"],
    watch: ["boxy volume that erases the waist", "stiff fabrics that bridge from bust to hip"],
  },
  pear: {
    goal: "Bring visual weight upward so shoulder and hip read even.",
    likes: ["detail, colour and structure above the waist", "straight or wide-leg bottoms", "defined shoulders"],
    watch: ["clingy bottoms with a plain top", "hems that cut across the widest part of the hip"],
  },
  apple: {
    goal: "Create a long vertical line and let the waist breathe.",
    likes: ["open necklines and V-shapes", "straight and A-line cuts that skim", "long unbroken layers"],
    watch: ["tight waistbands under the fullest point", "belts that cinch rather than skim"],
  },
  rectangle: {
    goal: "Manufacture curve by breaking the vertical line at the waist.",
    likes: ["belts, tucks and peplums", "layers that add dimension", "volume-then-fitted contrasts"],
    watch: ["straight-up-and-down silhouettes head to toe", "boxy over boxy"],
  },
  "inverted-triangle": {
    goal: "Add visual weight below the waist to meet the shoulder line.",
    likes: ["wide-leg, pleated and full skirts", "simple, uncluttered tops", "V and scoop necklines"],
    watch: ["shoulder detail, puff sleeves and heavy epaulettes", "skinny bottoms with a structured top"],
  },
  unknown: { goal: "Add a few measurements and this becomes specific.", likes: [], watch: [] },
};

export function analyseProfile(profile: Profile): BodyAnalysis {
  return deriveBodyShape(profile.measurements, profile.bodyShapeOverride);
}
