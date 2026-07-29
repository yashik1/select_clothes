/**
 * The garment-type catalogue. This is the reference data the engines lean on
 * when a user hasn't told us everything — default formality, how warm a thing
 * is, how much room it should have at each landmark, and where its hem lands.
 *
 * Ease bands are in centimetres of *garment circumference minus body
 * circumference*, for a "regular" cut in a non-stretch fabric. Stretch,
 * user fit preference and brand calibration are applied on top by the fit
 * engine — never baked in here.
 */
import type {
  BodyMeasurements,
  GarmentCategory,
  GarmentMeasurements,
  LayerSlot,
} from "../types";

/** Boundaries between fit verdicts, ascending. */
export interface EaseBand {
  /** Below this is "too tight". */
  tooTight: number;
  /** Below this is "snug" (wearable, close). */
  snug: number;
  /** Up to this is "ideal". */
  idealHi: number;
  /** Up to this is "relaxed". */
  relaxed: number;
  /** Up to this is "oversized" (intentional); beyond is "too loose". */
  oversized: number;
}

export interface LengthRule {
  from: keyof BodyMeasurements;
  /** Target garment length = body[from] + offset. */
  offset: number;
  /** ± centimetres still considered correct. */
  tol: number;
  /** Copy used when the garment is longer than target. */
  longAdvice?: string;
  /** Copy used when the garment is shorter than target. */
  shortAdvice?: string;
}

export type HemPosition =
  | "crop"
  | "waist"
  | "hip"
  | "mid-thigh"
  | "knee"
  | "midi"
  | "ankle"
  | "floor";

/** How far down the arm this type normally reaches. */
export type SleeveKind = "none" | "short" | "elbow" | "long";

export interface SubcategoryDef {
  key: string;
  label: string;
  category: GarmentCategory;
  layer: LayerSlot;
  knit: boolean;
  /** Base insulation in clo before fibre and gsm adjustment. */
  baseClo: number;
  /** Default 1-5 formality when the user doesn't override it. */
  formality: number;
  /** Visual bulk, 1 (skin-close) to 5 (very voluminous), at regular fit. */
  volume: number;
  ease: Partial<Record<keyof GarmentMeasurements, EaseBand>>;
  lengths: Partial<Record<keyof GarmentMeasurements, LengthRule>>;
  /**
   * The fabric stretch the ease bands above already assume. The fit engine
   * credits (or debits) only the *difference* between a garment's real stretch
   * and this baseline, so 2% elastane in a woven shirt buys real room while a
   * perfectly ordinary jersey tee doesn't get counted twice.
   * Defaults to 0.21 for knits and 0.03 for wovens.
   */
  canonicalStretch?: number;
  tuckable?: boolean;
  /**
   * Only needed where a `lengths.sleeveLength` rule can't say it: a rule
   * implies long sleeves, but its absence is ambiguous between short-sleeved
   * and sleeveless, and a tank top with sleeves is a worse drawing than a
   * t-shirt without them.
   */
  sleeve?: SleeveKind;
  hem?: HemPosition;
  /** Marks the waist visually (belt loops, defined seam, wrap). */
  definesWaist?: boolean;
  seasons?: ("spring" | "summer" | "autumn" | "winter")[];
}

const TOP_EASE_WOVEN: SubcategoryDef["ease"] = {
  chestFlat: { tooTight: 4, snug: 8, idealHi: 18, relaxed: 26, oversized: 36 },
  waistFlat: { tooTight: 2, snug: 6, idealHi: 20, relaxed: 30, oversized: 42 },
  shoulderFlat: { tooTight: -1.5, snug: -0.5, idealHi: 1.5, relaxed: 4, oversized: 8 },
};

const TOP_EASE_KNIT: SubcategoryDef["ease"] = {
  chestFlat: { tooTight: 0, snug: 5, idealHi: 15, relaxed: 24, oversized: 34 },
  waistFlat: { tooTight: -2, snug: 3, idealHi: 18, relaxed: 28, oversized: 40 },
  shoulderFlat: { tooTight: -2, snug: -0.5, idealHi: 2, relaxed: 5, oversized: 9 },
};

const SLEEVE_LONG: LengthRule = {
  from: "armLength",
  offset: 0,
  tol: 2,
  longAdvice: "Cuff it once, or have the sleeve shortened.",
  shortAdvice: "Sleeves read short — push them up deliberately rather than letting them sit awkwardly.",
};

