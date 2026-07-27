import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  deltaEHex, describeColor, hexToLch, hueDistance, lchToHex, isNeutral,
} from "../src/lib/color/space.ts";
import { deriveSeason, matchColorToSeason, SEASONS } from "../src/lib/color/palette.ts";
import { fabricStretch, fabricWarmthMultiplier } from "../src/lib/data/fabrics.ts";
import { bodyForSize, suggestSize, adjacentSize } from "../src/lib/data/sizeCharts.ts";
import { evaluateGarmentFit } from "../src/lib/engine/fit.ts";
import { deriveBodyShape } from "../src/lib/engine/bodyShape.ts";
import { scoreFormality, outfitFormality } from "../src/lib/engine/formality.ts";
import { outfitClo, neutralTemp, scoreWeather } from "../src/lib/engine/weather.ts";
import { scoreOutfit } from "../src/lib/engine/index.ts";
import { computeCalibrations } from "../src/lib/engine/calibration.ts";
import { findOutfits } from "../src/lib/engine/combos.ts";
import { planPacking } from "../src/lib/engine/packing.ts";
import type { Garment, Profile } from "../src/lib/types.ts";

/* ------------------------------------------------------------- fixtures -- */

const profile: Profile = {
  id: "test",
  name: "Test",
  unit: "cm",
  measurements: {
    height: 175, chest: 100, waistNatural: 85, waistWorn: 86, hip: 100,
    shoulderWidth: 45, neck: 39, armLength: 62, inseam: 80, thigh: 57, torsoLength: 44,
  },
  coloring: { skinDepth: 3, undertone: "cool", hairHex: "#1c1a19", eyeHex: "#3b5c74" },
  fitPreferences: {},
  bodyPhotoIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function garment(over: Partial<Garment> = {}): Garment {
  const now = new Date().toISOString();
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    name: "Item",
    category: "top",
    subcategory: "t-shirt",
    colors: [{ hex: "#333944", share: 1 }],
    pattern: "solid",
    patternScale: "none",
    fabric: { cotton: 1 },
    formality: 2,
    fitIntent: "regular",
    measurements: {},
    seasons: [],
    careState: "clean",
    imageIds: [],
    wearCount: 0,
    lastWornAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/* ---------------------------------------------------------- colour maths -- */

describe("colour space", () => {
  test("LCh round-trips through hex within a rounding step", () => {
    for (const hex of ["#c0392b", "#2b3348", "#f2f0ea", "#4a5343"]) {
      const back = lchToHex(hexToLch(hex));
      assert.ok(deltaEHex(hex, back) < 1.5, `${hex} -> ${back}`);
    }
  });

  test("identical colours have zero difference", () => {
    assert.equal(Math.round(deltaEHex("#3366cc", "#3366cc")), 0);
  });

  test("CIEDE2000 does not overstate differences between navies", () => {
    // The failure mode CIE76 has: navy vs charcoal reads as a clash.
    const navyVsCharcoal = deltaEHex("#26304a", "#3b3d42");
    const navyVsOrange = deltaEHex("#26304a", "#e07a2f");
    assert.ok(navyVsCharcoal < 15, `navy/charcoal was ${navyVsCharcoal}`);
    assert.ok(navyVsOrange > 40, `navy/orange was ${navyVsOrange}`);
  });

  test("hue distance wraps around the wheel", () => {
    assert.equal(hueDistance(350, 10), 20);
    assert.equal(hueDistance(10, 350), 20);
    assert.equal(hueDistance(0, 180), 180);
  });

  test("greys are neutral, saturated colours are not", () => {
    assert.ok(isNeutral("#808080"));
    assert.ok(isNeutral("#f2f0ea"));
    assert.ok(!isNeutral("#c0392b"));
  });

  test("colour names are recognisable", () => {
    assert.match(describeColor("#0b0b0d"), /black/);
    assert.match(describeColor("#2b3fa8"), /blue/);
    assert.match(describeColor("#f5f4f0"), /white/);
  });
});

describe("seasonal analysis", () => {
  test("deep cool colouring lands in a Winter season", () => {
    const s = deriveSeason({ skinDepth: 8, undertone: "cool", hairHex: "#141210", eyeHex: "#2a3b4c" });
    assert.match(s.season, /Winter/);
  });

  test("light warm colouring lands in a Spring season", () => {
    const s = deriveSeason({ skinDepth: 2, undertone: "warm", hairHex: "#c8a166", eyeHex: "#7ba05b" });
    assert.match(s.season, /Spring/);
  });

  test("confidence falls when the profile is incomplete", () => {
    const full = deriveSeason({ skinDepth: 5, undertone: "cool", hairHex: "#241d18", eyeHex: "#41607a" });
    const sparse = deriveSeason({ undertone: "cool" });
    assert.ok(sparse.confidence < full.confidence);
    assert.ok(sparse.missing.length >= 2);
  });

  test("an override pins the season and maxes confidence", () => {
    const s = deriveSeason({ skinDepth: 2, undertone: "warm", seasonOverride: "Deep Winter" });
    assert.equal(s.season, "Deep Winter");
    assert.equal(s.confidence, 1);
  });

  test("a colour in the band beats one outside it", () => {
    const band = SEASONS["True Winter"];
    const inPalette = matchColorToSeason("#1b3a6b", band).score;
    const outOfPalette = matchColorToSeason("#d9a441", band).score;
    assert.ok(inPalette > outOfPalette + 15, `${inPalette} vs ${outOfPalette}`);
  });
});

/* ----------------------------------------------------------------- fabric -- */

describe("fabric properties", () => {
  test("elastane adds stretch on a steep early curve", () => {
    const rigid = fabricStretch({ cotton: 1 }, false);
    const two = fabricStretch({ cotton: 0.98, elastane: 0.02 }, false);
    const twenty = fabricStretch({ cotton: 0.8, elastane: 0.2 }, false);
    assert.ok(two > rigid + 0.06, "2% elastane should be a meaningful jump");
    assert.ok(twenty - two < two - rigid + 0.15, "returns should diminish");
  });

  test("knits stretch more than wovens of the same fibre", () => {
    assert.ok(fabricStretch({ cotton: 1 }, true) > fabricStretch({ cotton: 1 }, false));
  });

  test("wool is warmer than linen", () => {
    assert.ok(fabricWarmthMultiplier({ wool: 1 }) > fabricWarmthMultiplier({ linen: 1 }));
  });
});

/* ------------------------------------------------------------- size charts -- */

describe("size charts", () => {
  test("alpha sizes resolve to the body they're cut for", () => {
    const m = bodyForSize("alpha-mens", "M", "top");
    assert.equal(m?.chest, 100);
  });

  test("waist-inseam labels parse in both separators", () => {
    const a = bodyForSize("waist-inseam", "32x32", "bottom");
    const b = bodyForSize("waist-inseam", "32/32", "bottom");
    assert.ok(a && b);
    assert.ok(Math.abs(a!.waistNatural! - 81.28) < 0.01);
    assert.equal(Math.round(a!.inseam!), Math.round(b!.inseam!));
  });

  test("unparseable labels return null rather than throwing", () => {
    assert.equal(bodyForSize("alpha-mens", "banana", "top"), null);
    assert.equal(bodyForSize(undefined, "M", "top"), null);
  });

  test("size suggestion picks the smallest size with room", () => {
    const s = suggestSize("alpha-mens", { chest: 99 }, "top");
    assert.equal(s?.size, "M");
  });

  test("adjacent sizes walk the chart", () => {
    assert.equal(adjacentSize("alpha-mens", "M", 1), "L");
    assert.equal(adjacentSize("alpha-mens", "M", -1), "S");
    assert.equal(adjacentSize("alpha-mens", "3XL", 1), null);
  });
});

/* --------------------------------------------------------------- fit engine -- */

describe("fit engine", () => {
  test("a shirt narrower than the wearer is called too tight", () => {
    // 45cm flat = 90cm round, on a 100cm chest.
    const g = garment({
      subcategory: "oxford-shirt",
      measurements: { chestFlat: 45 },
    });
    const r = evaluateGarmentFit(g, profile);
    const chest = r.findings.find((f) => f.landmark === "chestFlat")!;
    assert.equal(chest.verdict, "too-tight");
    assert.ok(chest.score < 40);
    assert.match(chest.advice ?? "", /tight|size|open/i);
  });

  test("a correctly sized shirt is ideal at the chest", () => {
    const g = garment({ subcategory: "oxford-shirt", measurements: { chestFlat: 56 } });
    const chest = evaluateGarmentFit(g, profile).findings.find((f) => f.landmark === "chestFlat")!;
    assert.equal(chest.verdict, "ideal");
    assert.ok(chest.score > 90);
  });

  test("stretch beyond the fabric the band assumes buys real room", () => {
    const base = { subcategory: "oxford-shirt" as const, measurements: { chestFlat: 52 } };
    const rigid = evaluateGarmentFit(garment({ ...base, fabric: { cotton: 1 } }), profile);
    const stretchy = evaluateGarmentFit(
      garment({ ...base, fabric: { cotton: 0.95, elastane: 0.05 } }),
      profile,
    );
    const a = rigid.findings.find((f) => f.landmark === "chestFlat")!;
    const b = stretchy.findings.find((f) => f.landmark === "chestFlat")!;
    assert.ok(b.effectiveEaseCm > a.effectiveEaseCm + 3, "elastane should add comfort ease");
    assert.ok(b.score > a.score);
  });

  test("an ordinary jersey tee is not double-credited for being a knit", () => {
    // The knit baseline is already in the band; a plain cotton tee should get
    // effectively no stretch credit.
    const g = garment({ subcategory: "t-shirt", measurements: { chestFlat: 54 }, fabric: { cotton: 1 } });
    const f = evaluateGarmentFit(g, profile).findings.find((x) => x.landmark === "chestFlat")!;
    assert.ok(Math.abs(f.effectiveEaseCm - f.easeCm) < 1.5);
  });

  test("size labels alone produce a lower-confidence answer", () => {
    const measured = evaluateGarmentFit(
      garment({ subcategory: "oxford-shirt", measurements: { chestFlat: 56 } }),
      profile,
    );
    const inferred = evaluateGarmentFit(
      garment({ subcategory: "oxford-shirt", size: "M", sizeSystem: "alpha-mens" }),
      profile,
    );
    assert.ok(inferred.inferred);
    assert.ok(inferred.confidence < measured.confidence);
    assert.ok(inferred.findings.length > 0, "a size label should still yield findings");
  });

  test("a fit preference shifts the whole band", () => {
    const g = garment({ subcategory: "oxford-shirt", measurements: { chestFlat: 62 } });
    const regular = evaluateGarmentFit(g, profile);
    const oversized = evaluateGarmentFit(g, { ...profile, fitPreferences: { top: "oversized" } });
    const a = regular.findings.find((f) => f.landmark === "chestFlat")!;
    const b = oversized.findings.find((f) => f.landmark === "chestFlat")!;
    assert.ok(b.score > a.score, "someone who likes oversized shouldn't be told it's oversized");
  });

  test("shoulder seams that fall inside the shoulder are flagged as unfixable", () => {
    const g = garment({ subcategory: "blazer", category: "outerwear", measurements: { shoulderFlat: 41 } });
    const f = evaluateGarmentFit(g, profile).findings.find((x) => x.landmark === "shoulderFlat")!;
    assert.equal(f.verdict, "too-tight");
    assert.match(f.advice ?? "", /tailor cannot fix|wrong size/i);
  });

  test("trousers that are too short are caught on length", () => {
    const g = garment({
      category: "bottom", subcategory: "jeans",
      measurements: { waistFlat: 44, hipFlat: 55, inseam: 70 },
    });
    const f = evaluateGarmentFit(g, profile).findings.find((x) => x.landmark === "inseam")!;
    assert.ok(f.score < 70);
  });

  test("missing body data is reported rather than silently assumed", () => {
    const bare: Profile = { ...profile, measurements: { chest: 100 } };
    const g = garment({ category: "bottom", subcategory: "jeans", measurements: { waistFlat: 44 } });
    const r = evaluateGarmentFit(g, bare);
    assert.ok(r.missingData.length > 0);
  });

  test("the worst landmark dominates the garment score", () => {
    const good = garment({ subcategory: "oxford-shirt", measurements: { chestFlat: 56, waistFlat: 55, shoulderFlat: 45.5 } });
    const oneBad = garment({ subcategory: "oxford-shirt", measurements: { chestFlat: 56, waistFlat: 55, shoulderFlat: 40 } });
    assert.ok(evaluateGarmentFit(oneBad, profile).score < evaluateGarmentFit(good, profile).score - 20);
  });
});

/* -------------------------------------------------------------- body shape -- */

describe("body shape", () => {
  test("even bust and hip with a small waist reads hourglass", () => {
    const r = deriveBodyShape({ chest: 95, waistNatural: 68, hip: 96, height: 168, inseam: 78 });
    assert.equal(r.shape, "hourglass");
  });

  test("hips wider than bust reads pear", () => {
    const r = deriveBodyShape({ chest: 88, waistNatural: 74, hip: 104 });
    assert.equal(r.shape, "pear");
  });

  test("bust wider than hip reads inverted triangle", () => {
    const r = deriveBodyShape({ chest: 108, waistNatural: 88, hip: 96 });
    assert.equal(r.shape, "inverted-triangle");
  });

  test("straight through the middle reads rectangle", () => {
    const r = deriveBodyShape({ chest: 96, waistNatural: 88, hip: 97 });
    assert.ok(r.shape === "rectangle" || r.shape === "apple");
  });

  test("missing measurements yield unknown, not a guess", () => {
    const r = deriveBodyShape({ height: 175 });
    assert.equal(r.shape, "unknown");
    assert.equal(r.confidence, 0);
    assert.ok(r.missing.length >= 2);
  });

  test("an override wins and reports full confidence", () => {
    const r = deriveBodyShape({ chest: 88, waistNatural: 74, hip: 104 }, "apple");
    assert.equal(r.shape, "apple");
    assert.equal(r.confidence, 1);
  });

  test("leg-to-height ratio is described in words", () => {
    const short = deriveBodyShape({ chest: 96, waistNatural: 80, hip: 98, height: 180, inseam: 76 });
    assert.ok(short.notes.some((n) => /long torso/.test(n)));
  });
});

/* --------------------------------------------------------------- formality -- */

describe("formality", () => {
  test("a wide spread is penalised heavily", () => {
    const s = scoreFormality([
      garment({ name: "Suit jacket", category: "outerwear", subcategory: "suit-jacket", formality: 5 }),
      garment({ name: "Running trainers", category: "shoes", subcategory: "sneakers", formality: 1 }),
      garment({ name: "Dress trousers", category: "bottom", subcategory: "dress-trousers", formality: 4 }),
    ]);
    assert.ok(s.score < 70);
    assert.ok(s.reasons.some((r) => r.severity === "bad"));
  });

  test("a coherent outfit at the right level scores well", () => {
    const s = scoreFormality(
      [
        garment({ name: "Oxford", subcategory: "oxford-shirt", formality: 3 }),
        garment({ name: "Chinos", category: "bottom", subcategory: "chinos", formality: 3 }),
        garment({ name: "Loafers", category: "shoes", subcategory: "loafers", formality: 3 }),
      ],
      "smart-casual",
    );
    assert.ok(s.score > 85);
  });

  test("gym clothes to a black-tie event are called out", () => {
    const s = scoreFormality(
      [
        garment({ name: "Hoodie", subcategory: "hoodie", formality: 1 }),
        garment({ name: "Joggers", category: "bottom", subcategory: "joggers", formality: 1 }),
      ],
      "black-tie",
    );
    assert.ok(s.score < 40);
  });

  test("accessories don't drag the average around", () => {
    const core = [
      garment({ name: "Shirt", subcategory: "oxford-shirt", formality: 3 }),
      garment({ name: "Chinos", category: "bottom", subcategory: "chinos", formality: 3 }),
    ];
    const withBag = [...core, garment({ name: "Backpack", category: "bag", subcategory: "backpack", formality: 1 })];
    assert.ok(Math.abs(outfitFormality(core) - outfitFormality(withBag)) < 0.4);
  });
});

/* ----------------------------------------------------------------- weather -- */

describe("weather", () => {
  test("more layers means more insulation", () => {
    const tee = garment({ subcategory: "t-shirt" });
    const coat = garment({ category: "outerwear", subcategory: "wool-coat", fabric: { wool: 1 } });
    assert.ok(outfitClo([tee, coat]) > outfitClo([tee]));
  });

  test("layering has diminishing returns", () => {
    const sweater = () => garment({ subcategory: "sweater", fabric: { wool: 1 } });
    const one = outfitClo([sweater()]);
    const three = outfitClo([sweater(), sweater(), sweater()]);
    assert.ok(three < one * 3, "three sweaters should not be exactly three times as warm");
  });

  test("the clo-to-temperature mapping matches the standard reference points", () => {
    // 1 clo ~ a business suit, comfortable around 21°C.
    assert.ok(Math.abs(neutralTemp(1) - 21) < 1.5);
  });

  test("a t-shirt in the cold is flagged", () => {
    const s = scoreWeather([garment({ subcategory: "t-shirt" })], { tempC: 2, windKph: 5 });
    assert.ok(s.score < 45);
    assert.ok(s.reasons.some((r) => /cold/i.test(r.text)));
  });

  test("a winter coat in the heat is flagged the other way", () => {
    const s = scoreWeather(
      [garment({ category: "outerwear", subcategory: "puffer", fabric: { down: 1, nylon: 0.2 } })],
      { tempC: 28 },
    );
    assert.ok(s.score < 50);
    assert.ok(s.reasons.some((r) => /warm/i.test(r.text)));
  });

  test("rain without a shell is called out", () => {
    const s = scoreWeather(
      [garment({ subcategory: "sweater" }), garment({ category: "outerwear", subcategory: "blazer" })],
      { tempC: 12, precipitationMm: 5 },
    );
    assert.ok(s.reasons.some((r) => /rain/i.test(r.text)));
  });

  test("no forecast means zero confidence, not a made-up score", () => {
    const s = scoreWeather([garment()], undefined);
    assert.equal(s.confidence, 0);
    assert.ok((s.missingData ?? []).length > 0);
  });
});

/* --------------------------------------------------------------- composite -- */

describe("composite scoring", () => {
  const top = garment({ name: "Oxford", subcategory: "oxford-shirt", formality: 3, measurements: { chestFlat: 56, shoulderFlat: 45.5, sleeveLength: 62 }, colors: [{ hex: "#f2f0ea", share: 1 }] });
  const bottom = garment({ name: "Chinos", category: "bottom", subcategory: "chinos", formality: 3, measurements: { waistFlat: 45, hipFlat: 55, inseam: 80 }, colors: [{ hex: "#3b4253", share: 1 }] });
  const shoes = garment({ name: "Loafers", category: "shoes", subcategory: "loafers", formality: 3, colors: [{ hex: "#4a3527", share: 1 }] });

  test("a sound outfit is recommended", () => {
    const s = scoreOutfit([top, bottom, shoes], profile, { occasion: "smart-casual" });
    assert.ok(s.total >= 70, `scored ${s.total}`);
    assert.notEqual(s.verdict, "skip");
    assert.ok(s.headline.length > 0);
  });

  test("a missing bottom half blocks the outfit outright", () => {
    const s = scoreOutfit([top, shoes], profile, {});
    assert.equal(s.verdict, "skip");
    assert.ok(s.total <= 30);
    assert.match(s.headline, /bottom half/i);
  });

  test("a garment that doesn't fit caps the total no matter what else is right", () => {
    const tooSmall = garment({ name: "Tight shirt", subcategory: "oxford-shirt", formality: 3, measurements: { chestFlat: 43, shoulderFlat: 40 }, colors: [{ hex: "#f2f0ea", share: 1 }] });
    const s = scoreOutfit([tooSmall, bottom, shoes], profile, { occasion: "smart-casual" });
    assert.ok(s.total <= 55, `scored ${s.total}`);
  });

  test("every dimension is reported with a confidence", () => {
    const s = scoreOutfit([top, bottom, shoes], profile, {});
    assert.equal(s.dimensions.length, 6);
    for (const d of s.dimensions) {
      assert.ok(d.confidence >= 0 && d.confidence <= 1, `${d.key} confidence out of range`);
      assert.ok(d.score >= 0 && d.score <= 100, `${d.key} score out of range`);
    }
  });

  test("fixes come with actions, not just complaints", () => {
    const clashing = garment({ name: "Orange tee", subcategory: "t-shirt", formality: 1, colors: [{ hex: "#e0761f", share: 1 }] });
    const green = garment({ name: "Green trousers", category: "bottom", subcategory: "chinos", formality: 2, colors: [{ hex: "#57892f", share: 1 }] });
    const s = scoreOutfit([clashing, green, shoes], profile, { occasion: "office" });
    assert.ok(s.topFixes.length > 0);
    for (const f of s.topFixes) assert.ok(f.fix && f.fix.length > 0);
  });

  test("scoring is deterministic", () => {
    const a = scoreOutfit([top, bottom, shoes], profile, { occasion: "office" });
    const b = scoreOutfit([top, bottom, shoes], profile, { occasion: "office" });
    assert.equal(a.total, b.total);
  });
});

/* ------------------------------------------------------------- calibration -- */

describe("brand calibration", () => {
  test("repeated 'too tight' answers teach that a brand runs small", () => {
    const g = garment({
      id: "g1", brand: "Zara", subcategory: "oxford-shirt",
      measurements: { chestFlat: 56, shoulderFlat: 45.5 },
    });
    const feedback = [1, 2, 3].map((n) => ({
      id: `f${n}`,
      garmentId: "g1",
      landmark: "chestFlat" as const,
      verdict: "too-tight" as const,
      createdAt: new Date().toISOString(),
    }));

    const [c] = computeCalibrations(feedback, [g], profile);
    assert.ok(c, "a calibration should be produced");
    assert.ok(c.easeBiasCm < -2, `expected a negative bias, got ${c.easeBiasCm}`);
    assert.equal(c.sampleCount, 3);
  });

  test("a single answer moves the bias less than several", () => {
    const g = garment({ id: "g1", brand: "Zara", subcategory: "oxford-shirt", measurements: { chestFlat: 56 } });
    const one = computeCalibrations(
      [{ id: "f1", garmentId: "g1", landmark: "chestFlat", verdict: "too-tight", createdAt: "" }],
      [g], profile,
    )[0];
    const many = computeCalibrations(
      [1, 2, 3, 4, 5].map((n) => ({ id: `f${n}`, garmentId: "g1", landmark: "chestFlat" as const, verdict: "too-tight" as const, createdAt: "" })),
      [g], profile,
    )[0];
    assert.ok(Math.abs(one.easeBiasCm) < Math.abs(many.easeBiasCm));
  });

  test("calibration feeds back into the fit verdict", () => {
    const g = garment({ brand: "Zara", subcategory: "oxford-shirt", measurements: { chestFlat: 53 } });
    const before = evaluateGarmentFit(g, profile);
    const after = evaluateGarmentFit(g, profile, [
      { brand: "zara", category: "top", easeBiasCm: -8, sampleCount: 4, updatedAt: "" },
    ]);
    assert.ok(after.score < before.score, "a brand known to run small should lower the score");
  });

  test("garments with no brand are ignored", () => {
    const g = garment({ id: "g1", subcategory: "oxford-shirt", measurements: { chestFlat: 56 } });
    const out = computeCalibrations(
      [{ id: "f1", garmentId: "g1", landmark: "chestFlat", verdict: "too-tight", createdAt: "" }],
      [g], profile,
    );
    assert.equal(out.length, 0);
  });
});

/* ----------------------------------------------------------- outfit search -- */

describe("outfit search", () => {
  const wardrobe = [
    garment({ name: "Oxford", subcategory: "oxford-shirt", formality: 3, measurements: { chestFlat: 56 }, colors: [{ hex: "#f2f0ea", share: 1 }] }),
    garment({ name: "Tee", subcategory: "t-shirt", formality: 1, measurements: { chestFlat: 54 }, colors: [{ hex: "#1b1b1d", share: 1 }] }),
    garment({ name: "Chinos", category: "bottom", subcategory: "chinos", formality: 3, measurements: { waistFlat: 45, inseam: 80 }, colors: [{ hex: "#3b4253", share: 1 }] }),
    garment({ name: "Jeans", category: "bottom", subcategory: "jeans", formality: 2, measurements: { waistFlat: 44, inseam: 80 }, colors: [{ hex: "#4d647f", share: 1 }] }),
    garment({ name: "Loafers", category: "shoes", subcategory: "loafers", formality: 3, colors: [{ hex: "#4a3527", share: 1 }] }),
    garment({ name: "Sneakers", category: "shoes", subcategory: "minimal-sneakers", formality: 2, colors: [{ hex: "#eae7e0", share: 1 }] }),
  ];

  test("returns complete, scored outfits", () => {
    const found = findOutfits(wardrobe, profile, {}, { occasion: "smart-casual", limit: 5 });
    assert.ok(found.length > 0);
    for (const f of found) {
      assert.ok(f.garments.some((g) => g.category === "bottom"));
      assert.ok(f.garments.some((g) => g.category === "top"));
      assert.ok(f.score.total > 0);
    }
  });

  test("results are ordered best first", () => {
    const found = findOutfits(wardrobe, profile, {}, { limit: 6 });
    for (let i = 1; i < found.length; i++) {
      assert.ok(found[i - 1].score.total >= found[i].score.total);
    }
  });

  test("items in the wash are excluded by default", () => {
    const dirty = wardrobe.map((g) => (g.name === "Chinos" ? { ...g, careState: "laundry" as const } : g));
    const found = findOutfits(dirty, profile, {}, { limit: 8 });
    assert.ok(found.every((f) => !f.garments.some((g) => g.name === "Chinos")));
  });

  test("a pinned item appears in every result", () => {
    const jeans = wardrobe.find((g) => g.name === "Jeans")!;
    const found = findOutfits(wardrobe, profile, {}, { mustInclude: [jeans.id], limit: 5 });
    assert.ok(found.length > 0);
    assert.ok(found.every((f) => f.garments.some((g) => g.id === jeans.id)));
  });

  test("results are meaningfully different from each other", () => {
    const found = findOutfits(wardrobe, profile, {}, { limit: 5 });
    const keys = found.map((f) => f.garments.map((g) => g.id).sort().join("|"));
    assert.equal(new Set(keys).size, keys.length);
  });

  test("an empty wardrobe returns nothing rather than throwing", () => {
    assert.deepEqual(findOutfits([], profile, {}, {}), []);
  });
});

/* -------------------------------------------------------------- packing -- */

describe("packing", () => {
  const wardrobe = [
    garment({ name: "Oxford", subcategory: "oxford-shirt", formality: 3, measurements: { chestFlat: 56 }, colors: [{ hex: "#f2f0ea", share: 1 }] }),
    garment({ name: "Knit", subcategory: "crew-sweater", formality: 3, measurements: { chestFlat: 56 }, fabric: { wool: 1 }, colors: [{ hex: "#26303f", share: 1 }] }),
    garment({ name: "Tee", subcategory: "t-shirt", formality: 1, measurements: { chestFlat: 54 }, colors: [{ hex: "#1b1b1d", share: 1 }] }),
    garment({ name: "Chinos", category: "bottom", subcategory: "chinos", formality: 3, measurements: { waistFlat: 45, inseam: 80 }, colors: [{ hex: "#3b4253", share: 1 }] }),
    garment({ name: "Jeans", category: "bottom", subcategory: "jeans", formality: 2, measurements: { waistFlat: 44, inseam: 80 }, colors: [{ hex: "#4d647f", share: 1 }] }),
    garment({ name: "Loafers", category: "shoes", subcategory: "loafers", formality: 3, colors: [{ hex: "#4a3527", share: 1 }] }),
    garment({ name: "Sneakers", category: "shoes", subcategory: "minimal-sneakers", formality: 2, colors: [{ hex: "#eae7e0", share: 1 }] }),
  ];

  const trip = {
    days: 4,
    itinerary: ["office", "casual-social", "office", "smart-casual"] as const,
    tempLowC: 12,
    tempHighC: 22,
    rain: false,
    maxItems: 10,
  };

  /**
   * The regression that motivated these: selection used to advance one garment
   * at a time, but a day is only covered once a whole outfit is present — so
   * marginal gain was zero on the first step and the planner returned nothing
   * at all, for every possible trip.
   */
  test("covers the itinerary rather than returning nothing", () => {
    const plan = planPacking(wardrobe, profile, { ...trip, itinerary: [...trip.itinerary] });
    assert.ok(plan.items.length > 0, "packed nothing");
    assert.equal(plan.outfits.length, trip.days);
    assert.equal(plan.uncovered.length, 0);
  });

  test("every assigned outfit is built only from packed items", () => {
    const plan = planPacking(wardrobe, profile, { ...trip, itinerary: [...trip.itinerary] });
    const packed = new Set(plan.items.map((i) => i.id));
    for (const o of plan.outfits) {
      for (const g of o.garments) assert.ok(packed.has(g.id), `${g.name} was never packed`);
    }
  });

  test("never exceeds the item cap", () => {
    for (const maxItems of [3, 4, 6, 10]) {
      const plan = planPacking(wardrobe, profile, { ...trip, itinerary: [...trip.itinerary], maxItems });
      assert.ok(plan.items.length <= maxItems, `packed ${plan.items.length} with a cap of ${maxItems}`);
      assert.equal(plan.outfits.length + plan.uncovered.length, trip.days);
    }
  });

  test("says so when the cap makes the trip uncoverable", () => {
    // Two items cannot complete an outfit, so the shortfall has to be reported
    // rather than quietly returning a plan that doesn't work.
    const plan = planPacking(wardrobe, profile, { ...trip, itinerary: [...trip.itinerary], maxItems: 2 });
    assert.equal(plan.uncovered.length, trip.days);
    assert.ok(plan.notes.some((n) => n.includes("couldn't be covered")));
  });

  test("spends spare capacity on variety instead of repeating one outfit", () => {
    const plan = planPacking(wardrobe, profile, { ...trip, itinerary: [...trip.itinerary] });
    const distinct = new Set(plan.outfits.map((o) => o.garments.map((g) => g.id).sort().join("|")));
    assert.ok(distinct.size > 1, "packed the same outfit for every day of the trip");
  });

  test("an empty wardrobe returns an empty plan rather than throwing", () => {
    const plan = planPacking([], profile, { ...trip, itinerary: [...trip.itinerary] });
    assert.deepEqual(plan.items, []);
    assert.equal(plan.uncovered.length, trip.days);
  });
});
