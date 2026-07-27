/**
 * Outfit search.
 *
 * The naive approach — score every combination — explodes: 40 tops × 25 bottoms
 * × 15 shoes × 10 jackets is 150,000 outfits, each running six engines. So we
 * pre-rank each slot cheaply, keep the plausible head of each list, and only
 * then score the cross-product. Per-garment fit results are computed once and
 * shared across every candidate.
 */
import type {
  Garment,
  GarmentCategory,
  GarmentFitReport,
  OccasionKey,
  Profile,
  ScoringContext,
} from "../types";
import { evaluateGarmentFit } from "./fit";
import { matchColorToSeason } from "../color/palette";
import { deriveSeason } from "../color/palette";
import { OCCASIONS } from "./formality";
import { cloForTemp, garmentClo } from "./weather";
import { scoreOutfit, type ScoreResult } from "./index";
import { subcategoryDef } from "../data/garmentTypes";

export interface CandidateOutfit {
  garments: Garment[];
  score: ScoreResult;
}

export interface SearchOptions {
  occasion?: OccasionKey;
  /** Force these garments into every candidate. */
  mustInclude?: string[];
  /** Never use these garments. */
  exclude?: string[];
  limit?: number;
  /** Include items that are in the wash. Off by default — the whole point is
   *  that it shouldn't suggest a shirt you can't actually put on. */
  includeUnavailable?: boolean;
  /** Beam width per slot. Higher is slower and slightly better. */
  beam?: number;
}

/** Cheap per-garment desirability, used only to rank slot candidates. */
function preScore(
  g: Garment,
  profile: Profile,
  fitCache: Map<string, GarmentFitReport>,
  seasonBand: ReturnType<typeof deriveSeason>["band"],
  season: SeasonOfYear,
): number {
  let s = 50;

  // Out-of-season items rank lower but stay in the running. Making this a hard
  // filter empties the wardrobe on the first warm day in a mostly-autumn
  // closet, and the weather dimension already judges insulation properly.
  const def = subcategoryDef(g.subcategory, g.category);
  const tags = g.seasons?.length ? g.seasons : def.seasons;
  if (tags?.length && !tags.includes(season)) s -= 14;

  if (g.category !== "shoes" && g.category !== "accessory" && g.category !== "bag") {
    let report = fitCache.get(g.id);
    if (!report) {
      report = evaluateGarmentFit(g, profile);
      fitCache.set(g.id, report);
    }
    s = report.score * 0.6 + 20;
  }

  const primary = g.colors[0];
  if (primary) s += (matchColorToSeason(primary.hex, seasonBand).score - 60) * 0.18;
  if (typeof g.rating === "number") s += (g.rating - 3) * 4;

  // Nudge neglected pieces up so the search surfaces them rather than
  // converging on the same five favourites.
  if (g.wearCount === 0) s += 6;

  return s;
}

type SeasonOfYear = "spring" | "summer" | "autumn" | "winter";

function seasonNow(date: Date): SeasonOfYear {
  const m = date.getMonth();
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}

function eligible(g: Garment, opts: SearchOptions, ctx: ScoringContext): boolean {
  if (g.archivedAt) return false;
  if (opts.exclude?.includes(g.id)) return false;
  if (!opts.includeUnavailable && g.careState !== "clean") return false;

  if (opts.occasion) {
    const target = OCCASIONS[opts.occasion];
    // One step of slack in each direction — the composite scorer makes the
    // final call, this is only about not wasting search budget.
    if (g.formality < target.lo - 1.2 || g.formality > target.hi + 1.2) return false;
  }

  return true;
}

function bySlot(garments: Garment[]): Record<GarmentCategory, Garment[]> {
  const out = {
    top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [], bag: [],
  } as Record<GarmentCategory, Garment[]>;
  for (const g of garments) out[g.category]?.push(g);
  return out;
}

/**
 * Two outfits that differ by a single accessory are the same suggestion as far
 * as a human is concerned. Keeping only genuinely distinct results is what
 * makes the list feel like advice rather than a database dump.
 */
function tooSimilar(a: Garment[], b: Garment[]): boolean {
  const core = (xs: Garment[]) =>
    new Set(xs.filter((g) => g.category !== "accessory" && g.category !== "bag").map((g) => g.id));
  const A = core(a);
  const B = core(b);
  const shared = [...A].filter((id) => B.has(id)).length;
  return shared >= Math.max(A.size, B.size) - 1 && Math.abs(A.size - B.size) <= 1;
}