const list: SubcategoryDef[] = [
  /* ------------------------------------------------------------- tops -- */
  {
    key: "t-shirt",
    label: "T-shirt",
    category: "top",
    layer: "base",
    knit: true,
    baseClo: 0.09,
    formality: 1,
    volume: 2,
    ease: TOP_EASE_KNIT,
    sleeve: "short",
    lengths: {
      bodyLength: { from: "torsoLength", offset: 24, tol: 5, longAdvice: "Hem sits low — front-tuck it to bring your waist back." },
    },
    tuckable: true,
    hem: "hip",
    seasons: ["spring", "summer", "autumn"],
  },
  {
    key: "long-sleeve-tee",
    label: "Long-sleeve tee",
    category: "top",
    layer: "base",
    knit: true,
    baseClo: 0.16,
    formality: 1,
    volume: 2,
    ease: TOP_EASE_KNIT,
    lengths: { sleeveLength: SLEEVE_LONG, bodyLength: { from: "torsoLength", offset: 24, tol: 5 } },
    tuckable: true,
    hem: "hip",
  },
  {
    key: "polo",
    label: "Polo shirt",
    category: "top",
    layer: "base",
    knit: true,
    baseClo: 0.11,
    formality: 2,
    volume: 2,
    ease: TOP_EASE_KNIT,
    sleeve: "short",
    lengths: { bodyLength: { from: "torsoLength", offset: 23, tol: 5 } },
    tuckable: true,
    hem: "hip",
  },
  {
    key: "oxford-shirt",
    label: "Oxford shirt",
    category: "top",
    layer: "base",
    knit: false,
    baseClo: 0.2,
    formality: 3,
    volume: 2,
    ease: { ...TOP_EASE_WOVEN, neckCircumference: { tooTight: 0.5, snug: 1, idealHi: 2.5, relaxed: 4, oversized: 6 } },
    lengths: { sleeveLength: SLEEVE_LONG, bodyLength: { from: "torsoLength", offset: 30, tol: 6 } },
    tuckable: true,
    hem: "hip",
  },
  {
    key: "dress-shirt",
    label: "Dress shirt",
    category: "top",
    layer: "base",
    knit: false,
    baseClo: 0.19,
    formality: 4,
    volume: 2,
    ease: {
      chestFlat: { tooTight: 6, snug: 10, idealHi: 18, relaxed: 24, oversized: 32 },
      waistFlat: { tooTight: 4, snug: 8, idealHi: 18, relaxed: 26, oversized: 36 },
      shoulderFlat: { tooTight: -1, snug: 0, idealHi: 1.5, relaxed: 3, oversized: 6 },
      neckCircumference: { tooTight: 0.5, snug: 1, idealHi: 2.5, relaxed: 4, oversized: 6 },
    },
    lengths: { sleeveLength: SLEEVE_LONG, bodyLength: { from: "torsoLength", offset: 34, tol: 6 } },
    tuckable: true,
    hem: "hip",
  },
  {
    key: "flannel-shirt",
    label: "Flannel shirt",
    category: "top",
    layer: "mid",
    knit: false,
    baseClo: 0.28,
    formality: 2,
    volume: 3,
    ease: TOP_EASE_WOVEN,
    lengths: { sleeveLength: SLEEVE_LONG, bodyLength: { from: "torsoLength", offset: 30, tol: 6 } },
    tuckable: true,
    hem: "hip",
    seasons: ["autumn", "winter"],
  },
  {
    key: "blouse",
    label: "Blouse",
    category: "top",
    layer: "base",
    knit: false,
    baseClo: 0.14,
    formality: 3,
    volume: 2,
    ease: TOP_EASE_WOVEN,
    sleeve: "long",
    lengths: { bodyLength: { from: "torsoLength", offset: 26, tol: 6 } },
    tuckable: true,
    hem: "hip",
  },
  {
    key: "tank",
    label: "Tank top",
    category: "top",
    layer: "base",
    knit: true,
    baseClo: 0.06,
    formality: 1,
    volume: 1,
    ease: TOP_EASE_KNIT,
    sleeve: "none",
    lengths: {},
    tuckable: true,
    hem: "hip",
    seasons: ["spring", "summer"],
  },
  {
    key: "sweater",
    label: "Sweater",
    category: "top",
    layer: "mid",
    knit: true,
    baseClo: 0.33,
    formality: 2,
    volume: 3,
    ease: TOP_EASE_KNIT,
    lengths: { sleeveLength: SLEEVE_LONG, bodyLength: { from: "torsoLength", offset: 25, tol: 6 } },
    tuckable: true,
    hem: "hip",
    seasons: ["autumn", "winter"],
  },
  {
    key: "cardigan",
    label: "Cardigan",
    category: "top",
    layer: "mid",
    knit: true,
    baseClo: 0.3,
    formality: 2,
    volume: 3,
    ease: TOP_EASE_KNIT,
    lengths: { sleeveLength: SLEEVE_LONG, bodyLength: { from: "torsoLength", offset: 28, tol: 8 } },
    hem: "hip",
    seasons: ["autumn", "winter", "spring"],
  },
  {
    key: "hoodie",
    label: "Hoodie",
    category: "top",
    layer: "mid",
    knit: true,
    baseClo: 0.35,
    formality: 1,
    volume: 4,
    ease: {
      chestFlat: { tooTight: 6, snug: 12, idealHi: 26, relaxed: 38, oversized: 52 },
      shoulderFlat: { tooTight: -1, snug: 1, idealHi: 5, relaxed: 10, oversized: 16 },
    },
    lengths: { sleeveLength: { ...SLEEVE_LONG, offset: 1, tol: 3 }, bodyLength: { from: "torsoLength", offset: 24, tol: 6 } },
    hem: "hip",
    seasons: ["autumn", "winter", "spring"],
  },
  {
    key: "sweatshirt",
    label: "Sweatshirt",
    category: "top",
    layer: "mid",
    knit: true,
    baseClo: 0.3,
    formality: 1,
    volume: 3,
    ease: {
      chestFlat: { tooTight: 4, snug: 10, idealHi: 24, relaxed: 36, oversized: 50 },
      shoulderFlat: { tooTight: -1, snug: 1, idealHi: 4, relaxed: 9, oversized: 15 },
    },
    lengths: { sleeveLength: SLEEVE_LONG, bodyLength: { from: "torsoLength", offset: 23, tol: 6 } },
    hem: "hip",
  },
  {
    key: "turtleneck",
    label: "Turtleneck",
    category: "top",
    layer: "base",
    knit: true,
    baseClo: 0.3,
    formality: 3,
    volume: 2,
    ease: TOP_EASE_KNIT,
    lengths: { sleeveLength: SLEEVE_LONG, bodyLength: { from: "torsoLength", offset: 24, tol: 5 } },
    tuckable: true,
    hem: "hip",
    seasons: ["autumn", "winter"],
  },

  /* ---------------------------------------------------------- bottoms -- */
  {
    key: "jeans",
    label: "Jeans",
    category: "bottom",
    layer: "legs",
    knit: false,
    baseClo: 0.26,
    formality: 2,
    volume: 2,
    ease: {
      waistFlat: { tooTight: -3, snug: -1, idealHi: 3, relaxed: 7, oversized: 12 },
      hipFlat: { tooTight: 1, snug: 4, idealHi: 12, relaxed: 20, oversized: 30 },
      thighFlat: { tooTight: 0, snug: 2, idealHi: 9, relaxed: 16, oversized: 26 },
    },
    lengths: {
      inseam: {
        from: "inseam",
        offset: 0,
        tol: 2,
        longAdvice: "Cuff or hem — stacking at the ankle shortens your leg line.",
        shortAdvice: "Reads cropped. Fine with a low-profile shoe, awkward with boots.",
      },
    },
    hem: "ankle",
    definesWaist: true,
  },
  {
    key: "chinos",
    label: "Chinos",
    category: "bottom",
    layer: "legs",
    knit: false,
    baseClo: 0.22,
    formality: 3,
    volume: 2,
    ease: {
      waistFlat: { tooTight: -1, snug: 1, idealHi: 5, relaxed: 9, oversized: 14 },
      hipFlat: { tooTight: 3, snug: 6, idealHi: 15, relaxed: 23, oversized: 33 },
      thighFlat: { tooTight: 1, snug: 4, idealHi: 12, relaxed: 19, oversized: 29 },
    },
    lengths: { inseam: { from: "inseam", offset: 0, tol: 2 } },
    hem: "ankle",
    definesWaist: true,
  },
  {
    key: "dress-trousers",
    label: "Dress trousers",
    category: "bottom",
    layer: "legs",
    knit: false,
    baseClo: 0.24,
    formality: 4,
    volume: 2,
    ease: {
      waistFlat: { tooTight: 0, snug: 2, idealHi: 5, relaxed: 9, oversized: 14 },
      hipFlat: { tooTight: 5, snug: 8, idealHi: 17, relaxed: 25, oversized: 35 },
      thighFlat: { tooTight: 3, snug: 6, idealHi: 14, relaxed: 22, oversized: 32 },
    },
    lengths: { inseam: { from: "inseam", offset: 1, tol: 2 } },
    hem: "ankle",
    definesWaist: true,
  },
  {
    key: "wide-leg-trousers",
    label: "Wide-leg trousers",
    category: "bottom",
    layer: "legs",
    knit: false,
    baseClo: 0.22,
    formality: 3,
    volume: 4,
    ease: {
      waistFlat: { tooTight: -1, snug: 1, idealHi: 6, relaxed: 11, oversized: 17 },
      hipFlat: { tooTight: 6, snug: 12, idealHi: 26, relaxed: 40, oversized: 56 },
    },
    lengths: { inseam: { from: "inseam", offset: 2, tol: 3 } },
    hem: "ankle",
    definesWaist: true,
  },
  {
    key: "shorts",
    label: "Shorts",
    category: "bottom",
    layer: "legs",
    knit: false,
    baseClo: 0.1,
    formality: 1,
    volume: 2,
    ease: {
      waistFlat: { tooTight: -1, snug: 1, idealHi: 5, relaxed: 9, oversized: 15 },
      hipFlat: { tooTight: 3, snug: 6, idealHi: 15, relaxed: 24, oversized: 34 },
      thighFlat: { tooTight: 1, snug: 4, idealHi: 12, relaxed: 20, oversized: 30 },
    },
    lengths: {},
    hem: "mid-thigh",
    definesWaist: true,
    seasons: ["spring", "summer"],
  },
  {
    key: "skirt",
    label: "Skirt",
    category: "bottom",
    layer: "legs",
    knit: false,
    baseClo: 0.14,
    formality: 3,
    volume: 2,
    ease: {
      waistFlat: { tooTight: -1, snug: 1, idealHi: 4, relaxed: 8, oversized: 13 },
      hipFlat: { tooTight: 2, snug: 5, idealHi: 13, relaxed: 22, oversized: 34 },
    },
    lengths: {},
    hem: "knee",
    definesWaist: true,
  },
  {
    key: "leggings",
    label: "Leggings",
    category: "bottom",
    layer: "legs",
    knit: true,
    baseClo: 0.14,
    formality: 1,
    volume: 1,
    ease: {
      waistFlat: { tooTight: -12, snug: -8, idealHi: -2, relaxed: 2, oversized: 6 },
      hipFlat: { tooTight: -14, snug: -9, idealHi: -2, relaxed: 3, oversized: 9 },
      thighFlat: { tooTight: -10, snug: -6, idealHi: -1, relaxed: 3, oversized: 8 },
    },
    lengths: { inseam: { from: "inseam", offset: -1, tol: 3 } },
    canonicalStretch: 0.35,
    hem: "ankle",
  },
  {
    key: "joggers",
    label: "Joggers",
    category: "bottom",
    layer: "legs",
    knit: true,
    baseClo: 0.22,
    formality: 1,
    volume: 3,
    ease: {
      waistFlat: { tooTight: -6, snug: -2, idealHi: 4, relaxed: 10, oversized: 18 },
      hipFlat: { tooTight: 2, snug: 6, idealHi: 18, relaxed: 28, oversized: 40 },
    },
    lengths: { inseam: { from: "inseam", offset: -2, tol: 3 } },
    hem: "ankle",
  },

  /* ---------------------------------------------------------- dresses -- */
  {
    key: "day-dress",
    label: "Day dress",
    category: "dress",
    layer: "base",
    knit: false,
    baseClo: 0.16,
    formality: 3,
    volume: 3,
    ease: {
      chestFlat: { tooTight: 3, snug: 6, idealHi: 14, relaxed: 22, oversized: 34 },
      waistFlat: { tooTight: 1, snug: 4, idealHi: 12, relaxed: 22, oversized: 36 },
      hipFlat: { tooTight: 2, snug: 5, idealHi: 15, relaxed: 26, oversized: 40 },
    },
    sleeve: "short",
    lengths: {},
    hem: "knee",
    definesWaist: true,
  },
  {
    key: "cocktail-dress",
    label: "Cocktail dress",
    category: "dress",
    layer: "base",
    knit: false,
    baseClo: 0.12,
    formality: 5,
    volume: 2,
    ease: {
      chestFlat: { tooTight: 1, snug: 3, idealHi: 9, relaxed: 16, oversized: 26 },
      waistFlat: { tooTight: 0, snug: 2, idealHi: 8, relaxed: 15, oversized: 25 },
      hipFlat: { tooTight: 1, snug: 3, idealHi: 10, relaxed: 18, oversized: 30 },
    },
    sleeve: "none",
    lengths: {},
    hem: "knee",
    definesWaist: true,
  },
  {
    key: "maxi-dress",
    label: "Maxi dress",
    category: "dress",
    layer: "base",
    knit: false,
    baseClo: 0.18,
    formality: 3,
    volume: 4,
    ease: {
      chestFlat: { tooTight: 3, snug: 6, idealHi: 15, relaxed: 24, oversized: 36 },
      waistFlat: { tooTight: 1, snug: 4, idealHi: 14, relaxed: 26, oversized: 40 },
    },
    sleeve: "none",
    lengths: {},
    hem: "floor",
    definesWaist: true,
  },
  {
    key: "jumpsuit",
    label: "Jumpsuit",
    category: "dress",
    layer: "base",
    knit: false,
    baseClo: 0.2,
    formality: 3,
    volume: 3,
    ease: {
      chestFlat: { tooTight: 3, snug: 7, idealHi: 16, relaxed: 26, oversized: 38 },
      waistFlat: { tooTight: 1, snug: 4, idealHi: 13, relaxed: 24, oversized: 38 },
      hipFlat: { tooTight: 3, snug: 6, idealHi: 16, relaxed: 26, oversized: 40 },
    },
    sleeve: "short",
    lengths: { inseam: { from: "inseam", offset: 0, tol: 3 } },
    hem: "ankle",
    definesWaist: true,
  },

  /* -------------------------------------------------------- outerwear -- */
  {
    key: "blazer",
    label: "Blazer",
    category: "outerwear",
    layer: "outer",
    knit: false,
    baseClo: 0.3,
    formality: 4,
    volume: 3,
    ease: {
      chestFlat: { tooTight: 8, snug: 12, idealHi: 20, relaxed: 28, oversized: 40 },
      waistFlat: { tooTight: 6, snug: 10, idealHi: 22, relaxed: 32, oversized: 46 },
      shoulderFlat: { tooTight: 0, snug: 0.5, idealHi: 2, relaxed: 4, oversized: 7 },
    },
    lengths: {
      sleeveLength: { from: "armLength", offset: -1.5, tol: 1.5, longAdvice: "Sleeve should stop at the wrist bone and let ~1cm of shirt cuff show." },
      bodyLength: { from: "torsoLength", offset: 32, tol: 5 },
    },
    hem: "hip",
    definesWaist: true,
  },
  {
    key: "suit-jacket",
    label: "Suit jacket",
    category: "outerwear",
    layer: "outer",
    knit: false,
    baseClo: 0.32,
    formality: 5,
    volume: 3,
    ease: {
      chestFlat: { tooTight: 10, snug: 13, idealHi: 20, relaxed: 26, oversized: 36 },
      shoulderFlat: { tooTight: 0, snug: 0.5, idealHi: 1.5, relaxed: 3, oversized: 5 },
    },
    lengths: {
      sleeveLength: { from: "armLength", offset: -1.5, tol: 1.5 },
      bodyLength: { from: "torsoLength", offset: 33, tol: 4 },
    },
    hem: "hip",
    definesWaist: true,
  },
  {
    key: "denim-jacket",
    label: "Denim jacket",
    category: "outerwear",
    layer: "outer",
    knit: false,
    baseClo: 0.32,
    formality: 2,
    volume: 3,
    ease: {
      chestFlat: { tooTight: 6, snug: 10, idealHi: 22, relaxed: 32, oversized: 46 },
      shoulderFlat: { tooTight: -0.5, snug: 0.5, idealHi: 3, relaxed: 6, oversized: 10 },
    },
    lengths: { sleeveLength: { from: "armLength", offset: -1, tol: 2 }, bodyLength: { from: "torsoLength", offset: 22, tol: 5 } },
    hem: "waist",
  },
  {
    key: "leather-jacket",
    label: "Leather jacket",
    category: "outerwear",
    layer: "outer",
    knit: false,
    baseClo: 0.4,
    formality: 3,
    volume: 3,
    ease: {
      chestFlat: { tooTight: 6, snug: 10, idealHi: 20, relaxed: 28, oversized: 40 },
      shoulderFlat: { tooTight: -0.5, snug: 0.5, idealHi: 2.5, relaxed: 5, oversized: 9 },
    },
    lengths: { sleeveLength: { from: "armLength", offset: -1, tol: 2 }, bodyLength: { from: "torsoLength", offset: 23, tol: 5 } },
    hem: "waist",
  },
  {
    key: "trench-coat",
    label: "Trench coat",
    category: "outerwear",
    layer: "outer",
    knit: false,
    baseClo: 0.45,
    formality: 4,
    volume: 4,
    ease: {
      chestFlat: { tooTight: 12, snug: 18, idealHi: 32, relaxed: 44, oversized: 60 },
      shoulderFlat: { tooTight: 0.5, snug: 1.5, idealHi: 5, relaxed: 9, oversized: 14 },
    },
    lengths: { sleeveLength: { from: "armLength", offset: 0, tol: 2 } },
    hem: "knee",
    definesWaist: true,
    seasons: ["spring", "autumn"],
  },
  {
    key: "wool-coat",
    label: "Wool coat",
    category: "outerwear",
    layer: "outer",
    knit: false,
    baseClo: 0.62,
    formality: 4,
    volume: 4,
    ease: {
      chestFlat: { tooTight: 14, snug: 20, idealHi: 34, relaxed: 46, oversized: 62 },
      shoulderFlat: { tooTight: 1, snug: 2, idealHi: 5.5, relaxed: 9, oversized: 14 },
    },
    lengths: { sleeveLength: { from: "armLength", offset: 1, tol: 2 } },
    hem: "mid-thigh",
    seasons: ["autumn", "winter"],
  },
  {
    key: "puffer",
    label: "Puffer jacket",
    category: "outerwear",
    layer: "outer",
    knit: false,
    baseClo: 0.78,
    formality: 1,
    volume: 5,
    ease: {
      chestFlat: { tooTight: 12, snug: 18, idealHi: 34, relaxed: 50, oversized: 70 },
    },
    lengths: { sleeveLength: { from: "armLength", offset: 1, tol: 3 } },
    hem: "hip",
    seasons: ["winter"],
  },
  {
    key: "rain-shell",
    label: "Rain shell",
    category: "outerwear",
    layer: "outer",
    knit: false,
    baseClo: 0.2,
    formality: 1,
    volume: 3,
    ease: { chestFlat: { tooTight: 10, snug: 16, idealHi: 30, relaxed: 44, oversized: 62 } },
    lengths: { sleeveLength: { from: "armLength", offset: 1, tol: 3 } },
    hem: "hip",
  },
  {
    key: "vest",
    label: "Vest / gilet",
    category: "outerwear",
    layer: "mid",
    knit: false,
    baseClo: 0.28,
    formality: 2,
    volume: 3,
    ease: { chestFlat: { tooTight: 6, snug: 10, idealHi: 22, relaxed: 34, oversized: 48 } },
    sleeve: "none",
    lengths: {},
    hem: "hip",
  },

  /* ------------------------------------------------------------ shoes -- */
  { key: "sneakers", label: "Sneakers", category: "shoes", layer: "feet", knit: false, baseClo: 0.05, formality: 1, volume: 3, ease: {}, lengths: {} },
  { key: "minimal-sneakers", label: "Minimal sneakers", category: "shoes", layer: "feet", knit: false, baseClo: 0.05, formality: 2, volume: 2, ease: {}, lengths: {} },
  { key: "loafers", label: "Loafers", category: "shoes", layer: "feet", knit: false, baseClo: 0.05, formality: 3, volume: 2, ease: {}, lengths: {} },
  { key: "oxfords", label: "Oxfords", category: "shoes", layer: "feet", knit: false, baseClo: 0.05, formality: 5, volume: 2, ease: {}, lengths: {} },
  { key: "derbies", label: "Derby shoes", category: "shoes", layer: "feet", knit: false, baseClo: 0.05, formality: 4, volume: 2, ease: {}, lengths: {} },
  { key: "chelsea-boots", label: "Chelsea boots", category: "shoes", layer: "feet", knit: false, baseClo: 0.08, formality: 3, volume: 3, ease: {}, lengths: {}, seasons: ["autumn", "winter"] },
  { key: "combat-boots", label: "Boots", category: "shoes", layer: "feet", knit: false, baseClo: 0.1, formality: 2, volume: 4, ease: {}, lengths: {}, seasons: ["autumn", "winter"] },
  { key: "heels", label: "Heels", category: "shoes", layer: "feet", knit: false, baseClo: 0.04, formality: 4, volume: 2, ease: {}, lengths: {} },
  { key: "flats", label: "Flats", category: "shoes", layer: "feet", knit: false, baseClo: 0.04, formality: 3, volume: 2, ease: {}, lengths: {} },
  { key: "sandals", label: "Sandals", category: "shoes", layer: "feet", knit: false, baseClo: 0.01, formality: 1, volume: 1, ease: {}, lengths: {}, seasons: ["summer"] },

  /* ------------------------------------------------------ accessories -- */
  { key: "belt", label: "Belt", category: "accessory", layer: "accent", knit: false, baseClo: 0, formality: 3, volume: 1, ease: {}, lengths: {}, definesWaist: true },
  { key: "scarf", label: "Scarf", category: "accessory", layer: "accent", knit: true, baseClo: 0.12, formality: 2, volume: 3, ease: {}, lengths: {}, seasons: ["autumn", "winter"] },
  { key: "hat", label: "Hat", category: "accessory", layer: "accent", knit: false, baseClo: 0.04, formality: 2, volume: 2, ease: {}, lengths: {} },
  { key: "beanie", label: "Beanie", category: "accessory", layer: "accent", knit: true, baseClo: 0.06, formality: 1, volume: 2, ease: {}, lengths: {}, seasons: ["autumn", "winter"] },
  { key: "watch", label: "Watch", category: "accessory", layer: "accent", knit: false, baseClo: 0, formality: 3, volume: 1, ease: {}, lengths: {} },
  { key: "jewellery", label: "Jewellery", category: "accessory", layer: "accent", knit: false, baseClo: 0, formality: 3, volume: 1, ease: {}, lengths: {} },
  { key: "tie", label: "Tie", category: "accessory", layer: "accent", knit: false, baseClo: 0, formality: 5, volume: 1, ease: {}, lengths: {} },
  { key: "sunglasses", label: "Sunglasses", category: "accessory", layer: "accent", knit: false, baseClo: 0, formality: 2, volume: 1, ease: {}, lengths: {} },

  /* ------------------------------------------------------------- bags -- */
  { key: "tote", label: "Tote bag", category: "bag", layer: "accent", knit: false, baseClo: 0, formality: 2, volume: 3, ease: {}, lengths: {} },
  { key: "backpack", label: "Backpack", category: "bag", layer: "accent", knit: false, baseClo: 0, formality: 1, volume: 4, ease: {}, lengths: {} },
  { key: "shoulder-bag", label: "Shoulder bag", category: "bag", layer: "accent", knit: false, baseClo: 0, formality: 3, volume: 2, ease: {}, lengths: {} },
  { key: "briefcase", label: "Briefcase", category: "bag", layer: "accent", knit: false, baseClo: 0, formality: 5, volume: 2, ease: {}, lengths: {} },
  { key: "clutch", label: "Clutch", category: "bag", layer: "accent", knit: false, baseClo: 0, formality: 5, volume: 1, ease: {}, lengths: {} },
];

