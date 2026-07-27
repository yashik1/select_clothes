/**
 * Wardrobe analytics.
 *
 * Cost-per-wear is table stakes — several apps do it. What's missing elsewhere
 * is connecting the numbers to a decision: not "this coat costs £14 a wear" but
 * "this coat is expensive per wear *because* nothing you own goes with it, and
 * here are the two things that would fix that."
 */
import { matchColorToSeason, deriveSeason } from "../color/palette";
import { subcategoryDef } from "../data/garmentTypes";
import type { Garment, GarmentCategory, Profile, WearLog } from "../types";
import { evaluateGarmentFit } from "./fit";
import { outfitsWith } from "./combos";
import { daysSince } from "./novelty";

export interface GarmentInsight {
  garment: Garment;
  costPerWear: number | null;
  daysSinceWorn: number | null;
  /** How many good outfits in the current wardrobe use this item. */
  pairings: number;
  paletteScore: number | null;
  fitScore: number | null;
  status: "workhorse" | "healthy" | "underused" | "dead" | "poor-fit" | "new";
  advice?: string;
}

export interface WardrobeInsights {
  totalItems: number;
  totalSpend: number;
  currency: string;
  /** Share of items worn in the last 90 days. */
  utilisation: number;
  averageCostPerWear: number | null;
  byCategory: { category: GarmentCategory; count: number; share: number }[];
  items: GarmentInsight[];
  deadStock: GarmentInsight[];
  workhorses: GarmentInsight[];
  poorFit: GarmentInsight[];
  /** Items that are fine in themselves but have almost nothing to pair with. */
  orphans: GarmentInsight[];
  headlines: string[];
}

const CATEGORIES: GarmentCategory[] = ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "bag"];

