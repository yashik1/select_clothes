/**
 * Wardrobe gap analysis.
 *
 * Every wardrobe app can tell you what you own. The genuinely useful question
 * is the counterfactual: *which single thing you don't own would unlock the
 * most wearable outfits?* That's answerable — add a hypothetical garment,
 * re-run the outfit search, and measure the delta. It turns "I have nothing to
 * wear" from a feeling into a shopping list of at most three items.
 */
import { deltaEHex, lchToHex } from "../color/space";
import { deriveSeason } from "../color/palette";
import { subcategoryDef } from "../data/garmentTypes";
import { suggestSize } from "../data/sizeCharts";
import type {
  Garment,
  GarmentCategory,
  GarmentFitReport,
  OccasionKey,
  Profile,
  ScoringContext,
  SizeSystem,
} from "../types";
import { findOutfits, type CandidateOutfit } from "./combos";

type ColorRole = "neutral-dark" | "neutral-mid" | "neutral-light" | "accent" | "denim";

interface Archetype {
  key: string;
  label: string;
  category: GarmentCategory;
  subcategory: string;
  colorRole: ColorRole;
  fabric: Record<string, number>;
  formality: number;
  fitIntent: Garment["fitIntent"];
  pattern?: Garment["pattern"];
  /** Roughly what this costs, for the cost-per-outfit-unlocked figure. */
  typicalPrice: number;
  why: string;
  /**
   * Some staples only make sense for a wardrobe cut on a particular block.
   * Rather than ask anyone to declare a gender, we infer it: these are only
   * offered to someone who already owns something from that block.
   */
  block?: "womens";
}