export const SUBCATEGORIES: Record<string, SubcategoryDef> = Object.fromEntries(
  list.map((s) => [s.key, s]),
);

export const SUBCATEGORY_LIST = list;

const CATEGORY_FALLBACK: Record<GarmentCategory, SubcategoryDef> = {
  top: SUBCATEGORIES["t-shirt"],
  bottom: SUBCATEGORIES["chinos"],
  dress: SUBCATEGORIES["day-dress"],
  outerwear: SUBCATEGORIES["denim-jacket"],
  shoes: SUBCATEGORIES["sneakers"],
  accessory: SUBCATEGORIES["belt"],
  bag: SUBCATEGORIES["tote"],
};

/** Never throws — an unknown subcategory falls back to the category archetype. */
export function subcategoryDef(subcategory: string, category: GarmentCategory): SubcategoryDef {
  return SUBCATEGORIES[subcategory] ?? CATEGORY_FALLBACK[category] ?? CATEGORY_FALLBACK.top;
}

export function subcategoriesFor(category: GarmentCategory): SubcategoryDef[] {
  return list.filter((s) => s.category === category);
}

/**
 * How far down the arm this type reaches when the garment itself hasn't been
 * measured. A `lengths.sleeveLength` rule is only ever written for a type that
 * goes to the wrist, so its presence answers the question; its absence doesn't,
 * which is why the ambiguous types declare `sleeve` outright.
 */
