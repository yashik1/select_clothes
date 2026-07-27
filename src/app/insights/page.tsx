import Link from "next/link";
import { listCalibrations, listWearLogs } from "@/lib/db";
import { buildInsights, categoryLabel, type GarmentInsight } from "@/lib/engine/insights";
import { describeCalibration } from "@/lib/engine/calibration";
import { appContext } from "@/lib/server/context";
import { Button, Card, Empty, GarmentThumb, Pill, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function InsightsPage() {
  const { profile, wardrobe } = await appContext();
  const logs = listWearLogs(365);
  const calibrations = listCalibrations();

  if (wardrobe.length < 3) {
    return (
      <Empty
        title="Not much to analyse yet"
        body="Add a few more items and log a couple of wears. These numbers get useful fast — most of the value shows up after about two weeks of logging."
        cta={<Button href="/wardrobe/new">Add items</Button>}
      />
    );
  }

  const insights = buildInsights(wardrobe, profile, logs);

  return (
    <div className="space-y-8">
      <SectionTitle hint="Cost per wear is the easy part. What matters is why an item isn't earning its keep.">
        Insights
      </SectionTitle>

      {insights.headlines.length > 0 && (
        <Card className="p-5">
          <ul className="space-y-2 text-sm">
            {insights.headlines.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[var(--color-accent)]">·</span>
                {h}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Items" value={String(insights.totalItems)} />
        <Stat label="Worn in 90 days" value={`${Math.round(insights.utilisation * 100)}%`} />
        <Stat
          label="Avg cost per wear"
          value={insights.averageCostPerWear !== null ? `${insights.currency} ${insights.averageCostPerWear.toFixed(2)}` : "—"}
        />
        <Stat
          label="Total spend logged"
          value={insights.totalSpend > 0 ? `${insights.currency} ${Math.round(insights.totalSpend)}` : "—"}
        />
      </div>

      {/* ----------------------------------------------------- balance -- */}
      <div>
        <SectionTitle hint="A wardrobe's outfit count depends on its shape, not its size. Bottoms and outerwear multiply; a tenth t-shirt barely moves the number.">
          Composition
        </SectionTitle>
        <Card className="p-5">
          <div className="space-y-2">
            {insights.byCategory.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm text-[var(--color-muted)]">
                  {categoryLabel(c.category)}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)]"
                    style={{ width: `${Math.max(2, c.share * 100)}%` }}
                  />
                </div>
                <span className="tabular w-8 text-right text-sm">{c.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* -------------------------------------------------- calibration -- */}
      {calibrations.length > 0 && (
        <div>
          <SectionTitle hint="Learned from your post-wear answers. This is applied automatically to every garment from that brand, including ones you haven't bought.">
            What we&apos;ve learned about your sizing
          </SectionTitle>
          <Card className="p-5">
            <ul className="space-y-2 text-sm">
              {calibrations.map((c) => (
                <li key={`${c.brand}-${c.category}`} className="flex gap-2">
                  <span className="text-[var(--color-accent)]">·</span>
                  {describeCalibration(c)}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* ---------------------------------------------------- problems -- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ItemList
          title="Not earning their place"
          hint="Never worn, or untouched for months."
          items={insights.deadStock}
          currency={insights.currency}
          emptyText="Nothing is going unworn. Genuinely rare."
        />
        <ItemList
          title="Nothing to pair with"
          hint="Perfectly good items your wardrobe has no partner for. This is a gap elsewhere, not a flaw here."
          items={insights.orphans}
          currency={insights.currency}
          emptyText="Every item has somewhere to go."
          footer={
            <Link href="/gaps" className="text-xs text-[var(--color-accent)] hover:underline">
              See which purchase would fix this →
            </Link>
          }
        />
        <ItemList
          title="The fit is the problem"
          hint="These score badly on measurements alone — no amount of styling fixes them."
          items={insights.poorFit}
          currency={insights.currency}
          emptyText="Everything you own fits you."
        />
        <ItemList
          title="Workhorses"
          hint="Worn twelve times or more. Worth knowing what to replace when they wear out."
          items={insights.workhorses}
          currency={insights.currency}
          emptyText="Log a few more wears and your favourites will surface here."
        />
      </div>
    </div>
  );
}

function ItemList({
  title,
  hint,
  items,
  currency,
  emptyText,
  footer,
}: {
  title: string;
  hint: string;
  items: GarmentInsight[];
  currency: string;
  emptyText: string;
  footer?: React.ReactNode;
}) {
  return (
    <div>
      <SectionTitle hint={hint}>{title}</SectionTitle>
      <Card className="p-4">
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{emptyText}</p>
        ) : (
          <ul className="space-y-3">
            {items.slice(0, 6).map((i) => (
              <li key={i.garment.id}>
                <Link href={`/wardrobe/${i.garment.id}`} className="flex gap-3">
                  <span className="h-14 w-11 shrink-0 overflow-hidden rounded-md border border-[var(--color-line)]">
                    <GarmentThumb garment={i.garment} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm">{i.garment.name}</span>
                      {i.costPerWear !== null && (
                        <span className="tabular shrink-0 text-xs text-[var(--color-faint)]">
                          {currency} {i.costPerWear.toFixed(2)}/wear
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Pill>{i.garment.wearCount === 0 ? "never worn" : `${i.garment.wearCount} wears`}</Pill>
                      <Pill>{i.pairings} pairing{i.pairings === 1 ? "" : "s"}</Pill>
                      {i.fitScore !== null && i.fitScore < 52 && <Pill tone="bad">fit {Math.round(i.fitScore)}</Pill>}
                    </span>
                    {i.advice && (
                      <span className="mt-1 block text-xs leading-snug text-[var(--color-muted)]">
                        {i.advice}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {footer && <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">{footer}</div>}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">{label}</p>
      <p className="tabular display mt-1 text-2xl">{value}</p>
    </Card>
  );
}
