/**
 * Thermal comfort.
 *
 * Each garment contributes insulation measured in clo — the standard unit
 * where 1.0 is roughly a business suit and keeps a resting adult comfortable
 * at 21°C. Summing layers and inverting that relationship gives an honest
 * "you will be cold in this" instead of the tag-matching most weather features
 * do ("it's 12°C, here's something labelled autumn").
 */
import { fabricBreathability, fabricWarmthMultiplier } from "../data/fabrics";
import { subcategoryDef } from "../data/garmentTypes";
import type { Garment, Reason, SubScore, WeatherContext } from "../types";

/** Insulation of a single garment in clo, adjusted for fibre and fabric weight. */
export function garmentClo(g: Garment): number {
  const def = subcategoryDef(g.subcategory, g.category);
  const gsmFactor = typeof g.gsm === "number" && g.gsm > 0
    ? Math.max(0.55, Math.min(1.9, g.gsm / 220))
    : 1;
  return def.baseClo * fabricWarmthMultiplier(g.fabric) * gsmFactor;
}

/**
 * Total insulation. Layers are not purely additive — a second mid-layer
 * compresses the air trapped by the first — so each successive layer is
 * discounted.
 */
export function outfitClo(garments: Garment[]): number {
  const clos = garments.map(garmentClo).sort((a, b) => b - a);
  return clos.reduce((sum, c, i) => sum + c * Math.pow(0.88, i), 0);
}

/** Ambient temperature this much insulation is comfortable at, in °C. */
export function neutralTemp(clo: number): number {
  return 29 - 8 * clo;
}

/** How much insulation a given temperature calls for. */
export function cloForTemp(tempC: number): number {
  return Math.max(0, (29 - tempC) / 8);
}

const WINDPROOF = new Set(["rain-shell", "puffer", "leather-jacket", "trench-coat", "wool-coat"]);
const WATER_RESISTANT = new Set(["rain-shell", "puffer", "trench-coat"]);

export function scoreWeather(garments: Garment[], weather?: WeatherContext): SubScore {
  if (!weather) {
    return {
      key: "weather", label: "Weather", score: 75, confidence: 0,
      weight: 0.6, reasons: [], missingData: ["today's forecast (set your location)"],
    };
  }

  const reasons: Reason[] = [];
  const clo = outfitClo(garments);
  const neutral = neutralTemp(clo);

  let effectiveTemp = weather.feelsLikeC ?? weather.tempC;

  /* --------------------------------------------------------- wind -- */
  const outer = garments.find((g) => g.category === "outerwear");
  const windproof = outer ? WINDPROOF.has(outer.subcategory) : false;
  const wind = weather.windKph ?? 0;
  if (wind > 15 && !windproof) {
    const chill = Math.min(6, (wind - 15) * 0.18);
    effectiveTemp -= chill;
    if (chill > 2) {
      reasons.push({
        severity: "warn",
        text: `${Math.round(wind)} km/h wind will cut straight through this — nothing here blocks it.`,
        fix: "A shell or anything tightly woven on the outside is worth more than another sweater.",
        impact: -8,
      });
    }
  }

  /* --------------------------------------------------------- rain -- */
  const rain = weather.precipitationMm ?? 0;
  if (rain > 0.4) {
    const covered = outer ? WATER_RESISTANT.has(outer.subcategory) : false;
    if (!covered) {
      reasons.push({
        severity: rain > 3 ? "bad" : "warn",
        text: `${rain.toFixed(1)}mm of rain forecast and no water-resistant layer.`,
        fix: "Swap the outer layer for a shell, or accept you're taking an umbrella.",
        impact: rain > 3 ? -16 : -8,
      });
    } else {
      reasons.push({ severity: "good", text: "Rain forecast, and your outer layer handles it.", impact: 5 });
    }
    const suede = garments.some(
      (g) => g.category === "shoes" && Object.keys(g.fabric).includes("leather"),
    );
    if (suede && rain > 2) {
      reasons.push({
        severity: "info",
        text: "Leather shoes in heavy rain — fine once, expensive as a habit.",
        garmentIds: garments.filter((g) => g.category === "shoes").map((g) => g.id),
        impact: -3,
      });
    }
  }

  /* -------------------------------------------------- heat comfort -- */
  const breathability =
    garments.length > 0
      ? garments.reduce((s, g) => s + fabricBreathability(g.fabric), 0) / garments.length
      : 0.6;
  if (effectiveTemp > 24 && breathability < 0.45) {
    reasons.push({
      severity: "warn",
      text: `Synthetic-heavy at ${Math.round(effectiveTemp)}°C — it'll trap heat and hold onto sweat.`,
      fix: "Cotton, linen or a merino blend will feel several degrees cooler at the same insulation.",
      impact: -9,
    });
  }

  /* ------------------------------------------------------- verdict -- */
  // `neutral` is the temperature this outfit is comfortable at. If that sits
  // above the actual temperature, the outfit belongs to a warmer day than the
  // one you're having — i.e. you'll be cold.
  const gap = neutral - effectiveTemp;
  let score = 100 - Math.abs(gap) * 6.5;

  if (gap > 5) {
    reasons.push({
      severity: gap > 9 ? "bad" : "warn",
      text: `About ${Math.round(gap)}°C short for ${Math.round(effectiveTemp)}°C — this will be genuinely cold.`,
      fix: "Add a mid-layer. A thin merino under what you have buys roughly 4°C.",
      impact: -Math.round(gap * 4),
    });
  } else if (gap < -5) {
    reasons.push({
      severity: gap < -9 ? "bad" : "warn",
      text: `About ${Math.round(-gap)}°C too warm for ${Math.round(effectiveTemp)}°C — you'll be carrying a layer by midday.`,
      fix: "Drop the heaviest layer, or swap it for something you can take off without ruining the outfit.",
      impact: -Math.round(-gap * 4),
    });
  } else {
    reasons.push({
      severity: "good",
      text: `Well judged for ${Math.round(effectiveTemp)}°C${weather.label ? ` (${weather.label.toLowerCase()})` : ""}.`,
      impact: 6,
    });
  }

  const bonusPenalty = reasons.reduce((s, r) => s + (r.impact ?? 0), 0);
  score = Math.max(0, Math.min(100, score + Math.max(-20, Math.min(10, bonusPenalty * 0.35))));

  return {
    key: "weather",
    label: "Weather",
    score,
    confidence: 0.85,
    weight: 1.05,
    reasons,
    missingData: [],
  };
}

/** Human-readable insulation summary for the UI. */
export function describeClo(clo: number): string {
  const t = Math.round(neutralTemp(clo));
  return `${clo.toFixed(2)} clo — comfortable around ${t}°C`;
}