const ARCHETYPES: Archetype[] = [
  { key: "white-oxford", label: "White oxford shirt", category: "top", subcategory: "oxford-shirt", colorRole: "neutral-light", fabric: { cotton: 1 }, formality: 3, fitIntent: "regular", typicalPrice: 70, why: "The single most combinable top there is — it works under everything and over nothing." },
  { key: "navy-crew", label: "Navy crewneck sweater", category: "top", subcategory: "sweater", colorRole: "neutral-dark", fabric: { merino: 1 }, formality: 3, fitIntent: "regular", typicalPrice: 95, why: "Bridges casual and smart in one piece, and layers over a shirt without bulk." },
  { key: "white-tee", label: "White t-shirt", category: "top", subcategory: "t-shirt", colorRole: "neutral-light", fabric: { cotton: 1 }, formality: 1, fitIntent: "regular", typicalPrice: 25, why: "The base layer that makes half your jackets wearable on their own terms." },
  { key: "black-tee", label: "Black t-shirt", category: "top", subcategory: "t-shirt", colorRole: "neutral-dark", fabric: { cotton: 1 }, formality: 1, fitIntent: "regular", typicalPrice: 25, why: "Reads sharper than a white tee under outerwear and hides more." },
  { key: "accent-knit", label: "Sweater in one of your palette colours", category: "top", subcategory: "sweater", colorRole: "accent", fabric: { merino: 1 }, formality: 3, fitIntent: "regular", typicalPrice: 95, why: "Most wardrobes are all neutrals; one strong colour near your face does more than three more neutrals." },
  { key: "silk-blouse", label: "Blouse in a palette colour", category: "top", subcategory: "blouse", colorRole: "accent", fabric: { viscose: 1 }, formality: 3, fitIntent: "regular", typicalPrice: 75, why: "Lifts a plain bottom half to smart-casual without adding a jacket.", block: "womens" },
  { key: "straight-jeans", label: "Mid-wash straight-leg jeans", category: "bottom", subcategory: "jeans", colorRole: "denim", fabric: { cotton: 0.98, elastane: 0.02 }, formality: 2, fitIntent: "regular", typicalPrice: 90, why: "The most-worn item in most wardrobes, and the one people most often own in the wrong cut." },
  { key: "dark-jeans", label: "Dark indigo jeans", category: "bottom", subcategory: "jeans", colorRole: "neutral-dark", fabric: { cotton: 0.98, elastane: 0.02 }, formality: 3, fitIntent: "regular", typicalPrice: 95, why: "Passes as smart-casual where mid-wash denim doesn't." },
  { key: "tailored-trouser", label: "Tailored trousers", category: "bottom", subcategory: "dress-trousers", colorRole: "neutral-dark", fabric: { wool: 0.98, elastane: 0.02 }, formality: 4, fitIntent: "regular", typicalPrice: 120, why: "Turns tops you already own into an office outfit." },
  { key: "wide-trouser", label: "Wide-leg trousers", category: "bottom", subcategory: "wide-leg-trousers", colorRole: "neutral-mid", fabric: { viscose: 0.7, linen: 0.3 }, formality: 3, fitIntent: "regular", typicalPrice: 90, why: "Gives you the volume-below silhouette your fitted tops have nothing to pair with." },
  { key: "neutral-skirt", label: "A-line skirt", category: "bottom", subcategory: "skirt", colorRole: "neutral-dark", fabric: { wool: 1 }, formality: 3, fitIntent: "regular", typicalPrice: 80, why: "A second bottom silhouette multiplies every top you own.", block: "womens" },
  { key: "chinos", label: "Chinos", category: "bottom", subcategory: "chinos", colorRole: "neutral-mid", fabric: { cotton: 0.97, elastane: 0.03 }, formality: 3, fitIntent: "regular", typicalPrice: 75, why: "Sits between jeans and tailoring — the gap most wardrobes have." },
  { key: "blazer", label: "Unstructured blazer", category: "outerwear", subcategory: "blazer", colorRole: "neutral-dark", fabric: { wool: 0.96, elastane: 0.04 }, formality: 4, fitIntent: "regular", typicalPrice: 180, why: "One jacket raises the formality ceiling of your whole wardrobe by a full step." },
  { key: "denim-jacket", label: "Denim jacket", category: "outerwear", subcategory: "denim-jacket", colorRole: "denim", fabric: { cotton: 1 }, formality: 2, fitIntent: "regular", typicalPrice: 90, why: "The shoulder-season layer that stops you jumping straight from shirt to winter coat." },
  { key: "trench", label: "Trench coat", category: "outerwear", subcategory: "trench-coat", colorRole: "neutral-mid", fabric: { cotton: 0.7, polyester: 0.3 }, formality: 4, fitIntent: "regular", typicalPrice: 220, why: "Handles rain without dropping the outfit's formality to zero." },
  { key: "wool-coat", label: "Wool overcoat", category: "outerwear", subcategory: "wool-coat", colorRole: "neutral-dark", fabric: { wool: 0.8, cashmere: 0.1, polyester: 0.1 }, formality: 4, fitIntent: "regular", typicalPrice: 300, why: "Winter warmth that doesn't undo a smart outfit the way a puffer does." },
  { key: "rain-shell", label: "Rain shell", category: "outerwear", subcategory: "rain-shell", colorRole: "neutral-dark", fabric: { nylon: 1 }, formality: 1, fitIntent: "relaxed", typicalPrice: 130, why: "Your wardrobe currently has no honest answer to a wet forecast." },
  { key: "white-sneakers", label: "Clean minimal sneakers", category: "shoes", subcategory: "minimal-sneakers", colorRole: "neutral-light", fabric: { leather: 1 }, formality: 2, fitIntent: "regular", typicalPrice: 110, why: "The one shoe that goes with both jeans and tailoring." },
  { key: "loafers", label: "Loafers", category: "shoes", subcategory: "loafers", colorRole: "neutral-dark", fabric: { leather: 1 }, formality: 3, fitIntent: "regular", typicalPrice: 150, why: "Lifts casual outfits without the commitment of a proper dress shoe." },
  { key: "chelsea", label: "Chelsea boots", category: "shoes", subcategory: "chelsea-boots", colorRole: "neutral-dark", fabric: { leather: 1 }, formality: 3, fitIntent: "regular", typicalPrice: 180, why: "Carries an outfit through autumn and winter at a formality sneakers can't reach." },
  { key: "dress-shoes", label: "Oxfords", category: "shoes", subcategory: "oxfords", colorRole: "neutral-dark", fabric: { leather: 1 }, formality: 5, fitIntent: "regular", typicalPrice: 200, why: "Without these, your dressiest outfits top out below where they should." },
  { key: "leather-belt", label: "Leather belt", category: "accessory", subcategory: "belt", colorRole: "neutral-dark", fabric: { leather: 1 }, formality: 3, fitIntent: "regular", typicalPrice: 45, why: "Cheapest possible way to add waist definition to everything you own." },
];