export function sleeveKind(def: SubcategoryDef): SleeveKind {
  if (def.sleeve) return def.sleeve;
  if (def.lengths.sleeveLength) return "long";
  return "none";
}

/** Fractions of arm length, shoulder seam to cuff. */
const SLEEVE_FRACTION: Record<SleeveKind, number> = {
  none: 0,
  short: 0.3,
  elbow: 0.52,
  long: 1,
};

/**
 * The sleeve length to draw when the garment has none recorded: the type's own
 * rule against this body's arm, rather than nothing at all. Returns 0 for a
 * genuinely sleeveless type.
 */
export function assumedSleeveLength(def: SubcategoryDef, armLength: number): number {
  const kind = sleeveKind(def);
  if (kind === "none") return 0;
  const rule = def.lengths.sleeveLength;
  if (kind === "long" && rule?.from === "armLength") {
    return Math.max(0, armLength + rule.offset);
  }
  return armLength * SLEEVE_FRACTION[kind];
}

/* --------------------------------------------- garment measurement meta -- */

export type MeasureKind = "circumference" | "width" | "length";

export interface MeasureMeta {
  label: string;
  kind: MeasureKind;
  /** Body landmark this compares against. */
  body?: keyof BodyMeasurements;
  /** How to measure it, shown inline in the UI. */
  how: string;
}

