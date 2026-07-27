/**
 * Formality coherence.
 *
 * Two failure modes: the outfit is pitched wrong for where you're going, and
 * the outfit disagrees with itself. The second is the more common and more
 * interesting one — a suit jacket over running shoes is a spread problem, not
 * an average problem, and averaging would hide it completely.
 */
import type { Garment, OccasionKey, Reason, SubScore } from "../types";

export const OCCASIONS: Record<OccasionKey, { label: string; lo: number; hi: number; note: string }> = {
  loungewear: { label: "At home", lo: 1, hi: 1.6, note: "comfort first" },
  workout: { label: "Working out", lo: 1, hi: 1.5, note: "performance first" },
  errands: { label: "Errands", lo: 1, hi: 2.2, note: "casual, put-together" },
  travel: { label: "Travel", lo: 1.2, hi: 2.6, note: "comfortable but presentable" },
  "casual-social": { label: "Casual social", lo: 1.6, hi: 2.8, note: "relaxed but considered" },
  "smart-casual": { label: "Smart casual", lo: 2.5, hi: 3.6, note: "no tie, no trainers" },
  office: { label: "Office", lo: 2.8, hi: 4.2, note: "professional" },
  "date-night": { label: "Date night", lo: 2.6, hi: 4.2, note: "sharp, personal" },
  "business-formal": { label: "Business formal", lo: 4, hi: 5, note: "suited" },
  cocktail: { label: "Cocktail", lo: 4, hi: 5, note: "dressed up" },
  "black-tie": { label: "Black tie", lo: 4.8, hi: 5, note: "strict dress code" },
};

export const OCCASION_KEYS = Object.keys(OCCASIONS) as OccasionKey[];

/** Core pieces set the register; accessories only nudge it. */
function weightOf(g: Garment): number {
  switch (g.category) {
    case "dress": return 1.0;
    case "outerwear": return 0.9;
    case "top": return 0.85;
    case "bottom": return 0.85;
    case "shoes": return 0.8;
    case "bag": return 0.3;
    case "accessory": return 0.25;
    default: return 0.5;
  }
}

export function outfitFormality(garments: Garment[]): number {
  const relevant = garments.filter((g) => weightOf(g) >= 0.5);
  if (!relevant.length) return 2.5;
  const total = relevant.reduce((s, g) => s + g.formality * weightOf(g), 0);
  const w = relevant.reduce((s, g) => s + weightOf(g), 0);
  return total / w;
}

export function scoreFormality(garments: Garment[], occasion?: OccasionKey): SubScore {
  const reasons: Reason[] = [];
  const core = garments.filter((g) => weightOf(g) >= 0.5);

  if (core.length < 2) {
    return {
      key: "formality", label: "Formality", score: 75, confidence: 0.15,
      weight: 1, reasons: [], missingData: ["more pieces in the outfit"],
    };
  }

  const avg = outfitFormality(garments);
  let score = 88;

  /* ------------------------------------------------ internal coherence -- */
  const sorted = [...core].sort((a, b) => a.formality - b.formality);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  const spread = highest.formality - lowest.formality;

  if (spread >= 3) {
    score -= 26;
    reasons.push({
      severity: "bad",
      text: `The ${highest.name.toLowerCase()} and the ${lowest.name.toLowerCase()} are ${spread} steps apart on formality — they read as two different outfits.`,
      fix: `Replace the ${lowest.name.toLowerCase()} with something dressier, or take the ${highest.name.toLowerCase()} out.`,
      garmentIds: [highest.id, lowest.id],
      impact: -26,
    });
  } else if (spread === 2) {
    // The deliberate high/low mix. Fine, but only when the anchor is the shoe.
    const intentional = lowest.category === "shoes" || highest.category === "outerwear";
    score -= intentional ? 4 : 12;
    reasons.push({
      severity: intentional ? "info" : "warn",
      text: intentional
        ? `A high-low mix: the ${lowest.name.toLowerCase()} deliberately relaxes the ${highest.name.toLowerCase()}.`
        : `The ${lowest.name.toLowerCase()} is noticeably more casual than everything else here.`,
      fix: intentional ? undefined : `Bring the ${lowest.name.toLowerCase()} up a level.`,
      garmentIds: [highest.id, lowest.id],
      impact: intentional ? -4 : -12,
    });
  } else {
    score += 6;
    reasons.push({ severity: "good", text: "Every piece is pitched at the same level of dress.", impact: 6 });
  }

  /* -------------------------------------------------- occasion match -- */
  if (occasion) {
    const target = OCCASIONS[occasion];
    if (avg < target.lo) {
      const gap = target.lo - avg;
      // Being one step under is a wobble; being four steps under means you are
      // wearing the wrong clothes to the event, and the score should say so.
      const penalty = Math.min(72, gap * 24);
      score -= penalty;
      reasons.push({
        severity: gap > 1 ? "bad" : "warn",
        text: `Too casual for ${target.label.toLowerCase()} — that setting wants ${target.note}.`,
        fix: `Swap the ${lowest.name.toLowerCase()} for the dressiest equivalent you own.`,
        garmentIds: [lowest.id],
        impact: -penalty,
      });
    } else if (avg > target.hi) {
      const gap = avg - target.hi;
      const penalty = Math.min(28, gap * 18);
      score -= penalty;
      reasons.push({
        severity: gap > 1.2 ? "warn" : "info",
        text: `Dressier than ${target.label.toLowerCase()} calls for. Not a problem, but you'll be the sharpest person there.`,
        fix: `Dropping the ${highest.name.toLowerCase()} brings it in line.`,
        garmentIds: [highest.id],
        impact: -penalty,
      });
    } else {
      score += 8;
      reasons.push({ severity: "good", text: `Right register for ${target.label.toLowerCase()}.`, impact: 8 });
    }
  }

  return {
    key: "formality",
    label: "Formality",
    score: Math.max(0, Math.min(100, score)),
    confidence: occasion ? 0.9 : 0.6,
    weight: occasion ? 1.15 : 0.75,
    reasons,
    missingData: occasion ? [] : ["where you're going (pick an occasion)"],
  };
}
