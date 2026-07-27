/**
 * Travel packing.
 *
 * Packing is a set-cover problem wearing a suitcase: cover every day and
 * occasion with a good outfit, using as few garments as possible. Greedy
 * marginal-gain selection gets very close to optimal here and runs fast enough
 * to feel instant, which matters more than the last few percent.
 */
import type { Garment, OccasionKey, Profile, ScoringContext, WeatherContext, GarmentFitReport } from "../types";
import { findOutfits, type CandidateOutfit } from "./combos";
import { outfitClo, cloForTemp } from "./weather";

export interface TripPlan {
  days: number;
  /** Occasion for each day. Repeats are expected and fine. */
  itinerary: OccasionKey[];
  tempLowC: number;
  tempHighC: number;
  rain: boolean;
  maxItems: number;
}

export interface PackingResult {
  items: Garment[];
  outfits: { day: number; occasion: OccasionKey; garments: Garment[]; score: number }[];
  uncovered: { day: number; occasion: OccasionKey }[];
  /** Distinct good outfits the packed set yields, beyond the itinerary. */
  totalCombinations: number;
  notes: string[];
}

export function planPacking(
  wardrobe: Garment[],
  profile: Profile,
  plan: TripPlan,
  ctx: ScoringContext = {},
): PackingResult {
  const fitCache = new Map<string, GarmentFitReport>();
  const notes: string[] = [];

  // Score against the colder end of the trip: it's easy to take a layer off,
  // impossible to add one you left at home.
  const weather: WeatherContext = {
    tempC: plan.tempLowC + (plan.tempHighC - plan.tempLowC) * 0.35,
    windKph: 10,
    precipitationMm: plan.rain ? 3 : 0,
    label: `${plan.tempLowC}–${plan.tempHighC}°C`,
  };

  const searchCtx: ScoringContext = { ...ctx, weather, fitCache };

  /* --------------------- candidate outfits, per distinct occasion -- */
  const distinct = Array.from(new Set(plan.itinerary));
  const candidates = new Map<OccasionKey, CandidateOutfit[]>();
  for (const occasion of distinct) {
    candidates.set(
      occasion,
      findOutfits(wardrobe, profile, searchCtx, {
        occasion,
        limit: 40,
        beam: 8,
        includeUnavailable: true,
      }).filter((c) => c.score.total >= 62),
    );
  }

  /* ------------------------------------------------ greedy selection -- */
  const selected = new Set<string>();
  const dayNeeds = plan.itinerary.map((occasion, i) => ({ day: i + 1, occasion }));

  const coveredBy = (items: Set<string>) => {
    const assignments: PackingResult["outfits"] = [];
    const usedOutfitKeys = new Set<string>();
    for (const need of dayNeeds) {
      const pool = candidates.get(need.occasion) ?? [];
      // Prefer an outfit this trip hasn't already used, so 5 days don't all
      // come back as the same shirt.
      const fit =
        pool.find(
          (c) =>
            c.garments.every((g) => items.has(g.id)) &&
            !usedOutfitKeys.has(c.garments.map((g) => g.id).sort().join("|")),
        ) ?? pool.find((c) => c.garments.every((g) => items.has(g.id)));
      if (fit) {
        usedOutfitKeys.add(fit.garments.map((g) => g.id).sort().join("|"));
        assignments.push({
          day: need.day,
          occasion: need.occasion,
          garments: fit.garments,
          score: fit.score.total,
        });
      }
    }
    return assignments;
  };

  const allCandidateItems = new Map<string, Garment>();
  for (const list of candidates.values()) {
    for (const c of list) for (const g of c.garments) allCandidateItems.set(g.id, g);
  }

  let best = coveredBy(selected);
  for (let step = 0; step < plan.maxItems; step++) {
    let bestGain = 0;
    let bestItem: Garment | null = null;
    let bestAssignments = best;

    for (const [id, garment] of allCandidateItems) {
      if (selected.has(id)) continue;
      const trial = new Set(selected);
      trial.add(id);
      const assignments = coveredBy(trial);
      // Coverage first, outfit quality as the tie-break.
      const gain =
        (assignments.length - best.length) * 100 +
        (assignments.reduce((s, a) => s + a.score, 0) -
          best.reduce((s, a) => s + a.score, 0)) *
          0.1;
      if (gain > bestGain) {
        bestGain = gain;
        bestItem = garment;
        bestAssignments = assignments;
      }
    }

    if (!bestItem) break;
    selected.add(bestItem.id);
    best = bestAssignments;
    if (best.length === dayNeeds.length && selected.size >= 4) {
      // Everything is covered. Keep going only while items still add variety.
      const remaining = plan.maxItems - selected.size;
      if (remaining <= 0) break;
    }
  }

  const items = Array.from(selected)
    .map((id) => allCandidateItems.get(id))
    .filter((g): g is Garment => Boolean(g));

  const covered = new Set(best.map((b) => b.day));
  const uncovered = dayNeeds.filter((d) => !covered.has(d.day));

  /* --------------------------------------------------------- notes -- */
  const heaviest = items.length ? Math.max(...items.map((i) => outfitClo([i]))) : 0;
  const neededClo = cloForTemp(plan.tempLowC);
  if (neededClo > heaviest * 2.2 && neededClo > 0.9) {
    notes.push(
      `At ${plan.tempLowC}°C you'll want around ${neededClo.toFixed(1)} clo of insulation. Nothing you're packing gets there alone — plan on layering two of these at once.`,
    );
  }
  if (plan.rain && !items.some((i) => ["rain-shell", "trench-coat", "puffer"].includes(i.subcategory))) {
    notes.push("Rain is forecast and nothing in this list is water-resistant.");
  }
  const shoes = items.filter((i) => i.category === "shoes");
  if (shoes.length > 2) {
    notes.push(`${shoes.length} pairs of shoes is usually one more than a ${plan.days}-day trip needs.`);
  }
  if (uncovered.length) {
    notes.push(
      `${uncovered.length} day${uncovered.length === 1 ? "" : "s"} couldn't be covered from your clean wardrobe within ${plan.maxItems} items.`,
    );
  }

  const totalCombinations = findOutfits(items, profile, searchCtx, {
    limit: 200,
    beam: 8,
    includeUnavailable: true,
  }).filter((c) => c.score.total >= 70).length;

  return { items, outfits: best, uncovered, totalCombinations, notes };
}
