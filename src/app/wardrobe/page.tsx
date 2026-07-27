import Link from "next/link";
import { listGarments } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { getOrCreateProfile } from "@/lib/db";
import { evaluateGarmentFit } from "@/lib/engine";
import { categoryLabel } from "@/lib/engine/insights";
import { Button, Card, Empty, GarmentThumb, Pill, SectionTitle, Swatch } from "@/components/ui";
import type { GarmentCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const ORDER: GarmentCategory[] = ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "bag"];

export default async function WardrobePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; state?: string }>;
}) {
  const params = await searchParams;
  const { id: userId } = await requireUser();
  const profile = await getOrCreateProfile(userId);
  const all = await listGarments(userId);

  const filtered = all.filter((g) => {
    if (params.category && g.category !== params.category) return false;
    if (params.state === "laundry" && g.careState === "clean") return false;
    if (params.state === "unworn" && g.wearCount > 0) return false;
    return true;
  });

  const counts = ORDER.map((c) => ({ category: c, count: all.filter((g) => g.category === c).length }))
    .filter((c) => c.count > 0);

  if (!all.length) {
    return (
      <Empty
        title="Nothing here yet"
        body="Add clothes one at a time, or work through a drawer in one sitting. A photo auto-fills the colours; a size label is enough for the fit engine to start with."
        cta={<Button href="/wardrobe/new">Add your first item</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        hint={`${all.length} items · ${all.filter((g) => g.careState === "clean").length} available right now`}
        action={<Button href="/wardrobe/new">Add item</Button>}
      >
        Wardrobe
      </SectionTitle>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip href="/wardrobe" active={!params.category && !params.state} label={`All ${all.length}`} />
        {counts.map((c) => (
          <FilterChip
            key={c.category}
            href={`/wardrobe?category=${c.category}`}
            active={params.category === c.category}
            label={`${categoryLabel(c.category)} ${c.count}`}
          />
        ))}
        <span className="mx-1 w-px bg-[var(--color-line)]" />
        <FilterChip href="/wardrobe?state=laundry" active={params.state === "laundry"} label="In the wash" />
        <FilterChip href="/wardrobe?state=unworn" active={params.state === "unworn"} label="Never worn" />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-[var(--color-muted)]">
          Nothing matches that filter.
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((g) => {
            const fit =
              g.category === "shoes" || g.category === "accessory" || g.category === "bag"
                ? null
                : evaluateGarmentFit(g, profile);
            const fitTone =
              !fit || fit.confidence < 0.25 ? "neutral"
              : fit.score >= 78 ? "good"
              : fit.score >= 58 ? "warn"
              : "bad";

            return (
              <Link key={g.id} href={`/wardrobe/${g.id}`}>
                <Card className="h-full overflow-hidden transition-colors hover:border-[var(--color-accent)]">
                  <div className="aspect-[3/4] overflow-hidden bg-[var(--color-raised)]">
                    <GarmentThumb garment={g} />
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-medium">{g.name}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--color-faint)]">
                      {g.brand ? `${g.brand} · ` : ""}
                      {g.size ?? g.subcategory.replace(/-/g, " ")}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex gap-1">
                        {g.colors.slice(0, 3).map((c, i) => <Swatch key={i} hex={c.hex} size={11} />)}
                      </div>
                      {fit && fit.confidence >= 0.25 && (
                        <Pill tone={fitTone as "good" | "warn" | "bad" | "neutral"}>
                          Fit {Math.round(fit.score)}
                        </Pill>
                      )}
                    </div>
                    {g.careState !== "clean" && (
                      <p className="mt-1.5 text-[11px] text-[var(--color-warn)]">
                        {g.careState === "laundry" ? "In the wash" : g.careState}
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
          : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-muted)]"
      }`}
    >
      {label}
    </Link>
  );
}
