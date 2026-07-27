/**
 * Silhouette and proportion.
 *
 * Colour gets all the attention, but proportion is what separates an outfit
 * that looks considered from one that looks like it happened by accident. The
 * rules here are geometric: where volume sits, where the eye is asked to stop,
 * and how that lands on this particular set of measurements.
 */
import { subcategoryDef, type HemPosition } from "../data/garmentTypes";
import type { FitPreference, Garment, Profile, Reason, SubScore } from "../types";
import { SHAPE_STRATEGY, analyseProfile } from "./bodyShape";

const INTENT_VOLUME: Record<FitPreference, number> = {
  slim: -1,
  regular: 0,
  relaxed: 0.6,
  oversized: 1.6,
};

/** 1 (skin-close) to 5 (very voluminous) for one garment as actually cut. */
export function garmentVolume(g: Garment): number {
  const def = subcategoryDef(g.subcategory, g.category);
  return Math.max(1, Math.min(5, def.volume + INTENT_VOLUME[g.fitIntent]));
}

const HEM_HEIGHT: Record<HemPosition, number> = {
  crop: 0.62,
  waist: 0.58,
  hip: 0.5,
  "mid-thigh": 0.42,
  knee: 0.3,
  midi: 0.22,
  ankle: 0.06,
  floor: 0.0,
};

