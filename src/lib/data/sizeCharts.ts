/**
 * Generic size charts.
 *
 * These exist so the app is useful on day one: most people know "it's a
 * medium" but have never put a tape measure to a shirt. A size label lets us
 * infer the body the garment was cut for, which is a real — if lower
 * confidence — fit signal. Anything inferred this way is flagged so the UI can
 * tell the user exactly how to upgrade the answer.
 *
 * Values are industry-typical body measurements in centimetres, not garment
 * measurements. Brand drift on top of these is handled by the calibration loop.
 */
import type { BodyMeasurements, GarmentCategory, SizeSystem } from "../types";

export interface SizeRow {
  size: string;
  /** Body the size is cut for. */
  body: Partial<BodyMeasurements>;
}

const ALPHA_MENS: SizeRow[] = [
  { size: "XS", body: { chest: 86, waistNatural: 74, hip: 88, neck: 36, armLength: 60, shoulderWidth: 42 } },
  { size: "S", body: { chest: 92, waistNatural: 80, hip: 93, neck: 37.5, armLength: 61.5, shoulderWidth: 44 } },
  { size: "M", body: { chest: 100, waistNatural: 87, hip: 99, neck: 39.5, armLength: 63, shoulderWidth: 46 } },
  { size: "L", body: { chest: 108, waistNatural: 95, hip: 106, neck: 41.5, armLength: 64.5, shoulderWidth: 48 } },
  { size: "XL", body: { chest: 116, waistNatural: 104, hip: 113, neck: 43.5, armLength: 66, shoulderWidth: 50 } },
  { size: "XXL", body: { chest: 124, waistNatural: 113, hip: 120, neck: 45.5, armLength: 67, shoulderWidth: 52 } },
  { size: "3XL", body: { chest: 132, waistNatural: 122, hip: 127, neck: 47.5, armLength: 68, shoulderWidth: 54 } },
];

const ALPHA_WOMENS: SizeRow[] = [
  { size: "XXS", body: { chest: 76, waistNatural: 60, hip: 84, shoulderWidth: 35, armLength: 55 } },
  { size: "XS", body: { chest: 80, waistNatural: 63.5, hip: 88, shoulderWidth: 36, armLength: 56 } },
  { size: "S", body: { chest: 85, waistNatural: 68, hip: 93, shoulderWidth: 37.5, armLength: 57 } },
  { size: "M", body: { chest: 90, waistNatural: 73, hip: 98, shoulderWidth: 39, armLength: 58 } },
  { size: "L", body: { chest: 97, waistNatural: 80, hip: 105, shoulderWidth: 40.5, armLength: 59 } },
  { size: "XL", body: { chest: 105, waistNatural: 88, hip: 113, shoulderWidth: 42, armLength: 60 } },
  { size: "XXL", body: { chest: 114, waistNatural: 97, hip: 122, shoulderWidth: 43.5, armLength: 61 } },
  { size: "3XL", body: { chest: 122, waistNatural: 106, hip: 130, shoulderWidth: 45, armLength: 61.5 } },
];

/** Unisex tops are typically cut on the men's block, trimmed slightly. */
const ALPHA_UNISEX: SizeRow[] = ALPHA_MENS.map((r) => ({
  size: r.size,
  body: { ...r.body, chest: r.body.chest! - 2, waistNatural: r.body.waistNatural! - 2 },
}));

const US_WOMENS: SizeRow[] = [
  { size: "00", body: { chest: 78, waistNatural: 61, hip: 85 } },
  { size: "0", body: { chest: 80, waistNatural: 63, hip: 87 } },
  { size: "2", body: { chest: 82.5, waistNatural: 65.5, hip: 90 } },
  { size: "4", body: { chest: 85, waistNatural: 68, hip: 92.5 } },
  { size: "6", body: { chest: 88, waistNatural: 70.5, hip: 95 } },
  { size: "8", body: { chest: 90.5, waistNatural: 73, hip: 98 } },
  { size: "10", body: { chest: 93, waistNatural: 76, hip: 100.5 } },
  { size: "12", body: { chest: 96.5, waistNatural: 79.5, hip: 104 } },
  { size: "14", body: { chest: 100, waistNatural: 83, hip: 107.5 } },
  { size: "16", body: { chest: 104.5, waistNatural: 87.5, hip: 112 } },
  { size: "18", body: { chest: 109, waistNatural: 92, hip: 116.5 } },
  { size: "20", body: { chest: 114, waistNatural: 97, hip: 121 } },
  { size: "22", body: { chest: 119, waistNatural: 102, hip: 126 } },
];

/** UK women's runs 4 numbers above US; EU runs 28 above UK. */
const UK_WOMENS: SizeRow[] = US_WOMENS.map((r) => ({
  size: String(Number(r.size) + 4),
  body: r.body,
}));

const EU_WOMENS: SizeRow[] = UK_WOMENS.map((r) => ({
  size: String(Number(r.size) + 28),
  body: r.body,
}));

/** European tailoring: jacket size is chest in cm halved. */
const EU_MENS: SizeRow[] = [42, 44, 46, 48, 50, 52, 54, 56, 58, 60].map((n) => ({
  size: String(n),
  body: {
    chest: n * 2,
    waistNatural: n * 2 - 13,
    shoulderWidth: 38 + (n - 42) * 0.65,
    armLength: 58 + (n - 42) * 0.35,
  },
}));