function colorFor(role: ColorRole, profile: Profile): { hex: string; name: string } {
  const band = deriveSeason(profile.coloring).band;
  const neutralHue = band.warm > 0 ? 70 : 250;
  switch (role) {
    case "neutral-dark":
      return { hex: lchToHex({ L: 22, C: 7, h: neutralHue }), name: band.warm > 0 ? "deep brown-black" : "charcoal / navy" };
    case "neutral-mid":
      return { hex: lchToHex({ L: 58, C: 8, h: neutralHue }), name: band.warm > 0 ? "camel / stone" : "grey / taupe" };
    case "neutral-light":
      return { hex: lchToHex({ L: 92, C: 4, h: neutralHue }), name: band.warm > 0 ? "cream" : "optic white" };
    case "denim":
      return { hex: "#4a6079", name: "mid indigo" };
    case "accent": {
      // The strongest hue in the user's own palette, so the recommendation is
      // specific enough to shop with.
      const best = lchToHex({ L: band.L, C: band.C, h: band.warm > 0 ? 40 : 250 });
      return { hex: best, name: "one of your palette colours" };
    }
  }
}

function hypothetical(a: Archetype, profile: Profile): Garment {
  const def = subcategoryDef(a.subcategory, a.category);
  const color = colorFor(a.colorRole, profile);

  // Pick the size that actually fits, so the hypothetical isn't penalised by
  // the fit engine for being an imaginary medium.
  const system: SizeSystem = a.category === "bottom" ? "waist-inseam" : "alpha-unisex";
  const suggested = system === "alpha-unisex" ? suggestSize(system, profile.measurements, a.category) : null;
  const waistIn = profile.measurements.waistWorn ?? profile.measurements.waistNatural;
  const inseamIn = profile.measurements.inseam;
  const size =
    system === "waist-inseam"
      ? waistIn && inseamIn
        ? `${Math.round(waistIn / 2.54)}x${Math.round(inseamIn / 2.54)}`
        : undefined
      : suggested?.size;

  const now = new Date().toISOString();
  return {
    id: `hypothetical:${a.key}`,
    name: a.label,
    category: a.category,
    subcategory: a.subcategory,
    size,
    sizeSystem: size ? system : "free",
    colors: [{ hex: color.hex, share: 1 }],
    pattern: a.pattern ?? "solid",
    patternScale: "none",
    fabric: a.fabric,
    formality: a.formality,
    fitIntent: a.fitIntent,
    measurements: {},
    seasons: def.seasons ?? [],
    careState: "clean",
    imageIds: [],
    wearCount: 0,
    lastWornAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface GapResult {
  key: string;
  label: string;
  colorName: string;
  colorHex: string;
  why: string;
  /** New outfits at or above the quality threshold that this item creates. */
  unlocked: number;
  /** Ranking value: `unlocked`, discounted when you already own the category. */
  rankScore: number;
  /** True when this adds to a category the wardrobe already covers. */
  duplicatesCategory: boolean;
  /** Best score achievable once you own it. */
  bestScore: number;
  typicalPrice: number;
  /** Money per newly-unlocked outfit — the honest version of cost-per-wear. */
  costPerUnlock: number;
  examples: { garmentNames: string[]; score: number }[];
  suggestedSize?: string;
}

export interface GapOptions {
  threshold?: number;
  occasions?: OccasionKey[];
  limit?: number;
}

export function analyseGaps(
  wardrobe: Garment[],
  profile: Profile,
  ctx: ScoringContext = {},
  opts: GapOptions = {},
): { baseline: number; results: GapResult[] } {
  const threshold = opts.threshold ?? 76;
  const occasions = opts.occasions ?? ["casual-social", "smart-casual", "office"];
  const fitCache = new Map<string, GarmentFitReport>();
  const searchCtx: ScoringContext = { ...ctx, fitCache };

  const goodOutfits = (items: Garment[]): CandidateOutfit[] => {
    const seen = new Set<string>();
    const out: CandidateOutfit[] = [];
    for (const occasion of occasions) {
      const found = findOutfits(items, profile, searchCtx, {
        occasion,
        limit: 60,
        beam: 6,
        includeUnavailable: true,
      });
      for (const f of found) {
        if (f.score.total < threshold) continue;
        const key = f.garments.map((g) => g.id).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
      }
    }
    return out;
  };

  const base = goodOutfits(wardrobe);
  const baseKeys = new Set(base.map((o) => o.garments.map((g) => g.id).sort().join("|")));

  // Infer which sizing blocks this person actually wears from what they own,
  // so we never suggest a skirt to someone whose wardrobe contains no evidence
  // they'd want one — and never have to ask them to declare a gender.
  const wearsWomensBlock = wardrobe.some(
    (g) =>
      g.category === "dress" ||
      g.subcategory === "skirt" ||
      g.subcategory === "blouse" ||
      (g.sizeSystem ?? "").includes("womens"),
  );

  const results: GapResult[] = [];
  for (const a of ARCHETYPES) {
    if (a.block === "womens" && !wearsWomensBlock) continue;

    const item = hypothetical(a, profile);

    // Never recommend something they effectively already own. Same type in a
    // near-identical colour is a duplicate; two of the same type in any colour
    // means the category is covered.
    const sameType = wardrobe.filter((g) => g.subcategory === a.subcategory && !g.archivedAt);
    if (sameType.length >= 2) continue;
    const duplicate = sameType.some((g) =>
      g.colors.some((c) => deltaEHex(c.hex, item.colors[0].hex) < 22),
    );
    if (duplicate) continue;
    const withItem = goodOutfits([...wardrobe, item]);
    const novel = withItem.filter(
      (o) =>
        o.garments.some((g) => g.id === item.id) &&
        !baseKeys.has(o.garments.map((g) => g.id).sort().join("|")),
    );
    if (!novel.length) continue;

    novel.sort((x, y) => y.score.total - x.score.total);
    const color = colorFor(a.colorRole, profile);

    // A second pair of boots does open up outfits, but not as many *new
    // situations* as the raw count implies. Discount duplicates of a category
    // you already have covered so genuinely absent categories rank first.
    const rankScore = sameType.length ? novel.length * 0.6 : novel.length;

    results.push({
      key: a.key,
      label: a.label,
      colorName: color.name,
      colorHex: color.hex,
      why: a.why,
      unlocked: novel.length,
      rankScore,
      duplicatesCategory: sameType.length > 0,
      bestScore: novel[0].score.total,
      typicalPrice: a.typicalPrice,
      costPerUnlock: Math.round(a.typicalPrice / novel.length),
      suggestedSize: item.size,
      examples: novel.slice(0, 2).map((o) => ({
        garmentNames: o.garments.map((g) => g.name),
        score: o.score.total,
      })),
    });
  }

  results.sort((x, y) => y.rankScore - x.rankScore || x.costPerUnlock - y.costPerUnlock);
  return { baseline: base.length, results: results.slice(0, opts.limit ?? 8) };
}