/**
 * `circumference` values are entered *flat* (garment lying on a table) and
 * doubled internally — that's how brand size charts publish them and how a tape
 * measure on a table works. `width` and `length` are used as entered.
 */
export const MEASURE_META: Record<keyof GarmentMeasurements, MeasureMeta> = {
  chestFlat: { label: "Chest (flat)", kind: "circumference", body: "chest", how: "Lay flat, measure pit to pit." },
  waistFlat: { label: "Waist (flat)", kind: "circumference", body: "waistNatural", how: "Lay flat, measure across the narrowest point." },
  hipFlat: { label: "Hip (flat)", kind: "circumference", body: "hip", how: "Lay flat, measure across the widest point below the waist." },
  thighFlat: { label: "Thigh (flat)", kind: "circumference", body: "thigh", how: "Lay flat, measure across the leg just below the crotch seam." },
  legOpeningFlat: { label: "Leg opening (flat)", kind: "circumference", how: "Lay flat, measure across the hem of one leg." },
  neckCircumference: { label: "Collar", kind: "width", body: "neck", how: "Measure the buttoned collar end to end." },
  shoulderFlat: { label: "Shoulder", kind: "width", body: "shoulderWidth", how: "Seam to seam across the back." },
  sleeveLength: { label: "Sleeve length", kind: "length", body: "armLength", how: "Shoulder seam to cuff edge." },
  bodyLength: { label: "Body length", kind: "length", how: "Highest shoulder point straight down to the hem." },
  inseam: { label: "Inseam", kind: "length", body: "inseam", how: "Crotch seam to hem along the inside leg." },
  rise: { label: "Rise", kind: "length", body: "riseFront", how: "Crotch seam up to the top of the waistband, front." },
};

export const GARMENT_MEASURE_KEYS = Object.keys(MEASURE_META) as (keyof GarmentMeasurements)[];
