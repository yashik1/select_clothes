/**
 * Core domain types.
 *
 * Everything is stored in centimetres internally. Imperial is a presentation
 * concern handled at the UI edge (see `src/lib/units.ts`), so the engines never
 * have to care which unit the user prefers.
 */

export type Unit = "cm" | "in";

/* ------------------------------------------------------------------ body -- */

/**
 * Body landmarks. Every field is optional because the whole app is designed to
 * degrade gracefully: three measurements gets you a rough answer, fifteen gets
 * you a confident one. `confidence` in the scoring output is what tells the
 * user which of those they're looking at.
 */
export interface BodyMeasurements {
  height?: number;
  weight?: number;

  neck?: number;
  shoulderWidth?: number; // seam to seam across the back
  chest?: number; // fullest point of chest/bust
  underbust?: number;
  waistNatural?: number; // narrowest point
  waistWorn?: number; // where the user actually sits their waistband
  highHip?: number; // ~8cm below natural waist
  hip?: number; // fullest point of seat
  thigh?: number;
  calf?: number;

  bicep?: number;
  wrist?: number;
  armLength?: number; // shoulder point to wrist bone
  sleeveFromCenterBack?: number;

  torsoLength?: number; // base of neck to natural waist, front
  backLength?: number;
  inseam?: number;
  outseam?: number;
  riseFront?: number;

  footLength?: number;
}

export type Undertone = "warm" | "cool" | "neutral" | "olive";

export interface ColoringProfile {
  /** 1 (very fair) .. 10 (deep). Drives palette depth and contrast maths. */
  skinDepth?: number;
  undertone?: Undertone;
  hairHex?: string;
  eyeHex?: string;
  /** Optional manual override of the derived 12-season result. */
  seasonOverride?: SeasonName | null;
}

export type SeasonName =
  | "Bright Spring"
  | "True Spring"
  | "Light Spring"
  | "Light Summer"
  | "True Summer"
  | "Soft Summer"
  | "Soft Autumn"
  | "True Autumn"
  | "Deep Autumn"
  | "Deep Winter"
  | "True Winter"
  | "Bright Winter";

export type BodyShape =
  | "hourglass"
  | "pear"
  | "apple"
  | "rectangle"
  | "inverted-triangle"
  | "unknown";

export type FitPreference = "slim" | "regular" | "relaxed" | "oversized";

export interface Profile {
  id: string;
  name: string;
  unit: Unit;
  measurements: BodyMeasurements;
  coloring: ColoringProfile;
  /** Per-category preferred cut. Overrides the category default in the fit engine. */
  fitPreferences: Partial<Record<GarmentCategory, FitPreference>>;
  bodyShapeOverride?: BodyShape | null;
  /** Free-text style goals, fed into suggestion copy. */
  styleNotes?: string;
  /** Home city, used for the weather engine. */
  locationLat?: number;
  locationLon?: number;
  locationLabel?: string;
  bodyPhotoIds: string[];
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------------------------------------- garment -- */

export type GarmentCategory =
  | "top"
  | "bottom"
  | "dress"
  | "outerwear"
  | "shoes"
  | "accessory"
  | "bag";

/** Where a garment sits when layered. Lower numbers go closer to the skin. */
export type LayerSlot = "base" | "mid" | "outer" | "legs" | "feet" | "accent";

/**
 * Which sizing block a garment was cut to. This is a property of the garment,
 * not the person — it lets us look up the right chart without asking the user
 * to declare a gender anywhere in the app.
 */
export type SizeSystem =
  | "alpha-mens"
  | "alpha-womens"
  | "alpha-unisex"
  | "us-womens"
  | "uk-womens"
  | "eu-womens"
  | "eu-mens"
  | "waist-inseam"
  | "neck-sleeve"
  | "free";

export type Pattern =
  | "solid"
  | "stripe"
  | "check"
  | "floral"
  | "geometric"
  | "animal"
  | "graphic"
  | "texture";

export type PatternScale = "none" | "micro" | "medium" | "bold";

export type CareState = "clean" | "laundry" | "repair" | "stored" | "loaned";

export interface GarmentColor {
  hex: string;
  /** 0..1 share of the visible garment surface. Primary colour first. */
  share: number;
}

/**
 * Flat (laid-down) garment measurements. For circumference landmarks the user
 * measures across the garment lying flat; we double it internally. Storing the
 * raw flat number is deliberate — it's what a tape measure on a table gives you
 * and what brand size charts publish.
 */
export interface GarmentMeasurements {
  chestFlat?: number;
  waistFlat?: number;
  hipFlat?: number;
  shoulderFlat?: number;
  sleeveLength?: number;
  bodyLength?: number; // high point shoulder to hem
  inseam?: number;
  rise?: number;
  thighFlat?: number;
  legOpeningFlat?: number;
  neckCircumference?: number;
}

export interface Garment {
  id: string;
  name: string;
  category: GarmentCategory;
  /** Free-form but matched against `SUBCATEGORIES` for defaults (e.g. "oxford-shirt"). */
  subcategory: string;
  brand?: string;
  size?: string;
  sizeSystem?: SizeSystem;

