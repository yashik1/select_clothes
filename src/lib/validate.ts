import { z } from "zod";
import { BOUNDS, measurementProblems } from "./measurements";
import type { BodyMeasurements } from "./types";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb colour");

const numberish = z.union([z.number(), z.null()]).optional();

const CARE_STATES = ["clean", "laundry", "repair", "stored", "loaned"] as const;

/**
 * A body measurement, bounded. The client checks these too and says so far
 * more helpfully, but the client is not the last word: a profile saved with a
 * stature of 13cm silently poisons every score the app produces afterwards,
 * because every unmeasured girth and every landmark height is a fraction of it.
 */
const measured = (key: keyof BodyMeasurements) =>
  z
    .union([z.number(), z.null()])
    .optional()
    .refine(
      (v) => typeof v !== "number" || (v >= BOUNDS[key].min && v <= BOUNDS[key].max),
      // Centimetres, and kilograms for weight — this is the storage boundary,
      // so it has no idea what the user was shown.
      `${key} must be between ${BOUNDS[key].min} and ${BOUNDS[key].max}`,
    );

export const measurementsSchema = z
  .object({
    height: measured("height"), weight: measured("weight"), neck: measured("neck"),
    shoulderWidth: measured("shoulderWidth"), chest: measured("chest"),
    underbust: measured("underbust"), waistNatural: measured("waistNatural"),
    waistWorn: measured("waistWorn"), highHip: measured("highHip"), hip: measured("hip"),
    thigh: measured("thigh"), calf: measured("calf"), bicep: measured("bicep"),
    wrist: measured("wrist"), armLength: measured("armLength"),
    sleeveFromCenterBack: measured("sleeveFromCenterBack"),
    torsoLength: measured("torsoLength"), backLength: measured("backLength"),
    inseam: measured("inseam"), outseam: measured("outseam"),
    riseFront: measured("riseFront"), footLength: measured("footLength"),
  })
  .partial()
  // Fields that pass on their own can still be impossible together — a girth
  // larger than a stature is the shape a height typed in feet takes.
  .superRefine((m, ctx) => {
    for (const problem of measurementProblems(m as BodyMeasurements, "cm")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [problem.key], message: problem.message });
    }
  });

export const garmentMeasurementsSchema = z
  .object({
    chestFlat: numberish, waistFlat: numberish, hipFlat: numberish, thighFlat: numberish,
    legOpeningFlat: numberish, neckCircumference: numberish, shoulderFlat: numberish,
    sleeveLength: numberish, bodyLength: numberish, inseam: numberish, rise: numberish,
  })
  .partial();

export const garmentInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Give it a name").max(120),
  category: z.enum(["top", "bottom", "dress", "outerwear", "shoes", "accessory", "bag"]),
  subcategory: z.string().min(1),
  brand: z.string().max(80).optional(),
  size: z.string().max(24).optional(),
  sizeSystem: z
    .enum([
      "alpha-mens", "alpha-womens", "alpha-unisex", "us-womens", "uk-womens",
      "eu-womens", "eu-mens", "waist-inseam", "neck-sleeve", "free",
    ])
    .optional(),
  colors: z.array(z.object({ hex, share: z.number().min(0).max(1) })).min(1).max(4),
  pattern: z.enum(["solid", "stripe", "check", "floral", "geometric", "animal", "graphic", "texture"]),
  patternScale: z.enum(["none", "micro", "medium", "bold"]),
  fabric: z.record(z.string(), z.number().min(0).max(1)),
  gsm: numberish,
  formality: z.number().min(1).max(5),
  fitIntent: z.enum(["slim", "regular", "relaxed", "oversized"]),
  measurements: garmentMeasurementsSchema,
  seasons: z.array(z.enum(["spring", "summer", "autumn", "winter"])),
  careState: z.enum(CARE_STATES),
  pricePaid: numberish,
  currency: z.string().max(6).optional(),
  purchasedAt: z.string().optional(),
  retailer: z.string().max(80).optional(),
  productUrl: z.string().url().optional().or(z.literal("")),
  imageIds: z.array(z.string()),
  notes: z.string().max(2000).optional(),
  rating: numberish,
  archivedAt: z.string().nullable().optional(),
});

export type GarmentInput = z.infer<typeof garmentInputSchema>;

/**
 * The quick-toggle payload — laundry state, rating, archive — so the client
 * doesn't have to round-trip a whole garment to say it's in the wash. These
 * fields are written straight onto the stored row, so they get validated just
 * as strictly as a full save.
 */
export const garmentPatchSchema = z.object({
  __patch: z.literal(true),
  careState: z.enum(CARE_STATES).optional(),
  rating: numberish,
  archivedAt: z.string().nullable().optional(),
});

export const profileInputSchema = z.object({
  name: z.string().min(1).max(80),
  unit: z.enum(["cm", "in"]),
  measurements: measurementsSchema,
  coloring: z.object({
    skinDepth: numberish,
    undertone: z.enum(["warm", "cool", "neutral", "olive"]).optional(),
    hairHex: hex.optional(),
    eyeHex: hex.optional(),
    seasonOverride: z.string().nullable().optional(),
  }),
  fitPreferences: z.record(z.string(), z.enum(["slim", "regular", "relaxed", "oversized"])),
  bodyShapeOverride: z
    .enum(["hourglass", "pear", "apple", "rectangle", "inverted-triangle", "unknown"])
    .nullable()
    .optional(),
  styleNotes: z.string().max(1000).optional(),
  locationLat: numberish,
  locationLon: numberish,
  locationLabel: z.string().max(120).optional(),
  bodyPhotoIds: z.array(z.string()),
});

export const occasionSchema = z
  .enum([
    "loungewear", "errands", "casual-social", "smart-casual", "office",
    "business-formal", "date-night", "cocktail", "black-tie", "workout", "travel",
  ])
  .optional();

/**
 * Strips the nulls and empty strings the forms send for cleared fields, and
 * narrows the type accordingly — the domain model uses `undefined` for
 * "not recorded", never `null`.
 */
export type Compacted<T> = { [K in keyof T]?: Exclude<T[K], null> };

export function compact<T extends Record<string, unknown>>(obj: T): Compacted<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out as Compacted<T>;
}
