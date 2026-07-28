import Link from "next/link";
import { analyseGaps } from "@/lib/engine/gaps";
import { appContext } from "@/lib/server/context";
import { requireUser } from "@/lib/server/session";
import { Button, Card, Empty, SectionTitle, Swatch } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function GapsPage() {
  const { id: userId } = await requireUser();
  const { profile, wardrobe, scoring } = await appContext(userId);

  if (wardrobe.length < 4) {
    return (
      <Empty
        title="Not enough to analyse yet"
        body="Gap analysis works by adding a hypothetical item and re-running the outfit search. With fewer than four pieces there's nothing meaningful to compare against — add a handful more and come back."
        cta={<Button href="/wardrobe/new">Add items</Button>}
      />
    );
  }

  const { baseline, results } = analyseGaps(wardrobe, profile, scoring);

  return (
    <div className="space-y-6">
      <SectionTitle
        hint={`Your ${wardrobe.length} items currently make ${baseline} outfit${baseline === 1 ? "" : "s"} that score 76 or above. Each row below is what one more purchase would add.`}
      >
        What to buy next
      </SectionTitle>

      <Card className="p-5">
        <p className="text-sm text-[var(--color-muted)]">
          This is a counterfactual, not a catalogue. For each candidate we build a hypothetical
          garment sized to your measurements, drop it into your wardrobe, and re-run the whole
          outfit search. What you see is the number of genuinely new, wearable combinations it
          creates — and what each of those combinations would be.
        </p>
      </Card>

      {results.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-muted)]">
          Nothing on our staples list would meaningfully expand what you can wear. That&apos;s a
          good problem — your wardrobe is already well connected. The{" "}
          <Link href="/insights" className="text-[var(--color-accent)] hover:underline">
            Insights page
          </Link>{" "}
          is more useful from here.
        </Card>
      ) : (
        <ol className="space-y-3">
          {results.map((r, i) => (
            <li key={r.key}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex gap-4">
                    <span className="tabular display mt-0.5 text-2xl text-[var(--color-faint)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="display text-lg">{r.label}</h3>
                        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                          <Swatch hex={r.colorHex} size={13} />
                          in {r.colorName}
                        </span>
                        {r.suggestedSize && (
                          <span className="text-xs text-[var(--color-faint)]">size {r.suggestedSize}</span>
                        )}
                      </div>
                      <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{r.why}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="tabular display text-4xl text-[var(--color-good)]">+{r.unlocked}</p>
                    <p className="text-xs text-[var(--color-faint)]">new outfits</p>
                    <p className="tabular mt-1 text-xs text-[var(--color-faint)]">
                      ≈{r.costPerUnlock} per outfit unlocked
                    </p>
                    {r.duplicatesCategory && (
                      <p className="mt-1 max-w-[11rem] text-xs leading-snug text-[var(--color-faint)]">
                        Ranked below items in categories you own nothing from — you already
                        have one of these.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 border-t border-[var(--color-line-soft)] pt-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">
                    For example, it would give you
                  </p>
                  <ul className="mt-1.5 space-y-1 text-sm">
                    {r.examples.map((ex, j) => (
                      <li key={j} className="flex items-baseline gap-2">
                        <span className="tabular text-xs text-[var(--color-good)]">{ex.score}</span>
                        <span className="text-[var(--color-muted)]">{ex.garmentNames.join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