export function scoreProportion(garments: Garment[], profile: Profile): SubScore {
  const reasons: Reason[] = [];
  const missingData: string[] = [];
  const body = analyseProfile(profile);

  const tops = garments.filter((g) => g.category === "top");
  const bottoms = garments.filter((g) => g.category === "bottom");
  const dresses = garments.filter((g) => g.category === "dress");
  const outers = garments.filter((g) => g.category === "outerwear");
  const shoes = garments.filter((g) => g.category === "shoes");

  if (tops.length + bottoms.length + dresses.length === 0) {
    return {
      key: "proportion", label: "Proportion", score: 70, confidence: 0.1,
      weight: 1, reasons: [], missingData: ["a top and bottom, or a dress"],
    };
  }

  let score = 82;

  /* ------------------------------------------------- volume balance -- */
  const topVol = tops.length ? Math.max(...tops.map(garmentVolume)) : null;
  const bottomVol = bottoms.length ? Math.max(...bottoms.map(garmentVolume)) : null;

  if (topVol !== null && bottomVol !== null) {
    const spread = Math.abs(topVol - bottomVol);
    if (topVol >= 3.6 && bottomVol >= 3.6) {
      score -= 16;
      reasons.push({
        severity: "warn",
        text: "Volume on top and volume on the bottom — the silhouette loses your frame entirely.",
        fix: `Slim one half. ${topVol >= bottomVol ? "A straighter trouser" : "A closer-cut top"} would anchor it.`,
        garmentIds: [...tops.map((g) => g.id), ...bottoms.map((g) => g.id)],
        impact: -16,
      });
    } else if (spread >= 1.4) {
      score += 9;
      reasons.push({
        severity: "good",
        text: `${topVol > bottomVol ? "Volume up top over a slim bottom" : "A fitted top over volume below"} — the classic balanced shape.`,
        impact: 9,
      });
    } else if (topVol <= 1.6 && bottomVol <= 1.6) {
      score -= 4;
      reasons.push({
        severity: "info",
        text: "Body-conscious top to bottom. Intentional, but there's no visual rest anywhere in the outfit.",
        fix: "One relaxed piece — an open overshirt, a looser trouser — gives the eye somewhere to land.",
        impact: -4,
      });
    }
  }

  const outerVol = outers.length ? Math.max(...outers.map(garmentVolume)) : null;
  if (outerVol !== null && outerVol >= 4.5 && bottomVol !== null && bottomVol >= 3.6) {
    score -= 8;
    reasons.push({
      severity: "warn",
      text: "A voluminous coat over voluminous trousers reads as one large rectangle.",
      fix: "Keep the coat and slim the leg, or keep the leg and take the coat to something structured.",
      impact: -8,
    });
  }

  /* ------------------------------------------------ waist definition -- */
  const definesWaist = garments.some((g) => {
    const def = subcategoryDef(g.subcategory, g.category);
    return def.definesWaist && (g.category !== "outerwear" || outers.length === 0);
  });
  const hasBelt = garments.some((g) => g.subcategory === "belt");
  const waistVisible =
    hasBelt ||
    (definesWaist && (topVol === null || topVol <= 3)) ||
    dresses.some((d) => subcategoryDef(d.subcategory, d.category).definesWaist);

  const wantsWaist = body.shape === "hourglass" || body.shape === "rectangle" || body.shape === "pear";
  if (wantsWaist && !waistVisible && body.shape !== "unknown") {
    const penalty = body.shape === "hourglass" ? 12 : 8;
    score -= penalty;
    reasons.push({
      severity: "warn",
      text:
        body.shape === "hourglass"
          ? "Nothing here marks your waist, which is the one thing your proportions give you for free."
          : "No waist marker, so the outfit runs straight up and down.",
      fix: "Tuck the front of the top, add a belt, or swap to something with a defined seam at the waist.",
      impact: -penalty,
    });
  } else if (waistVisible && wantsWaist) {
    score += 7;
    reasons.push({ severity: "good", text: "The waist is marked — the silhouette has a centre.", impact: 7 });
  }

  if (body.shape === "apple" && hasBelt) {
    score -= 6;
    reasons.push({
      severity: "info",
      text: "A cinched belt works against the long vertical line that suits you best.",
      fix: "Try the same outfit belt-free with the layer left open, top to hem.",
      impact: -6,
    });
  }

  /* --------------------------------------------------- break points -- */
  const legRatio = body.ratios.legToHeight;
  if (legRatio === null) {
    missingData.push("your height and inseam");
  } else if (tops.length && bottoms.length) {
    const topDef = subcategoryDef(tops[0].subcategory, tops[0].category);
    const hem = topDef.hem ?? "hip";
    if (legRatio < 0.44 && (hem === "hip" || hem === "mid-thigh") && !waistVisible) {
      score -= 9;
      reasons.push({
        severity: "warn",
        text: "Your torso is already the longer half, and this top's hem lowers the break point further.",
        fix: "Front-tuck it, or move to a higher-rise bottom so the eye finds your waist sooner.",
        garmentIds: [tops[0].id],
        impact: -9,
      });
    } else if (legRatio > 0.485 && hem === "crop") {
      score -= 5;
      reasons.push({
        severity: "info",
        text: "A cropped hem on an already-long leg line can leave the torso looking short.",
        fix: "A hem at the hip evens it out.",
        garmentIds: [tops[0].id],
        impact: -5,
      });
    }
  }

  /* --------------------------------------------- body-shape strategy -- */
  const strategy = SHAPE_STRATEGY[body.shape];
  if (body.shape === "pear" || body.shape === "inverted-triangle") {
    const topInterest =
      tops.some((g) => g.pattern !== "solid") ||
      (topVol !== null && topVol >= 3) ||
      tops.some((g) => g.formality >= 4);
    const bottomInterest =
      bottoms.some((g) => g.pattern !== "solid") || (bottomVol !== null && bottomVol >= 3.4);

    if (body.shape === "pear") {
      if (topInterest && !bottomInterest) {
        score += 8;
        reasons.push({ severity: "good", text: "Weight sits above the waist, which evens out your shoulder-to-hip line.", impact: 8 });
      } else if (!topInterest && bottomInterest) {
        score -= 9;
        reasons.push({
          severity: "warn",
          text: "The interesting piece is below the waist, which pulls the eye to your widest point.",
          fix: "Trade it: pattern or structure on top, plain below.",
          impact: -9,
        });
      }
    } else {
      if (bottomVol !== null && bottomVol >= 3.2) {
        score += 8;
        reasons.push({ severity: "good", text: "Volume below the waist meets your shoulder line — well balanced.", impact: 8 });
      } else if (topVol !== null && bottomVol !== null && topVol >= 3.5 && bottomVol <= 2) {
        score -= 10;
        reasons.push({
          severity: "warn",
          text: "A structured top over a slim bottom exaggerates a shoulder line that's already the widest part of you.",
          fix: "A wider or pleated bottom rebalances it immediately.",
          impact: -10,
        });
      }
    }
  }

  if (body.shape === "apple") {
    const longLayer = outers.some((g) => {
      const hem = subcategoryDef(g.subcategory, g.category).hem;
      return hem === "mid-thigh" || hem === "knee";
    });
    if (longLayer) {
      score += 7;
      reasons.push({ severity: "good", text: "An open long layer draws one clean vertical line down the whole outfit.", impact: 7 });
    }
  }

  /* ----------------------------------------------- pattern vs frame -- */
  const height = profile.measurements.height;
  const boldPattern = garments.find((g) => g.patternScale === "bold");
  if (boldPattern && typeof height === "number" && height < 160) {
    score -= 4;
    reasons.push({
      severity: "info",
      text: "A bold-scale pattern on a petite frame tends to wear you rather than the other way round.",
      fix: "The same pattern at a smaller scale keeps the effect without the takeover.",
      garmentIds: [boldPattern.id],
      impact: -4,
    });
  }

  /* --------------------------------------------------------- shoes -- */
  if (shoes.length && bottomVol !== null) {
    const shoeVol = garmentVolume(shoes[0]);
    if (shoeVol >= 4 && bottomVol <= 1.6) {
      reasons.push({
        severity: "info",
        text: "Chunky shoe against a slim leg — a deliberate contrast that only works if the top half is relaxed too.",
        garmentIds: [shoes[0].id],
        impact: 0,
      });
    }
  }

  if (body.shape === "unknown") {
    missingData.push("chest, waist and hip (unlocks shape-specific advice)");
  }

  const confidence = Math.max(
    0.2,
    Math.min(0.95, body.confidence * 0.6 + (garments.length >= 3 ? 0.35 : 0.2)),
  );

  return {
    key: "proportion",
    label: "Proportion",
    score: Math.max(0, Math.min(100, score)),
    confidence,
    weight: 1,
    reasons,
    missingData,
  };
}

export { SHAPE_STRATEGY };
