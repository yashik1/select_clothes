/**
 * Fibre properties used by the fit and weather engines.
 *
 * `stretch` is the fibre's own contribution to mechanical give; construction
 * (knit vs woven) contributes far more and is applied separately in
 * `fabricStretch()`. `warmth` is a multiplier on the subcategory's base clo
 * value, and `breathability` shifts the comfort band in hot weather.
 */
export interface FiberProps {
  label: string;
  /** Extra fractional give this fibre adds at 100% content. */
  stretch: number;
  /** Multiplier on base clo. 1.0 = cotton reference. */
  warmth: number;
  /** 0-1. Higher = handles heat and humidity better. */
  breathability: number;
  /** 0-1. Higher = fluid drape, lower = structured/crisp. */
  drape: number;
}

export const FIBERS: Record<string, FiberProps> = {
  cotton: { label: "Cotton", stretch: 0.02, warmth: 1.0, breathability: 0.85, drape: 0.45 },
  linen: { label: "Linen", stretch: 0.01, warmth: 0.7, breathability: 1.0, drape: 0.35 },
  wool: { label: "Wool", stretch: 0.08, warmth: 1.45, breathability: 0.75, drape: 0.6 },
  merino: { label: "Merino wool", stretch: 0.12, warmth: 1.35, breathability: 0.9, drape: 0.65 },
  cashmere: { label: "Cashmere", stretch: 0.1, warmth: 1.6, breathability: 0.7, drape: 0.75 },
  silk: { label: "Silk", stretch: 0.03, warmth: 0.9, breathability: 0.8, drape: 0.9 },
  polyester: { label: "Polyester", stretch: 0.04, warmth: 1.05, breathability: 0.35, drape: 0.55 },
  nylon: { label: "Nylon", stretch: 0.06, warmth: 1.0, breathability: 0.3, drape: 0.6 },
  acrylic: { label: "Acrylic", stretch: 0.05, warmth: 1.25, breathability: 0.35, drape: 0.5 },
  viscose: { label: "Viscose / rayon", stretch: 0.03, warmth: 0.85, breathability: 0.7, drape: 0.85 },
  modal: { label: "Modal", stretch: 0.05, warmth: 0.85, breathability: 0.8, drape: 0.85 },
  lyocell: { label: "Lyocell / Tencel", stretch: 0.04, warmth: 0.85, breathability: 0.85, drape: 0.85 },
  elastane: { label: "Elastane / spandex", stretch: 1.0, warmth: 0.9, breathability: 0.3, drape: 0.5 },
  denim: { label: "Denim", stretch: 0.01, warmth: 1.15, breathability: 0.55, drape: 0.2 },
  leather: { label: "Leather", stretch: 0.02, warmth: 1.3, breathability: 0.15, drape: 0.3 },
  down: { label: "Down", stretch: 0.0, warmth: 2.2, breathability: 0.2, drape: 0.2 },
  fleece: { label: "Fleece", stretch: 0.1, warmth: 1.5, breathability: 0.45, drape: 0.3 },
};

export const FIBER_KEYS = Object.keys(FIBERS);

function normalise(fabric: Record<string, number>): Record<string, number> {
  const entries = Object.entries(fabric).filter(([k, v]) => FIBERS[k] && v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return {};
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
}

/** Weighted average of a fibre property across a blend. */
function blend(fabric: Record<string, number>, prop: keyof Omit<FiberProps, "label">): number | null {
  const mix = normalise(fabric);
  const keys = Object.keys(mix);
  if (keys.length === 0) return null;
  return keys.reduce((sum, k) => sum + mix[k] * FIBERS[k][prop], 0);
}

/**
 * Fractional stretch available to the wearer, 0-0.5.
 *
 * Elastane is deliberately non-linear: 2% elastane in a woven turns a rigid
 * fabric into a comfortable one, so the first few percent matter enormously
 * and the curve then flattens.
 */
export function fabricStretch(fabric: Record<string, number>, isKnit: boolean): number {
  const mix = normalise(fabric);
  const construction = isKnit ? 0.2 : 0.02;
  const elastane = (mix.elastane ?? 0) + (mix.nylon ?? 0) * 0.05;
  // sqrt curve: 2% elastane -> ~0.11, 5% -> ~0.17, 20% -> ~0.35
  const elastic = Math.sqrt(Math.max(0, elastane)) * 0.78;
  const fibreGive = Object.keys(mix)
    .filter((k) => k !== "elastane")
    .reduce((s, k) => s + mix[k] * FIBERS[k].stretch, 0);
  return Math.min(0.5, construction + elastic + fibreGive * 0.5);
}

export function fabricWarmthMultiplier(fabric: Record<string, number>): number {
  return blend(fabric, "warmth") ?? 1.0;
}

export function fabricBreathability(fabric: Record<string, number>): number {
  return blend(fabric, "breathability") ?? 0.6;
}

export function fabricDrape(fabric: Record<string, number>): number {
  return blend(fabric, "drape") ?? 0.5;
}

export function describeFabric(fabric: Record<string, number>): string {
  const mix = normalise(fabric);
  return Object.entries(mix)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${Math.round(v * 100)}% ${FIBERS[k].label.toLowerCase()}`)
    .join(", ");
}