  colors: GarmentColor[];
  pattern: Pattern;
  patternScale: PatternScale;

  /** e.g. { cotton: 0.98, elastane: 0.02 }. Shares sum to ~1. */
  fabric: Record<string, number>;
  /** Grams per square metre. Drives warmth and drape when known. */
  gsm?: number;

  /** 1 = loungewear, 5 = black tie. */
  formality: number;
  /** Intended cut as sold. Combined with the user's preference in the fit engine. */
  fitIntent: FitPreference;

  measurements: GarmentMeasurements;

  seasons: ("spring" | "summer" | "autumn" | "winter")[];
  careState: CareState;

  pricePaid?: number;
  currency?: string;
  purchasedAt?: string;
  retailer?: string;
  productUrl?: string;

  imageIds: string[];
  notes?: string;

  wearCount: number;
  lastWornAt?: string | null;
  /** User's own 1-5 love rating. Nudges suggestions. */
  rating?: number;
  archivedAt?: string | null;

  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------- outfit -- */

export interface Outfit {
  id: string;
  name?: string;
  garmentIds: string[];
  occasion?: OccasionKey;
  /** Cached score at save time, so history shows what we thought back then. */
  scoreSnapshot?: number;
  pinned: boolean;
  /**
   * Present only while the outfit has a live share link, and it *is* the
   * capability: anyone holding it can read this one outfit. Lives in its own
   * column rather than in `data`, so it can be indexed for the public lookup
   * and so an ordinary save can never overwrite or silently revoke it.
   */
  shareToken?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * An outfit assigned to a future day.
 *
 * Deliberately not a `wear_log` row with tomorrow's date on it. A wear is a
 * fact and it moves real counters — `wear_count`, `last_worn_at`, cost per
 * wear, the rotation score. An intention must move none of them, or Insights
 * would start reporting on clothes nobody has put on yet. Confirming a plan is
 * what writes the wear.
 */
export interface DayPlan {
  id: string;
  /** Local calendar day, `YYYY-MM-DD`. Not a timestamp: a plan is for a date. */
  date: string;
  garmentIds: string[];
  /** The saved outfit this came from, when it came from one. */
  outfitId?: string | null;
  occasion?: OccasionKey;
  note?: string;
  createdAt: string;
}

export interface WearLog {
  id: string;
  date: string; // ISO date
  garmentIds: string[];
  outfitId?: string | null;
  occasion?: OccasionKey;
  tempC?: number;
  /** How the user actually felt. This is what trains the calibration loop. */
  comfortRating?: number; // 1-5
  notes?: string;
  createdAt: string;
}

export type FitVerdict =
  | "too-tight"
  | "snug"
  | "ideal"
  | "relaxed"
  | "oversized"
  | "too-loose";

/**
 * Post-wear feedback on a single garment. Aggregated per brand+category into
 * `BrandCalibration`, which is the asset that makes the app better the longer
 * you use it.
 */
export interface FitFeedback {
  id: string;
  garmentId: string;
  landmark: keyof GarmentMeasurements | "overall";
  verdict: FitVerdict;
  createdAt: string;
}

export interface BrandCalibration {
  brand: string;
  category: GarmentCategory;
  /** Centimetres of systematic bias. Positive = this brand runs large on you. */
  easeBiasCm: number;
  sampleCount: number;
  updatedAt: string;
}

/* -------------------------------------------------------------- scoring -- */

export type OccasionKey =
  | "loungewear"
  | "errands"
  | "casual-social"
  | "smart-casual"
  | "office"
  | "business-formal"
  | "date-night"
  | "cocktail"
  | "black-tie"
  | "workout"
  | "travel";

export interface WeatherContext {
  tempC: number;
  feelsLikeC?: number;
  windKph?: number;
  precipitationMm?: number;
  humidity?: number;
  label?: string;
}

export interface ScoringContext {
  occasion?: OccasionKey;
  weather?: WeatherContext;
  /** ISO date the outfit is for. Defaults to today. Drives novelty checks. */
  date?: string;
  recentWear?: WearLog[];
  calibrations?: BrandCalibration[];
  /**
   * Per-garment fit is independent of the rest of the outfit, so when scoring
   * thousands of candidate combinations we compute each garment once and reuse
   * it. Callers scoring a single outfit can ignore this.
   */
  fitCache?: Map<string, GarmentFitReport>;
}

export type Severity = "good" | "info" | "warn" | "bad";

/** A single human-readable finding. The UI never shows a bare number. */
export interface Reason {
  severity: Severity;
  /** Short headline, e.g. "Chest is 4cm tighter than your comfortable range". */
  text: string;
  /** Optional concrete action, e.g. "Size up to L, or wear it open over a tee". */
  fix?: string;
  /** Which garment(s) this is about. */
  garmentIds?: string[];
  /** Points this finding moved the sub-score by. Negative = penalty. */
  impact?: number;
}

export interface SubScore {
  key: DimensionKey;
  label: string;
  /** 0-100. */
  score: number;
  /** 0-1. How much data backed this up. */
  confidence: number;
  /** Relative weight in the composite, before confidence weighting. */
  weight: number;
  reasons: Reason[];
  /** What the user could add to raise confidence. */
  missingData?: string[];
}

export type DimensionKey =
  | "fit"
  | "color"
  | "proportion"
  | "formality"
  | "weather"
  | "novelty";

export type Verdict = "wear-it" | "close" | "skip";

export interface OutfitScore {
  /** 0-100 composite, confidence-weighted across dimensions. */
  total: number;
  verdict: Verdict;
  /** One-line summary suitable for a card. */
  headline: string;
  confidence: number;
  dimensions: SubScore[];
  /** Ranked, deduplicated fixes pulled from every dimension. */
  topFixes: Reason[];
}

/** Per-landmark output of the fit engine for a single garment. */
export interface FitFinding {
  landmark: string;
  label: string;
  bodyCm: number;
  garmentCm: number;
  /** Raw garment-minus-body, before stretch is considered. */
  easeCm: number;
  /** Ease after crediting fabric stretch and brand calibration. */
  effectiveEaseCm: number;
  verdict: FitVerdict;
  /** 0-100 for this landmark alone. */
  score: number;
  confidence: number;
  advice?: string;
}

export interface GarmentFitReport {
  garmentId: string;
  score: number;
  confidence: number;
  findings: FitFinding[];
  /** True when we inferred garment dimensions from a size chart rather than
   *  measured values, which materially lowers confidence. */
  inferred: boolean;
  missingData: string[];
}
