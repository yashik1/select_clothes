/**
 * What a human body can actually measure.
 *
 * Every engine in this app multiplies and divides these numbers, and a wrong
 * one doesn't announce itself — it produces a confident score against a body
 * that cannot exist. The failure that prompted this: an inches profile with a
 * height of "5.4", meant as five foot four. That stored 13.7cm, and since
 * every landmark height and every unmeasured girth is a fraction of stature,
 * the whole figure collapsed around it while the fit engine went on scoring.
 *
 * So these bounds reject the impossible, not the unusual. They are deliberately
 * wide: the smallest and largest adults alive sit comfortably inside them, and
 * a measurement is only refused when no body could have produced it.
 */
import type { BodyMeasurements, Unit } from "./types";
import { formatLength, toDisplay } from "./units";

export interface Bounds {
  /** Centimetres, except `weight`, which is kilograms. */
  min: number;
  max: number;
}

/**
 * Sources for the extremes: the shortest and tallest recorded adults (~55cm
 * and ~272cm) sit outside these, but so does every typo, and someone at either
 * end is better served by an odd-looking figure than by a form that calls them
 * impossible. The bounds below are set where "no adult is this" becomes true
 * of essentially everyone.
 */
export const BOUNDS: Record<keyof BodyMeasurements, Bounds> = {
  height: { min: 90, max: 250 },
  /** Kilograms. */
  weight: { min: 20, max: 400 },

  neck: { min: 20, max: 70 },
  shoulderWidth: { min: 25, max: 70 },
  chest: { min: 50, max: 200 },
  underbust: { min: 45, max: 190 },
  waistNatural: { min: 40, max: 200 },
  waistWorn: { min: 40, max: 200 },
  highHip: { min: 45, max: 200 },
  hip: { min: 50, max: 220 },
  thigh: { min: 25, max: 110 },
  calf: { min: 20, max: 80 },

  bicep: { min: 15, max: 70 },
  wrist: { min: 10, max: 30 },
  armLength: { min: 35, max: 95 },
  sleeveFromCenterBack: { min: 45, max: 115 },

  torsoLength: { min: 25, max: 75 },
  backLength: { min: 25, max: 75 },
  inseam: { min: 40, max: 115 },
  outseam: { min: 55, max: 145 },
  riseFront: { min: 12, max: 50 },

  footLength: { min: 15, max: 40 },
};

/** Measured around, rather than across or along. */
const GIRTHS: (keyof BodyMeasurements)[] = [
  "neck", "chest", "underbust", "waistNatural", "waistWorn",
  "highHip", "hip", "thigh", "calf", "bicep", "wrist",
];

export interface Problem {
  key: keyof BodyMeasurements;
  message: string;
}

/**
 * Weight is the one field that isn't a length, so it converts by mass and
 * reads in pounds rather than inches.
 */
const isWeight = (key: keyof BodyMeasurements) => key === "weight";

function show(key: keyof BodyMeasurements, value: number, unit: Unit): string {
  if (isWeight(key)) {
    const v = unit === "in" ? value / 0.45359237 : value;
    return `${Math.round(v * 10) / 10}${unit === "in" ? "lb" : "kg"}`;
  }
  return formatLength(value, unit);
}

/**
 * One field on its own. Returns null when the value could belong to a body.
 */
export function boundsProblem(
  key: keyof BodyMeasurements,
  value: number | undefined | null,
  unit: Unit,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const bounds = BOUNDS[key];
  if (!bounds) return null;

  if (value < bounds.min) {
    /*
     * Naming the likely cause matters more than naming the bound. Someone who
     * is only told "too small" retypes something equally wrong; the two ways
     * a plausible-looking number gets here are a height written as feet, and
     * a girth measured across the body rather than around it — which comes
     * out at almost exactly half.
     */
    let hint = "";
    if (key === "height" && unit === "in" && value < 30) {
      hint = ` — if you meant five foot four, that's 5ft 4in, not 5.4`;
    } else if (GIRTHS.includes(key) && value * 2 >= bounds.min) {
      hint = ` — that's about half what it should be, so check the tape went all the way around rather than across`;
    }
    return `${show(key, value, unit)} is too small to be a real measurement; the lowest this accepts is ${show(key, bounds.min, unit)}${hint}.`;
  }
  if (value > bounds.max) {
    return `${show(key, value, unit)} is larger than any body measures; the highest this accepts is ${show(key, bounds.max, unit)}.`;
  }
  return null;
}