export function buildInsights(
  wardrobe: Garment[],
  profile: Profile,
  _logs: WearLog[] = [],
): WardrobeInsights {
  const active = wardrobe.filter((g) => !g.archivedAt);
  const band = deriveSeason(profile.coloring).band;

  const items: GarmentInsight[] = active.map((g) => {
    const costPerWear =
      typeof g.pricePaid === "number" && g.pricePaid > 0
        ? g.pricePaid / Math.max(1, g.wearCount)
        : null;
    const since = daysSince(g.lastWornAt);
    const paletteScore = g.colors[0] ? matchColorToSeason(g.colors[0].hex, band).score : null;

    const fitScore =
      g.category === "shoes" || g.category === "accessory" || g.category === "bag"
        ? null
        : evaluateGarmentFit(g, profile).score;

    // Pairing count is the expensive bit, so it runs with a narrow beam. It's a
    // relative signal — we only care which items are starved, not the exact number.
    const pairings = outfitsWith(g.id, active, profile, {}, { limit: 30, beam: 5, includeUnavailable: true })
      .filter((c) => c.score.total >= 72).length;

    const ageDays = daysSince(g.createdAt) ?? 0;

    let status: GarmentInsight["status"] = "healthy";
    let advice: string | undefined;

    if (fitScore !== null && fitScore < 52) {
      status = "poor-fit";
      advice = "The fit is the problem, not the styling. Alter it, or let it go.";
    } else if (g.wearCount === 0 && ageDays > 45) {
      status = "dead";
      advice = pairings === 0
        ? "Never worn, and nothing you own pairs with it. This is the clearest sell-or-donate candidate you have."
        : "Never worn despite having valid pairings — try one of them this week before deciding.";
    } else if (g.wearCount === 0) {
      status = "new";
    } else if (since !== null && since > 120) {
      status = "dead";
      advice = "Four months untouched. If the next 30 days don't change that, it isn't part of your wardrobe.";
    } else if (since !== null && since > 60) {
      status = "underused";
      advice = pairings <= 1 ? "Barely anything goes with this — that's usually why it stays in the drawer." : undefined;
    } else if (g.wearCount >= 12) {
      status = "workhorse";
    }

    return { garment: g, costPerWear, daysSinceWorn: since, pairings, paletteScore, fitScore, status, advice };
  });

  const spendItems = active.filter((g) => typeof g.pricePaid === "number");
  const totalSpend = spendItems.reduce((s, g) => s + (g.pricePaid ?? 0), 0);
  const currency = spendItems.find((g) => g.currency)?.currency ?? "USD";

  const wornRecently = items.filter((i) => i.daysSinceWorn !== null && i.daysSinceWorn <= 90).length;
  const utilisation = active.length ? wornRecently / active.length : 0;

  const cpws = items.map((i) => i.costPerWear).filter((c): c is number => c !== null);
  const averageCostPerWear = cpws.length ? cpws.reduce((s, c) => s + c, 0) / cpws.length : null;

  const byCategory = CATEGORIES.map((category) => {
    const count = active.filter((g) => g.category === category).length;
    return { category, count, share: active.length ? count / active.length : 0 };
  }).filter((c) => c.count > 0);

  const deadStock = items.filter((i) => i.status === "dead").sort((a, b) => (b.costPerWear ?? 0) - (a.costPerWear ?? 0));
  const workhorses = items.filter((i) => i.status === "workhorse").sort((a, b) => b.garment.wearCount - a.garment.wearCount);
  const poorFit = items.filter((i) => i.status === "poor-fit");
  const orphans = items
    .filter((i) => i.pairings <= 1 && i.status !== "poor-fit" && i.garment.category !== "accessory" && i.garment.category !== "bag")
    .sort((a, b) => a.pairings - b.pairings);

  /* ------------------------------------------------------- headlines -- */
  const headlines: string[] = [];
  if (active.length) {
    headlines.push(
      `${Math.round(utilisation * 100)}% of your wardrobe has been worn in the last 90 days.`,
    );
  }
  if (deadStock.length) {
    const value = deadStock.reduce((s, i) => s + (i.garment.pricePaid ?? 0), 0);
    headlines.push(
      value > 0
        ? `${deadStock.length} items are sitting unworn, representing ${currency} ${Math.round(value)} of your wardrobe.`
        : `${deadStock.length} items haven't been worn in months.`,
    );
  }
  if (orphans.length) {
    headlines.push(
      `${orphans.length} item${orphans.length === 1 ? " has" : "s have"} almost nothing to pair with — that's a gap in the rest of your wardrobe, not a flaw in the item.`,
    );
  }
  const worstCpw = items.filter((i) => i.costPerWear !== null).sort((a, b) => b.costPerWear! - a.costPerWear!)[0];
  if (worstCpw && worstCpw.costPerWear! > 20) {
    headlines.push(
      `Your most expensive item per wear is the ${worstCpw.garment.name.toLowerCase()} at ${currency} ${Math.round(worstCpw.costPerWear!)} a wear.`,
    );
  }
  const tops = byCategory.find((c) => c.category === "top")?.count ?? 0;
  const bottoms = byCategory.find((c) => c.category === "bottom")?.count ?? 0;
  if (bottoms > 0 && tops / bottoms > 3.5) {
    headlines.push(
      `You own ${tops} tops to ${bottoms} bottoms. Every bottom you add multiplies more outfits than another top would.`,
    );
  }

  return {
    totalItems: active.length,
    totalSpend,
    currency,
    utilisation,
    averageCostPerWear,
    byCategory,
    items: items.sort((a, b) => (b.costPerWear ?? 0) - (a.costPerWear ?? 0)),
    deadStock,
    workhorses,
    poorFit,
    orphans,
    headlines,
  };
}

export function categoryLabel(c: GarmentCategory): string {
  return { top: "Tops", bottom: "Bottoms", dress: "Dresses", outerwear: "Outerwear", shoes: "Shoes", accessory: "Accessories", bag: "Bags" }[c];
}

export { subcategoryDef };
