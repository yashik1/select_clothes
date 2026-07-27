import Link from "next/link";
import type { Garment } from "@/lib/types";
import type { ScoreResult } from "@/lib/engine";
import { Card, GarmentThumb, ReasonRow, ScoreRing, VerdictBadge } from "./ui";

/**
 * The unit of advice: what to wear, how good it is, and — always — why.
 * The "why" is non-optional by design; a bare number is the thing that makes
 * styling apps feel arbitrary.
 */
export function OutfitCard({
  garments,
  score,
  href,
  compact = false,
}: {
  garments: Garment[];
  score: ScoreResult;
  href?: string;
  compact?: boolean;
}) {
  const positives = score.dimensions
    .flatMap((d) => d.reasons)
    .filter((r) => r.severity === "good")
    .slice(0, compact ? 1 : 2);

  return (
    <Card className="overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="flex shrink-0 gap-1.5">
          {garments.slice(0, 4).map((g) => (
            <Link
              key={g.id}
              href={`/wardrobe/${g.id}`}
              className="block h-20 w-16 overflow-hidden rounded-lg border border-[var(--color-line)] transition-transform hover:scale-105"
              title={g.name}
            >
              <GarmentThumb garment={g} />
            </Link>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <VerdictBadge verdict={score.verdict} />
              <p className="mt-1.5 text-sm leading-snug">{score.headline}</p>
            </div>
            <ScoreRing score={score.total} verdict={score.verdict} size={compact ? 56 : 64} />
          </div>

          <p className="mt-2 truncate text-xs text-[var(--color-faint)]">
            {garments.map((g) => g.name).join(" · ")}
          </p>
        </div>
      </div>

      {(score.topFixes.length > 0 || positives.length > 0) && (
        <ul className="border-t border-[var(--color-line-soft)] px-4 py-2">
          {score.topFixes.slice(0, compact ? 1 : 2).map((r, i) => (
            <ReasonRow key={`fix-${i}`} reason={r} />
          ))}
          {positives.map((r, i) => (
            <ReasonRow key={`good-${i}`} reason={r} />
          ))}
        </ul>
      )}

      {href && (
        <div className="border-t border-[var(--color-line-soft)] px-4 py-2">
          <Link href={href} className="text-xs text-[var(--color-accent)] hover:underline">
            Open in studio →
          </Link>
        </div>
      )}
    </Card>
  );
}