/**
 * The whole profile, including the relationships between fields. A value can
 * be individually plausible and still impossible next to another — a 95cm
 * chest is ordinary until it belongs to someone 90cm tall.
 */
export function measurementProblems(m: BodyMeasurements, unit: Unit): Problem[] {
  const problems: Problem[] = [];

  for (const key of Object.keys(m) as (keyof BodyMeasurements)[]) {
    const message = boundsProblem(key, m[key], unit);
    if (message) problems.push({ key, message });
  }

  // Height first wherever only one can be shown: every landmark position and
  // every unmeasured girth is a fraction of it, so a wrong stature is the one
  // that makes everything else wrong too.
  problems.sort((p, q) => Number(q.key === "height") - Number(p.key === "height"));

  const flagged = new Set(problems.map((p) => p.key));
  const height = m.height;
  if (typeof height !== "number" || flagged.has("height")) return problems;

  // Nothing worn on the body is longer than the body is tall.
  for (const key of ["inseam", "outseam", "armLength", "torsoLength", "backLength"] as const) {
    const value = m[key];
    if (typeof value === "number" && !flagged.has(key) && value >= height) {
      problems.push({
        key,
        message: `${show(key, value, unit)} is longer than your height of ${show("height", height, unit)}.`,
      });
    }
  }

  /*
   * A girth can genuinely exceed a stature — a very large person of 165cm can
   * measure 175cm around, and achondroplasia puts a full-sized torso on a
   * 95cm frame. Both are real people and neither may be told they are not.
   * What no body does is exceed it by half again, so that is where the line
   * goes: loose enough to be certain, tight enough to catch a height entered
   * in the wrong unit that happened to land inside its own bounds.
   */
  const RATIO = 1.4;
  for (const key of GIRTHS) {
    const value = m[key];
    if (typeof value === "number" && !flagged.has(key) && value > height * RATIO) {
      problems.push({
        key,
        message: `${show(key, value, unit)} around is far more than your whole height of ${show("height", height, unit)} — check which one is wrong.`,
      });
    }
  }

  return problems;
}

/** Convenience for the form: the first problem on a given field, if any. */
export function problemFor(problems: Problem[], key: keyof BodyMeasurements): string | undefined {
  return problems.find((p) => p.key === key)?.message;
}

/* ------------------------------------------------------------- height -- */

/**
 * Nobody says they are sixty-four inches tall, which is exactly why a bare
 * inches box invited "5.4". Anyone working in inches gets feet and inches.
 */
export function toFeetInches(cm: number | undefined): { ft: number | ""; inches: number | "" } {
  if (typeof cm !== "number" || !Number.isFinite(cm)) return { ft: "", inches: "" };
  const total = cm / 2.54;
  const ft = Math.floor(total / 12);
  const inches = Math.round((total - ft * 12) * 10) / 10;
  // Rounding 11.97 up to 12 would show "5ft 12in".
  return inches >= 12 ? { ft: ft + 1, inches: 0 } : { ft, inches };
}

export function fromFeetInches(ft: number | "", inches: number | ""): number | undefined {
  const f = typeof ft === "number" ? ft : parseFloat(String(ft));
  const i = typeof inches === "number" ? inches : parseFloat(String(inches));
  const feet = Number.isFinite(f) ? f : 0;
  const rest = Number.isFinite(i) ? i : 0;
  if (!Number.isFinite(f) && !Number.isFinite(i)) return undefined;
  return (feet * 12 + rest) * 2.54;
}

/* ------------------------------------------------------------- weight -- */

export const KG_PER_LB = 0.45359237;

/** Weight is stored in kilograms whatever the profile displays. */
export function weightToDisplay(kg: number | undefined | null, unit: Unit): number | "" {
  if (typeof kg !== "number" || Number.isNaN(kg)) return "";
  const v = unit === "in" ? kg / KG_PER_LB : kg;
  return Math.round(v * 10) / 10;
}

export function weightFromDisplay(value: string | number, unit: Unit): number | undefined {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return undefined;
  return unit === "in" ? n * KG_PER_LB : n;
}

/** Kept for the fields that really are lengths. */
export { toDisplay };
