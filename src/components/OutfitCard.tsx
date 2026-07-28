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
  rank,
  delay,
  headline,
}: {
  garments: Garment[];
  score: ScoreResult;
  href?: string;
  compact?: boolean;
  /** 1-based position in a ranked list, shown as a badge. */
  rank?: number;
  delay?: number;
  /** Overrides the score's own headline, so a list can avoid repeating itself. */
  headline?: string;
}) {
  const lead = headline ?? score.headline;
  // The headline is often the strongest reason verbatim, so it is dropped from
  // the list below rather than printed twice.
  const positives = score.dimensions
    .flatMap((d) => d.reasons)
    .filter((r) => r.severity === "good" && !lead.includes(r.text))
    .slice(0, compact ? 1 : 2);

  return (
    <Card className="group overflow-hidden" interactive={Boolean(href)} delay={delay}>
      <div className="flex gap-5 p-5">
        <div className="relative flex shrink-0 gap-1.5">
          {rank !== undefined && (
            <span className="tabular absolute -left-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-ink)] text-[11px] font-medium text-white">
              {rank}
            </span>
          )}
          {garments.slice(0, 4).map((g) => (
            <Link
              key={g.id}
              href={`/wardrobe/${g.id}`}
              className="block h-20 w-16 overflow-hidden rounded-2xl border border-[var(--color-line)] transition-transform duration-200 hover:z-10 hover:scale-105"
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
              <p className="display mt-2.5 text-lg leading-snug">{lead}</p>
            </div>
            <ScoreRing score={score.total} verdict={score.verdict} size={compact ? 62 : 76} />
          </div>

          <p className="mt-2.5 truncate text-xs text-[var(--color-faint)]">
            {garments.map((g) => g.name).join(" · ")}
          </p>
        </div>
      </div>

      {(score.topFixes.length > 0 || positives.length > 0) && (
        <ul className="border-t border-[var(--color-line-soft)] bg-[var(--color-surface)] px-5 py-3">
          {score.topFixes.slice(0, compact ? 1 : 2).map((r, i) => (
            <ReasonRow key={`fix-${i}`} reason={r} />
          ))}
          {positives.map((r, i) => (
            <ReasonRow key={`good-${i}`} reason={r} />
          ))}
        </ul>
      )}

      {href && (
        <div className="border-t border-[var(--color-line-soft)] px-5 py-3">
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-muted)]"
          >
            Open in studio
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-1">→</span>
          </Link>
        </div>
      )}
    </Card>
  );
}