export function findOutfits(
  wardrobe: Garment[],
  profile: Profile,
  ctx: ScoringContext = {},
  opts: SearchOptions = {},
): CandidateOutfit[] {
  const limit = opts.limit ?? 8;
  const beam = opts.beam ?? 9;
  const fitCache = ctx.fitCache ?? new Map<string, GarmentFitReport>();
  const scoringCtx: ScoringContext = { ...ctx, fitCache, occasion: opts.occasion ?? ctx.occasion };
  const band = deriveSeason(profile.coloring).band;

  const pinned = (opts.mustInclude ?? [])
    .map((id) => wardrobe.find((g) => g.id === id))
    .filter((g): g is Garment => Boolean(g));
  const pinnedIds = new Set(pinned.map((g) => g.id));

  const pool = wardrobe.filter((g) => !pinnedIds.has(g.id) && eligible(g, opts, scoringCtx));
  const slots = bySlot(pool);
  const pinnedSlots = bySlot(pinned);

  const season = seasonNow(ctx.date ? new Date(ctx.date) : new Date());
  const rank = (xs: Garment[]) =>
    [...xs]
      .map((g) => ({ g, s: preScore(g, profile, fitCache, band, season) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.g);

  const tops = pinnedSlots.top.length ? [pinnedSlots.top[0]] : rank(slots.top).slice(0, beam);
  const bottoms = pinnedSlots.bottom.length ? [pinnedSlots.bottom[0]] : rank(slots.bottom).slice(0, beam);
  const dresses = pinnedSlots.dress.length ? [pinnedSlots.dress[0]] : rank(slots.dress).slice(0, Math.ceil(beam / 2));
  const shoes = pinnedSlots.shoes.length ? [pinnedSlots.shoes[0]] : rank(slots.shoes).slice(0, Math.max(3, Math.ceil(beam * 0.7)));
  const outers = rank([...pinnedSlots.outerwear, ...slots.outerwear]).slice(0, Math.max(2, Math.ceil(beam * 0.6)));

  /* --------------------------------- does the weather demand a layer? -- */
  const needed = ctx.weather ? cloForTemp(ctx.weather.feelsLikeC ?? ctx.weather.tempC) : null;
  const outerRequired = needed !== null && needed > 0.75;
  const outerBanned = needed !== null && needed < 0.28 && !pinnedSlots.outerwear.length;

  const outerChoices: (Garment | null)[] = pinnedSlots.outerwear.length
    ? [pinnedSlots.outerwear[0]]
    : outerBanned
      ? [null]
      : outerRequired
        ? outers.length ? outers : [null]
        : [null, ...outers.slice(0, 3)];

  /* --------------------------------------------------------- build -- */
  const bases: Garment[][] = [];
  for (const d of dresses) bases.push([d]);
  for (const t of tops) for (const b of bottoms) bases.push([t, b]);

  const extras = pinned.filter((g) => g.category === "accessory" || g.category === "bag");

  const results: CandidateOutfit[] = [];
  const shoeChoices: (Garment | null)[] = shoes.length ? shoes : [null];

  for (const base of bases) {
    for (const sh of shoeChoices) {
      for (const outer of outerChoices) {
        const combo = [...base, ...(sh ? [sh] : []), ...(outer ? [outer] : []), ...extras];
        if (pinnedIds.size && !pinned.every((p) => combo.some((c) => c.id === p.id))) continue;
        const score = scoreOutfit(combo, profile, scoringCtx);
        results.push({ garments: combo, score });
      }
    }
  }

  results.sort((a, b) => b.score.total - a.score.total);

  const kept: CandidateOutfit[] = [];
  for (const r of results) {
    if (r.score.verdict === "skip" && kept.length >= 3) continue;
    if (kept.some((k) => tooSimilar(k.garments, r.garments))) continue;
    kept.push(r);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** "What can I wear with this?" — the single most-used flow in a wardrobe app. */
export function outfitsWith(
  garmentId: string,
  wardrobe: Garment[],
  profile: Profile,
  ctx: ScoringContext = {},
  opts: Omit<SearchOptions, "mustInclude"> = {},
): CandidateOutfit[] {
  return findOutfits(wardrobe, profile, ctx, { ...opts, mustInclude: [garmentId] });
}

/**
 * How many genuinely wearable outfits the wardrobe yields. Used by the gap
 * analyser and the insights page — it's a far better measure of a wardrobe
 * than item count.
 */
export function countWearableOutfits(
  wardrobe: Garment[],
  profile: Profile,
  threshold = 76,
  ctx: ScoringContext = {},
): number {
  const found = findOutfits(wardrobe, profile, ctx, { limit: 400, beam: 7, includeUnavailable: true });
  return found.filter((f) => f.score.total >= threshold).length;
}

export { garmentClo };
