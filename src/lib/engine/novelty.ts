/**
 * Novelty and rotation.
 *
 * The point isn't variety for its own sake — it's that the two most common
 * complaints about a wardrobe ("I have nothing to wear" and "I never wear half
 * of this") are the same problem seen from different ends. This dimension
 * gently pushes the rotation outward and rescues items that have gone quiet.
 */
import type { Garment, Reason, ScoringContext, SubScore, WearLog } from "../types";

const DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY;
}

export function daysSince(iso: string | null | undefined, from = new Date().toISOString()): number | null {
  if (!iso) return null;
  return daysBetween(iso, from);
}

export function scoreNovelty(garments: Garment[], ctx: ScoringContext): SubScore {
  const reasons: Reason[] = [];
  const today = ctx.date ?? new Date().toISOString();
  const logs: WearLog[] = ctx.recentWear ?? [];

  if (logs.length === 0) {
    return {
      key: "novelty", label: "Rotation", score: 80, confidence: 0.2,
      weight: 0.6, reasons: [], missingData: ["a few logged wears (this gets smarter as you use it)"],
    };
  }

  let score = 85;
  const ids = new Set(garments.map((g) => g.id));

  /* --------------------------------------- the exact same outfit again -- */
  const identical = logs.find((l) => {
    if (l.garmentIds.length !== garments.length) return false;
    return l.garmentIds.every((id) => ids.has(id));
  });
  if (identical) {
    const d = daysBetween(identical.date, today);
    if (d <= 14) {
      const penalty = Math.round(22 - d);
      score -= penalty;
      reasons.push({
        severity: d <= 5 ? "warn" : "info",
        text: `You wore this exact combination ${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"} ago.`,
        fix: "Change one piece and it reads as a different outfit.",
        impact: -penalty,
      });
    }
  }

  /* ------------------------------------------------- recently-worn items -- */
  for (const g of garments) {
    if (g.category === "accessory" || g.category === "bag") continue;
    const last = logs
      .filter((l) => l.garmentIds.includes(g.id))
      .map((l) => daysBetween(l.date, today))
      .sort((a, b) => a - b)[0];
    if (last !== undefined && last <= 2 && g.category !== "shoes") {
      score -= 6;
      reasons.push({
        severity: "info",
        text: `${g.name} was on you ${last < 1 ? "today" : `${Math.round(last)} day${Math.round(last) === 1 ? "" : "s"} ago`}.`,
        garmentIds: [g.id],
        impact: -6,
      });
    }
  }

  /* ------------------------------------------------------ same-room risk -- */
  if (ctx.occasion) {
    const sameOccasion = logs.filter(
      (l) => l.occasion === ctx.occasion && daysBetween(l.date, today) <= 10,
    );
    const overlap = sameOccasion.find(
      (l) => l.garmentIds.filter((id) => ids.has(id)).length >= Math.max(2, garments.length - 1),
    );
    if (overlap) {
      score -= 8;
      reasons.push({
        severity: "info",
        text: "Very close to what you wore to the same kind of thing last week — likely the same people.",
        impact: -8,
      });
    }
  }

  /* --------------------------------------------------- rescuing dead stock -- */
  const revived = garments.filter((g) => {
    const d = daysSince(g.lastWornAt, today);
    return g.wearCount === 0 || (d !== null && d > 60);
  });
  if (revived.length) {
    const bonus = Math.min(14, revived.length * 7);
    score += bonus;
    const g = revived[0];
    reasons.push({
      severity: "good",
      text:
        g.wearCount === 0
          ? `This puts the ${g.name.toLowerCase()} into rotation for the first time.`
          : `Brings the ${g.name.toLowerCase()} back after ${Math.round(daysSince(g.lastWornAt, today)!)} days.`,
      garmentIds: revived.map((x) => x.id),
      impact: bonus,
    });
  }

  return {
    key: "novelty",
    label: "Rotation",
    score: Math.max(0, Math.min(100, score)),
    confidence: Math.min(0.9, 0.3 + logs.length * 0.04),
    weight: 0.6,
    reasons,
    missingData: [],
  };
}
