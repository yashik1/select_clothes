/**
 * Seeds a realistic demo wardrobe so the app can be evaluated without spending
 * an hour photographing clothes. Run with `npm run seed`.
 *
 * The measurements here are deliberately ordinary and deliberately imperfect —
 * a couple of items genuinely don't fit, because a demo where everything scores
 * 90 tells you nothing about whether the engine works.
 */
import {
  newId, nowIso, saveGarment, saveProfile, logWear, getOrCreateProfile, listGarments, pool, ready,
} from "../src/lib/db.ts";
import type { Garment, Profile } from "../src/lib/types.ts";

const now = nowIso();

const profileFields = {
  name: "Sam",
  unit: "cm",
  measurements: {
    height: 174,
    chest: 98,
    waistNatural: 84,
    waistWorn: 86,
    hip: 100,
    shoulderWidth: 45,
    neck: 39,
    armLength: 62,
    inseam: 79,
    thigh: 57,
    torsoLength: 44,
    riseFront: 27,
  },
  coloring: {
    skinDepth: 4,
    undertone: "cool",
    hairHex: "#2e2419",
    eyeHex: "#4a5f6e",
    seasonOverride: null,
  },
  fitPreferences: { top: "regular", bottom: "regular", outerwear: "regular" },
  bodyShapeOverride: null,
  locationLat: 51.5072,
  locationLon: -0.1276,
  locationLabel: "London, England, United Kingdom",
  styleNotes: "Building toward a smaller, sharper wardrobe. No logos.",
  bodyPhotoIds: [],
  createdAt: now,
  updatedAt: now,
} satisfies Partial<Profile>;

type Seed = Omit<Garment, "id" | "createdAt" | "updatedAt" | "wearCount" | "lastWornAt" | "archivedAt">;

