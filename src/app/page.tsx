import Link from "next/link";
import { findOutfits } from "@/lib/engine/combos";
import { OCCASIONS, OCCASION_KEYS, analyseProfile, SHAPE_LABEL, distinctHeadlines } from "@/lib/engine";
import { deriveSeason } from "@/lib/color/palette";
import { appContext, profileReadiness } from "@/lib/server/context";
import { requireUser } from "@/lib/server/session";
import { OutfitCard } from "@/components/OutfitCard";
import { Button, Card, Empty, Pill, SectionTitle } from "@/components/ui";
import type { OccasionKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Today({ searchParams }: { searchParams: Promise<{ occasion?: string }> }) {
  const params = await searchParams;
  const occasion = (OCCASION_KEYS as string[]).includes(params.occasion ?? "")
    ? (params.occasion as OccasionKey)
    : "casual-social";

  const { id: userId } = await requireUser();
  const { profile, wardrobe, forecast, scoring } = await appContext(userId, occasion);
  const readiness = profileReadiness(profile);
  const body = analyseProfile(profile);
  const season = deriveSeason(profile.coloring);
  const suggestions = wardrobe.length >= 2 ? findOutfits(wardrobe, profile, scoring, { occasion, limit: 4 }) : [];
  const clean = wardrobe.filter((g) => g.careState === "clean").length;
  const worn = wardrobe.filter((g) => (g.wearCount ?? 0) > 0).length;
  const headlines = distinctHeadlines(suggestions.map((s) => s.score));

  return (
    <div className="space-y-10 sm:space-y-14">
      <section className="grid gap-5 lg:grid-cols-[1.55fr_0.85fr]">
        <Card className="overflow-hidden border-transparent bg-[var(--color-ink)] p-6 text-white shadow-[0_20px_60px_-28px_rgba(50,48,47,0.45)] sm:p-9">
          <div className="flex h-full flex-col justify-between gap-10">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/65">
                <span className="rounded-full bg-white/10 px-3 py-1">TODAY</span>
                <span>{OCCASIONS[occasion].label}</span>
              </div>
              <h1 className="display mt-5 max-w-2xl text-4xl leading-[1.02] sm:text-6xl">
                Good style starts with what you already own.
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-6 text-white/70 sm:text-base">
                {forecast
                  ? `${Math.round(forecast.tempC)}°C · ${forecast.label?.toLowerCase()} · ${profile.locationLabel ?? "your area"}`
                  : "Add your location to bring weather into your outfit decisions."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button href="#wear-this" className="bg-white text-[var(--color-ink)] hover:bg-white/90">Show my outfits</Button>
              <Button href="/studio" variant="ghost" className="border-white/20 bg-white/10 text-white hover:border-white/40 hover:bg-white/15">Open Studio</Button>
              <Button href="/try-on" variant="ghost" className="border-white/20 bg-white/10 text-white hover:border-white/40 hover:bg-white/15">Try it on</Button>
            </div>
          </div>
        </Card>

        <Card className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">Your wardrobe</p>
              <p className="display mt-2 text-4xl">{wardrobe.length}</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">pieces in your closet</p>
            </div>
            <div className="rounded-2xl bg-[var(--color-accent-soft)] px-3 py-2 text-xs font-medium text-[var(--color-muted)]">
              {clean} clean
            </div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-2">
            <Metric label="Worn" value={worn} />
            <Metric label="Never worn" value={Math.max(0, wardrobe.length - worn)} />
          </div>
          <div className="mt-6 border-t border-[var(--color-line-soft)] pt-5">
            <p className="text-xs text-[var(--color-faint)]">Profile signal</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone="accent">{SHAPE_LABEL[body.shape]}</Pill>
              <Pill tone="accent">{season.season}</Pill>
              {!readiness.ready && <Pill tone="warn">Measurements incomplete</Pill>}
            </div>
          </div>
        </Card>
      </section>

      {!readiness.ready && (
        <Card className="border-[var(--color-line)] bg-[var(--color-raised)] p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="display text-xl">Unlock more reliable fit scores.</p>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)]">
                Add your measurements once and FitCheck can explain fit using your actual numbers instead of relying on appearance.
              </p>
              <p className="mt-2 text-xs text-[var(--color-faint)]">Still needed: {readiness.missing.slice(0, 5).join(", ")}</p>
            </div>
            <Button href="/profile">Complete profile</Button>
          </div>
        </Card>
      )}

      <section>
        <SectionTitle hint="Start with the moment you're dressing for. FitCheck scores the combinations against your wardrobe data.">
          What's the plan?
        </SectionTitle>
        <div className="flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {OCCASION_KEYS.map((key) => (
            <Link key={key} href={`/?occasion=${key}`} className={`shrink-0 rounded-full border px-4 py-2.5 text-sm transition-colors ${key === occasion ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white" : "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-text)]"}`}>
              {OCCASIONS[key].label}
            </Link>
          ))}
        </div>
      </section>

      <section id="wear-this" className="scroll-mt-28">
        <SectionTitle
          hint={suggestions.length ? "Fit leads the score, followed by colour, proportion, formality, weather and rotation." : undefined}
          action={<Button href="/studio" variant="ghost">Build your own</Button>}
        >
          Wear this
        </SectionTitle>

        {wardrobe.length < 2 ? (
          <Empty title="Start with a few pieces" body="Add a top, bottom and shoes. FitCheck will start turning your wardrobe into complete looks." cta={<Button href="/wardrobe/new">Add first item</Button>} />
        ) : suggestions.length === 0 ? (
          <Empty title="No complete look clears the bar" body="Something is unavailable or your wardrobe is missing a compatible piece. Check Gaps to see what would unlock more combinations." cta={<Button href="/gaps">See wardrobe gaps</Button>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {suggestions.map((s, i) => (
              <OutfitCard
                key={s.garments.map((g) => g.id).join("-")}
                garments={s.garments}
                score={s.score}
                rank={i + 1}
                delay={i * 60}
                headline={headlines[i]}
                href={`/studio?items=${s.garments.map((g) => g.id).join(",")}&occasion=${occasion}`}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle hint="The rest of FitCheck is organised around decisions, not a long feature list.">Next move</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard href="/try-on" eyebrow="VISUALIZE" title="Try it on" body="See selected wardrobe pieces together before you commit to the look." />
          <ActionCard href="/shop-check" eyebrow="SHOP SMART" title="Check a purchase" body="Compare something you're considering with what you already own." />
          <ActionCard href="/capsule" eyebrow="TRAVEL" title="Build a capsule" body="Turn a trip into a small, intentional set of pieces." />
          <ActionCard href="/insights" eyebrow="LEARN" title="Understand your closet" body="See wear patterns, cost per wear and neglected pieces." />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-[var(--color-surface)] p-4">
      <p className="tabular text-2xl font-medium">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

function ActionCard({ href, eyebrow, title, body }: { href: string; eyebrow: string; title: string; body: string }) {
  return (
    <Link href={href} className="group">
      <Card interactive className="h-full p-5">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-[var(--color-faint)]">{eyebrow}</p>
        <p className="display mt-3 text-xl">{title}</p>
        <p className="mt-2 text-sm leading-5 text-[var(--color-muted)]">{body}</p>
        <span className="mt-5 inline-block text-sm text-[var(--color-muted)] transition-transform group-hover:translate-x-1">→</span>
      </Card>
    </Link>
  );
}