const CHARTS: Record<SizeSystem, SizeRow[]> = {
  "alpha-mens": ALPHA_MENS,
  "alpha-womens": ALPHA_WOMENS,
  "alpha-unisex": ALPHA_UNISEX,
  "us-womens": US_WOMENS,
  "uk-womens": UK_WOMENS,
  "eu-womens": EU_WOMENS,
  "eu-mens": EU_MENS,
  "waist-inseam": [],
  "neck-sleeve": [],
  free: [],
};

export const SIZE_SYSTEM_LABELS: Record<SizeSystem, string> = {
  "alpha-mens": "Alpha (men's cut)",
  "alpha-womens": "Alpha (women's cut)",
  "alpha-unisex": "Alpha (unisex)",
  "us-womens": "US numeric (women's)",
  "uk-womens": "UK numeric (women's)",
  "eu-womens": "EU numeric (women's)",
  "eu-mens": "EU tailoring (men's)",
  "waist-inseam": "Waist × inseam (e.g. 32×32)",
  "neck-sleeve": "Neck / sleeve (e.g. 15.5/34)",
  free: "One size / not sure",
};

export function sizeOptions(system: SizeSystem): string[] {
  return CHARTS[system].map((r) => r.size);
}

const IN_TO_CM = 2.54;

/**
 * Resolve a size label into the body measurements the garment was cut for.
 * Returns null when the label can't be parsed, which the caller treats as
 * "no size-chart signal available" rather than an error.
 */
export function bodyForSize(
  system: SizeSystem | undefined,
  size: string | undefined,
  category: GarmentCategory,
): Partial<BodyMeasurements> | null {
  if (!system || !size) return null;
  const raw = size.trim();
  if (!raw) return null;

  if (system === "waist-inseam") {
    const m = raw.match(/^(\d{2}(?:\.\d)?)\s*[x×/\-]\s*(\d{2}(?:\.\d)?)$/i);
    if (m) {
      return {
        waistNatural: Number(m[1]) * IN_TO_CM,
        waistWorn: Number(m[1]) * IN_TO_CM,
        inseam: Number(m[2]) * IN_TO_CM,
      };
    }
    const single = raw.match(/^(\d{2}(?:\.\d)?)$/);
    if (single) {
      const w = Number(single[1]) * IN_TO_CM;
      return { waistNatural: w, waistWorn: w };
    }
    return null;
  }

  if (system === "neck-sleeve") {
    const m = raw.match(/^(\d{2}(?:\.\d)?)\s*[/\-x]\s*(\d{2}(?:\.\d)?)$/);
    if (m) {
      return { neck: Number(m[1]) * IN_TO_CM, sleeveFromCenterBack: Number(m[2]) * IN_TO_CM };
    }
    const single = raw.match(/^(\d{2}(?:\.\d)?)$/);
    if (single) return { neck: Number(single[1]) * IN_TO_CM };
    return null;
  }

  const chart = CHARTS[system];
  if (!chart.length) return null;
  const norm = raw.toUpperCase().replace(/\s+/g, "");
  const row =
    chart.find((r) => r.size.toUpperCase() === norm) ??
    chart.find((r) => r.size.toUpperCase() === norm.replace(/^XXXL$/, "3XL")) ??
    chart.find((r) => r.size.toUpperCase() === norm.replace(/^2XL$/, "XXL"));
  if (!row) return null;

  // Bottoms cut to an alpha chart key off waist/hip; tops key off chest.
  if (category === "bottom") {
    return { waistNatural: row.body.waistNatural, waistWorn: row.body.waistNatural, hip: row.body.hip };
  }
  return row.body;
}

/**
 * Given a body measurement, which size on this chart fits best? Used by the
 * "should I size up?" advice and by the pre-purchase checker.
 */
export function suggestSize(
  system: SizeSystem,
  body: BodyMeasurements,
  category: GarmentCategory,
): { size: string; deltaCm: number } | null {
  const chart = CHARTS[system];
  if (!chart.length) return null;
  const key: keyof BodyMeasurements = category === "bottom" ? "waistNatural" : "chest";
  const target = body[key];
  if (typeof target !== "number") return null;

  let best: { size: string; deltaCm: number } | null = null;
  for (const row of chart) {
    const v = row.body[key];
    if (typeof v !== "number") continue;
    const delta = v - target;
    // Prefer the smallest size that still has room (delta >= 0), else closest.
    const cost = delta >= 0 ? delta : Math.abs(delta) * 2.2;
    const bestCost = best ? (best.deltaCm >= 0 ? best.deltaCm : Math.abs(best.deltaCm) * 2.2) : Infinity;
    if (cost < bestCost) best = { size: row.size, deltaCm: delta };
  }
  return best;
}

/** The size one step up (or down) on the same chart, for "size up" advice. */
export function adjacentSize(system: SizeSystem, size: string, direction: 1 | -1): string | null {
  const chart = CHARTS[system];
  const i = chart.findIndex((r) => r.size.toUpperCase() === size.trim().toUpperCase());
  if (i === -1) return null;
  const next = chart[i + direction];
  return next ? next.size : null;
}