const items: Seed[] = [
  {
    name: "White oxford shirt",
    category: "top", subcategory: "oxford-shirt", brand: "Uniqlo",
    size: "M", sizeSystem: "alpha-mens",
    colors: [{ hex: "#f2f0ea", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cotton: 1 }, gsm: 140, formality: 3, fitIntent: "regular",
    measurements: { chestFlat: 55, waistFlat: 53, shoulderFlat: 46, sleeveLength: 62, bodyLength: 74 },
    seasons: ["spring", "autumn", "winter"], careState: "clean",
    pricePaid: 40, currency: "GBP", imageIds: [], rating: 5,
  },
  {
    name: "Navy merino crewneck",
    category: "top", subcategory: "sweater", brand: "John Smedley",
    size: "M", sizeSystem: "alpha-mens",
    colors: [{ hex: "#26304a", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { merino: 1 }, gsm: 210, formality: 3, fitIntent: "regular",
    measurements: { chestFlat: 53, shoulderFlat: 45.5, sleeveLength: 62, bodyLength: 68 },
    seasons: ["autumn", "winter"], careState: "clean",
    pricePaid: 150, currency: "GBP", imageIds: [], rating: 5,
  },
  {
    name: "Black t-shirt",
    category: "top", subcategory: "t-shirt", brand: "COS",
    size: "M", sizeSystem: "alpha-mens",
    colors: [{ hex: "#1b1b1d", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cotton: 1 }, gsm: 200, formality: 1, fitIntent: "regular",
    measurements: { chestFlat: 52, shoulderFlat: 45, bodyLength: 70 },
    seasons: ["spring", "summer", "autumn"], careState: "clean",
    pricePaid: 25, currency: "GBP", imageIds: [], rating: 4,
  },
  {
    name: "Striped long-sleeve tee",
    category: "top", subcategory: "long-sleeve-tee", brand: "Armor Lux",
    size: "M", sizeSystem: "alpha-mens",
    colors: [{ hex: "#e8e6df", share: 0.6 }, { hex: "#2a3f63", share: 0.4 }],
    pattern: "stripe", patternScale: "medium",
    fabric: { cotton: 1 }, gsm: 230, formality: 2, fitIntent: "regular",
    measurements: { chestFlat: 53, sleeveLength: 62, bodyLength: 70 },
    seasons: ["spring", "autumn"], careState: "clean",
    pricePaid: 70, currency: "GBP", imageIds: [], rating: 4,
  },
  {
    // Deliberately too small — the fit engine should catch this.
    name: "Burgundy slim shirt",
    category: "top", subcategory: "dress-shirt", brand: "Zara",
    size: "S", sizeSystem: "alpha-mens",
    colors: [{ hex: "#6b2534", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cotton: 1 }, gsm: 120, formality: 4, fitIntent: "slim",
    measurements: { chestFlat: 50, waistFlat: 46, shoulderFlat: 43, sleeveLength: 63, bodyLength: 76 },
    seasons: ["autumn", "winter"], careState: "clean",
    pricePaid: 30, currency: "GBP", imageIds: [], rating: 2,
    notes: "Bought online without checking. Never quite right.",
  },
  {
    name: "Grey marl hoodie",
    category: "top", subcategory: "hoodie", brand: "Sunspel",
    size: "L", sizeSystem: "alpha-mens",
    colors: [{ hex: "#8c8f94", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cotton: 1 }, gsm: 380, formality: 1, fitIntent: "relaxed",
    measurements: { chestFlat: 60, shoulderFlat: 50, sleeveLength: 63, bodyLength: 70 },
    seasons: ["autumn", "winter", "spring"], careState: "laundry",
    pricePaid: 110, currency: "GBP", imageIds: [], rating: 4,
  },

  {
    name: "Mid-wash straight jeans",
    category: "bottom", subcategory: "jeans", brand: "Levi's",
    size: "34x31", sizeSystem: "waist-inseam",
    colors: [{ hex: "#4d647f", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cotton: 0.99, elastane: 0.01 }, gsm: 400, formality: 2, fitIntent: "regular",
    measurements: { waistFlat: 44, hipFlat: 54, thighFlat: 31, inseam: 79, rise: 28, legOpeningFlat: 18 },
    seasons: ["spring", "autumn", "winter"], careState: "clean",
    pricePaid: 90, currency: "GBP", imageIds: [], rating: 5,
  },
  {
    name: "Dark indigo jeans",
    category: "bottom", subcategory: "jeans", brand: "APC",
    size: "33x31", sizeSystem: "waist-inseam",
    colors: [{ hex: "#232f42", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cotton: 1 }, gsm: 430, formality: 3, fitIntent: "slim",
    measurements: { waistFlat: 43, hipFlat: 52, thighFlat: 29, inseam: 79, rise: 26 },
    seasons: ["autumn", "winter"], careState: "clean",
    pricePaid: 165, currency: "GBP", imageIds: [], rating: 4,
  },
  {
    name: "Stone chinos",
    category: "bottom", subcategory: "chinos", brand: "Uniqlo",
    size: "34x31", sizeSystem: "waist-inseam",
    colors: [{ hex: "#b0a591", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cotton: 0.98, elastane: 0.02 }, gsm: 260, formality: 3, fitIntent: "regular",
    measurements: { waistFlat: 45, hipFlat: 55, thighFlat: 32, inseam: 78 },
    seasons: ["spring", "summer", "autumn"], careState: "clean",
    pricePaid: 35, currency: "GBP", imageIds: [], rating: 4,
  },
  {
    name: "Charcoal wool trousers",
    category: "bottom", subcategory: "dress-trousers", brand: "Suitsupply",
    size: "50", sizeSystem: "eu-mens",
    colors: [{ hex: "#3b3d42", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { wool: 0.98, elastane: 0.02 }, gsm: 280, formality: 4, fitIntent: "regular",
    measurements: { waistFlat: 45, hipFlat: 56, thighFlat: 33, inseam: 80 },
    seasons: ["autumn", "winter"], careState: "clean",
    pricePaid: 140, currency: "GBP", imageIds: [], rating: 4,
  },

  {
    name: "Navy unstructured blazer",
    category: "outerwear", subcategory: "blazer", brand: "Suitsupply",
    size: "50", sizeSystem: "eu-mens",
    colors: [{ hex: "#2b3348", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { wool: 0.96, elastane: 0.04 }, gsm: 300, formality: 4, fitIntent: "regular",
    measurements: { chestFlat: 55, waistFlat: 52, shoulderFlat: 46, sleeveLength: 61, bodyLength: 74 },
    seasons: ["spring", "autumn", "winter"], careState: "clean",
    pricePaid: 320, currency: "GBP", imageIds: [], rating: 5,
  },
  {
    name: "Camel wool overcoat",
    category: "outerwear", subcategory: "wool-coat", brand: "Arket",
    size: "M", sizeSystem: "alpha-mens",
    colors: [{ hex: "#a08258", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { wool: 0.8, polyester: 0.2 }, gsm: 480, formality: 4, fitIntent: "regular",
    measurements: { chestFlat: 62, shoulderFlat: 50, sleeveLength: 64 },
    seasons: ["autumn", "winter"], careState: "clean",
    pricePaid: 250, currency: "GBP", imageIds: [], rating: 5,
  },
  {
    name: "Olive rain shell",
    category: "outerwear", subcategory: "rain-shell", brand: "Rains",
    size: "M", sizeSystem: "alpha-unisex",
    colors: [{ hex: "#4a5343", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { polyester: 0.7, nylon: 0.3 }, formality: 1, fitIntent: "relaxed",
    measurements: { chestFlat: 61, sleeveLength: 64 },
    seasons: ["spring", "autumn", "winter"], careState: "clean",
    pricePaid: 95, currency: "GBP", imageIds: [], rating: 3,
  },
  {
    name: "Black leather jacket",
    category: "outerwear", subcategory: "leather-jacket", brand: "Schott",
    size: "M", sizeSystem: "alpha-mens",
    colors: [{ hex: "#171719", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { leather: 1 }, formality: 3, fitIntent: "regular",
    measurements: { chestFlat: 55, shoulderFlat: 46, sleeveLength: 61 },
    seasons: ["spring", "autumn"], careState: "clean",
    pricePaid: 600, currency: "GBP", imageIds: [], rating: 5,
  },

  {
    name: "White leather sneakers",
    category: "shoes", subcategory: "minimal-sneakers", brand: "Common Projects",
    size: "42", sizeSystem: "free",
    colors: [{ hex: "#eae7e0", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { leather: 1 }, formality: 2, fitIntent: "regular",
    measurements: {}, seasons: ["spring", "summer", "autumn"], careState: "clean",
    pricePaid: 340, currency: "GBP", imageIds: [], rating: 4,
  },
  {
    name: "Brown suede chelsea boots",
    category: "shoes", subcategory: "chelsea-boots", brand: "Loake",
    size: "42", sizeSystem: "free",
    colors: [{ hex: "#6b4c34", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { leather: 1 }, formality: 3, fitIntent: "regular",
    measurements: {}, seasons: ["autumn", "winter"], careState: "clean",
    pricePaid: 210, currency: "GBP", imageIds: [], rating: 5,
  },
  {
    name: "Black oxfords",
    category: "shoes", subcategory: "oxfords", brand: "Loake",
    size: "42", sizeSystem: "free",
    colors: [{ hex: "#141416", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { leather: 1 }, formality: 5, fitIntent: "regular",
    measurements: {}, seasons: ["autumn", "winter", "spring"], careState: "clean",
    pricePaid: 230, currency: "GBP", imageIds: [], rating: 3,
  },
  {
    name: "Running trainers",
    category: "shoes", subcategory: "sneakers", brand: "Nike",
    size: "42", sizeSystem: "free",
    colors: [{ hex: "#3d4a63", share: 0.7 }, { hex: "#d8b64a", share: 0.3 }],
    pattern: "solid", patternScale: "none",
    fabric: { polyester: 0.8, nylon: 0.2 }, formality: 1, fitIntent: "regular",
    measurements: {}, seasons: ["spring", "summer", "autumn", "winter"], careState: "clean",
    pricePaid: 120, currency: "GBP", imageIds: [], rating: 3,
  },

  {
    name: "Brown leather belt",
    category: "accessory", subcategory: "belt", brand: "Anderson's",
    size: "90", sizeSystem: "free",
    colors: [{ hex: "#6a4a32", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { leather: 1 }, formality: 3, fitIntent: "regular",
    measurements: {}, seasons: [], careState: "clean",
    pricePaid: 80, currency: "GBP", imageIds: [], rating: 4,
  },
  {
    name: "Charcoal wool scarf",
    category: "accessory", subcategory: "scarf", brand: "Begg",
    sizeSystem: "free",
    colors: [{ hex: "#4a4d52", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cashmere: 1 }, formality: 3, fitIntent: "regular",
    measurements: {}, seasons: ["autumn", "winter"], careState: "clean",
    pricePaid: 130, currency: "GBP", imageIds: [], rating: 5,
  },
  {
    // Never worn, nothing pairs with it — should surface in Insights.
    name: "Mustard corduroy overshirt",
    category: "top", subcategory: "flannel-shirt", brand: "Portuguese Flannel",
    size: "M", sizeSystem: "alpha-mens",
    colors: [{ hex: "#b58525", share: 1 }], pattern: "solid", patternScale: "none",
    fabric: { cotton: 1 }, gsm: 320, formality: 2, fitIntent: "relaxed",
    measurements: { chestFlat: 57, shoulderFlat: 47, sleeveLength: 63, bodyLength: 74 },
    seasons: ["autumn", "winter"], careState: "clean",
    pricePaid: 120, currency: "GBP", imageIds: [], rating: 2,
    notes: "Impulse buy in a sale. Have never found anything to wear it with.",
  },
];

/**
 * Wipes the wardrobe first, so re-running gives the same 21 items rather than
 * a second copy of them. That is destructive, and DATABASE_URL may well be
 * pointing at the deployed database — so an existing wardrobe has to be
 * overwritten deliberately.
 */
async function reset(force: boolean) {
  await ready();
  const existing = await listGarments({ includeArchived: true });
  if (existing.length && !force) {
    console.error(
      `Refusing to seed: this database already holds ${existing.length} garments.\n` +
        `Re-run with --force to replace them.\n` +
        `  DATABASE_URL=${(process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@")}`,
    );
    process.exit(1);
  }
  await pool().query(
    "TRUNCATE garment, wear_log, fit_feedback, brand_calibration, outfit, image, profile",
  );
}

async function seed() {
  await reset(process.argv.includes("--force"));

  await saveProfile({ ...(await getOrCreateProfile()), ...profileFields });

  const created: Garment[] = [];
  for (const item of items) {
    const g: Garment = {
      ...item,
      id: newId(),
      wearCount: 0,
      lastWornAt: null,
      archivedAt: null,
      createdAt: new Date(Date.now() - 200 * 86400000).toISOString(),
      updatedAt: now,
    };
    await saveGarment(g);
    created.push(g);
  }

  const find = (name: string) => created.find((g) => g.name === name)!;

  // A month of plausible history so rotation and cost-per-wear have something
  // to work with straight away.
  const history: [number, string[]][] = [
    [2, ["White oxford shirt", "Mid-wash straight jeans", "White leather sneakers"]],
    [4, ["Navy merino crewneck", "Charcoal wool trousers", "Brown suede chelsea boots"]],
    [6, ["Black t-shirt", "Mid-wash straight jeans", "Black leather jacket", "White leather sneakers"]],
    [9, ["White oxford shirt", "Charcoal wool trousers", "Navy unstructured blazer", "Black oxfords"]],
    [11, ["Striped long-sleeve tee", "Dark indigo jeans", "White leather sneakers"]],
    [14, ["Navy merino crewneck", "Dark indigo jeans", "Camel wool overcoat", "Brown suede chelsea boots"]],
    [18, ["White oxford shirt", "Stone chinos", "White leather sneakers"]],
    [21, ["Black t-shirt", "Mid-wash straight jeans", "Running trainers"]],
    [25, ["Navy merino crewneck", "Charcoal wool trousers", "Navy unstructured blazer", "Black oxfords"]],
    [30, ["Striped long-sleeve tee", "Stone chinos", "White leather sneakers"]],
  ];

  for (const [daysAgo, names] of history) {
    await logWear({
      id: newId(),
      date: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      garmentIds: names.map((n) => find(n).id),
      outfitId: null,
      occasion: daysAgo % 3 === 0 ? "office" : "casual-social",
      createdAt: now,
    });
  }

  console.log(`Seeded ${created.length} garments, ${history.length} logged wears, and one profile.`);
  console.log("Run `npm run dev` and open http://localhost:3000");
}

seed()
  .then(() => pool().end())
  .catch(async (err) => {
    console.error(err);
    await pool().end().catch(() => {});
    process.exit(1);
  });
