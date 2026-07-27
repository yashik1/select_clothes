import Link from "next/link";
import { findOutfits } from "@/lib/engine/combos";
import { OCCASIONS, OCCASION_KEYS, analyseProfile, SHAPE_LABEL } from "@/lib/engine";
import { deriveSeason } from "@/lib/color/palette";
import { appContext, profileReadiness } from "@/lib/server/context";
import { OutfitCard } from "@/components/OutfitCard";
import { Button, Card, Empty, Pill, SectionTitle } from "@/components/ui";
import type { OccasionKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Today({
  searchParams,
}: {
  searchParams: Promise<{ occasion?: string }>;
}) {
  const params = await searchParams;
  const occasion = (OCCASION_KEYS as string[]).includes(params.occasion ?? "")
    ? (params.occasion as OccasionKey)
    : "casual-social";

  const { profile, wardrobe, forecast, scoring } = await appContext(occasion);
  const readiness = profileReadiness(profile);
  const body = analyseProfile(profile);
  const season = deriveSeason(profile.coloring);

  const suggestions =
    wardrobe.length >= 2
      ? findOutfits(wardrobe, profile, scoring, { occasion, limit: 4 })
      : [];

  const clean = wardrobe.filter((g) => g.careState === "clean").length;

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------- header -- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold">
            {greeting()}, {profile.name}.
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {forecast
              ? `${Math.round(forecast.tempC)}°C, ${forecast.label?.toLowerCase()} in ${profile.locationLabel ?? "your area"}. ${forecast.precipitationMm && forecast.precipitationMm > 0.4 ? "Rain is coming." : ""}`
              : "Set your location on the You page and the weather starts feeding into every score."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill tone="accent">{SHAPE_LABEL[body.shape]}</Pill>
          <Pill tone="accent">{season.season}</Pill>
          <Pill>{clean} clean items</Pill>
        </div>
      </div>

      {/* ---------------------------------------------- onboarding nudge -- */}
      {!readiness.ready && (
        <Card className="border-[var(--color-accent)]/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="display text-lg">Your measurements are what make this different.</p>
              <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">
                Right now the fit engine is guessing. Five measurements — chest, waist, hip,
                inseam and shoulder — take four minutes with a tape measure and turn every
                verdict on this site from an opinion into arithmetic.
              </p>
              <p className="mt-2 text-xs text-[var(--color-faint)]">
                Still needed: {readiness.missing.slice(0, 5).join(", ")}
              </p>
            </div>
            <Button href="/profile">Add measurements</Button>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------ occasion -- */}
      <div>
        <SectionTitle hint="Suggestions are filtered and scored for where you're going.">
          What are you dressing for?
        </SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {OCCASION_KEYS.map((key) => (
            <Link
              key={key}
              href={`/?occasion=${key}`}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                key === occasion
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-muted)]"
              }`}
            >
              {OCCASIONS[key].label}
            </Link>
          ))}
        </div>
      </div>

      {/* --------------------------------------------------- suggestions -- */}
      <div>
        <SectionTitle
          hint={
            suggestions.length
              ? "Ranked by fit first, then colour, proportion, formality, weather and rotation."
              : undefined
          }
          action={<Button href="/studio" variant="ghost">Build one yourself</Button>}
        >
          Wear this
        </SectionTitle>

        {wardrobe.length < 2 ? (
          <Empty
            title="Your wardrobe is empty"
            body="Add a few pieces — a top, a bottom, a pair of shoes — and this page starts telling you what to wear and why. Photos are optional; measurements matter more."
            cta={<Button href="/wardrobe/new">Add your first item</Button>}
          />
        ) : suggestions.length === 0 ? (
          <Empty
            title="Nothing clears the bar for this occasion"
            body="Either everything suitable is in the wash, or your wardrobe doesn't have a complete outfit at this level of dress yet. The Gaps page will tell you exactly which single item would fix that."
            cta={<Button href="/gaps">See what's missing</Button>}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {suggestions.map((s) => (
              <OutfitCard
                key={s.garments.map((g) => g.id).join("-")}
                garments={s.garments}
                score={s.score}
                href={`/studio?items=${s.garments.map((g) => g.id).join(",")}&occasion=${occasion}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- links -- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <QuickLink
          href="/gaps"
          title="What should I buy next?"
          body="The one item that unlocks the most new outfits from what you already own."
        />
        <QuickLink
          href="/insights"
          title="What am I not wearing?"
          body="Cost per wear, dead stock, and which pieces have nothing to pair with."
        />
        <QuickLink
          href="/pack"
          title="Pack for a trip"
          body="Fewest items that still cover every day and occasion."
        />
      </div>
    </div>
  );
}

function QuickLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href}>
      <Card className="h-full p-4 transition-colors hover:border-[var(--color-accent)]">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{body}</p>
      </Card>
    </Link>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}
