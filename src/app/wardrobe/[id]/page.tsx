import Link from "next/link";
import { notFound } from "next/navigation";
import { getGarment, listCalibrations } from "@/lib/db";
import { evaluateGarmentFit, verdictLabel, daysSince } from "@/lib/engine";
import { outfitsWith } from "@/lib/engine/combos";
import { describeCalibration } from "@/lib/engine/calibration";
import { describeFabric } from "@/lib/data/fabrics";
import { subcategoryDef } from "@/lib/data/garmentTypes";
import { matchColorToSeason, deriveSeason } from "@/lib/color/palette";
import { describeColor } from "@/lib/color/space";
import { describeClo, garmentClo } from "@/lib/engine/weather";
import { formatDelta, formatLength } from "@/lib/units";
import { appContext } from "@/lib/server/context";
import { requireUser } from "@/lib/server/session";
import { OutfitCard } from "@/components/OutfitCard";
import { GarmentActions } from "@/components/GarmentActions";
import { Card, ConfidenceBar, GarmentThumb, Pill, SectionTitle, Swatch } from "@/components/ui";
import { BodyAvatar } from "@/components/BodyAvatar";
import { TryOnPhoto } from "@/components/TryOnPhoto";

export const dynamic = "force-dynamic";

export default async function GarmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { id: userId } = await requireUser();
  const garment = await getGarment(userId, id);
  if (!garment) notFound();

  const { profile, wardrobe, scoring } = await appContext(userId);
  const calibrations = await listCalibrations(userId);
  const def = subcategoryDef(garment.subcategory, garment.category);

  const fit = evaluateGarmentFit(garment, profile, calibrations);
  const season = deriveSeason(profile.coloring);
  const pairings = outfitsWith(garment.id, wardrobe, profile, scoring, { limit: 3 });

  const calibration = garment.brand
    ? calibrations.find(
        (c) => c.brand === garment.brand!.trim().toLowerCase() && c.category === garment.category,
      )
    : undefined;

  const costPerWear =
    typeof garment.pricePaid === "number" && garment.pricePaid > 0
      ? garment.pricePaid / Math.max(1, garment.wearCount)
      : null;
  const since = daysSince(garment.lastWornAt);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr] [&>*]:min-w-0">
        <div>
          {/*
            Capped on a phone. A 3:4 box at the full width of a 390px screen
            is 520px tall — most of the viewport spent on the photo, with the
            garment's own name pushed below the fold.
          */}
          <div className="mx-auto aspect-[3/4] max-w-[15rem] overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-raised)] sm:max-w-none">
            <GarmentThumb garment={garment} />
          </div>
          {garment.imageIds.length > 1 && (
            <div className="mt-2 flex gap-2">
              {garment.imageIds.slice(1).map((imgId) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={imgId}
                  src={`/api/images/${imgId}`}
                  alt=""
                  className="h-16 w-14 rounded-lg border border-[var(--color-line)] object-cover"
                />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="accent">{def.label}</Pill>
              {garment.careState !== "clean" && <Pill tone="warn">{garment.careState}</Pill>}
              {garment.archivedAt && <Pill tone="warn">Archived</Pill>}
            </div>
            <h1 className="display mt-2 text-3xl font-semibold">{garment.name}</h1>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {[garment.brand, garment.size && `size ${garment.size}`, describeFabric(garment.fabric)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Worn"
              value={garment.wearCount === 0 ? "Never" : `${garment.wearCount}×`}
              sub={since !== null ? `last ${Math.round(since)} days ago` : undefined}
            />
            <Stat
              label="Cost per wear"
              value={costPerWear !== null ? `${garment.currency ?? ""}${costPerWear.toFixed(2)}` : "—"}
              sub={typeof garment.pricePaid === "number" ? `paid ${garment.pricePaid}` : "add a price"}
            />
            <Stat label="Warmth" value={describeClo(garmentClo(garment)).split("—")[0].trim()} sub={describeClo(garmentClo(garment)).split("—")[1]?.trim()} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {garment.colors.map((c, i) => {
              const m = matchColorToSeason(c.hex, season.band);
              return (
                <span key={i} className="inline-flex items-center gap-1.5 text-sm">
                  <Swatch hex={c.hex} size={16} />
                  <span className="text-[var(--color-muted)]">{describeColor(c.hex)}</span>
                  <span
                    className="tabular text-xs"
                    style={{
                      color: m.score >= 72 ? "var(--color-good)" : m.score >= 55 ? "var(--color-warn)" : "var(--color-bad)",
                    }}
                    title={`Against your ${season.season} palette: ${m.note}`}
                  >
                    {Math.round(m.score)}
                  </span>
                </span>
              );
            })}
          </div>
          {garment.colors[0] && (
            <p className="text-sm text-[var(--color-muted)]">
              Against your {season.season} palette, this{" "}
              {matchColorToSeason(garment.colors[0].hex, season.band).note}.
            </p>
          )}

          {garment.notes && (
            <p className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-raised)] p-3 text-sm text-[var(--color-muted)]">
              {garment.notes}
            </p>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------- fit -- */}
      <div>
        <SectionTitle hint="Garment measurement minus your body measurement, adjusted for fabric stretch and this brand's known bias.">
          Fit report
        </SectionTitle>
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <span className="tabular display text-4xl">{Math.round(fit.score)}</span>
              <span className="text-sm text-[var(--color-muted)]">out of 100</span>
            </div>
            <div className="w-48">
              <ConfidenceBar value={fit.confidence} />
            </div>
          </div>

          {calibration && (
            <p className="mt-3 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-2.5 text-sm">
              {describeCalibration(calibration)}
            </p>
          )}

          {fit.findings.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-muted)]">
              No fit signal yet. Add a size label, or measure the garment flat —{" "}
              <Link href={`/wardrobe/${garment.id}/edit`} className="text-[var(--color-accent)] hover:underline">
                takes a couple of minutes
              </Link>
              .
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line-soft)] text-left text-xs uppercase tracking-wide text-[var(--color-faint)]">
                  <th className="pb-2 font-medium">Landmark</th>
                  <th className="pb-2 text-right font-medium">You</th>
                  <th className="pb-2 text-right font-medium">Garment</th>
                  <th className="pb-2 text-right font-medium">Room</th>
                  <th className="pb-2 text-right font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {fit.findings.map((f) => (
                  <tr key={f.landmark} className="border-b border-[var(--color-line-soft)] last:border-0">
                    <td className="py-2">
                      {f.label}
                      {f.advice && (
                        <span className="mt-0.5 block text-xs leading-snug text-[var(--color-faint)]">
                          {f.advice}
                        </span>
                      )}
                    </td>
                    <td className="tabular py-2 text-right text-[var(--color-muted)]">
                      {formatLength(f.bodyCm, profile.unit)}
                    </td>
                    <td className="tabular py-2 text-right text-[var(--color-muted)]">
                      {formatLength(f.garmentCm, profile.unit)}
                    </td>
                    <td className="tabular py-2 text-right">{formatDelta(f.effectiveEaseCm, profile.unit)}</td>
                    <td className="py-2 text-right">
                      <span
                        className="text-xs"
                        style={{
                          color:
                            f.verdict === "ideal" ? "var(--color-good)"
                            : f.verdict === "too-tight" || f.verdict === "too-loose" ? "var(--color-bad)"
                            : "var(--color-warn)",
                        }}
                      >
                        {verdictLabel(f.verdict)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {fit.missingData.length > 0 && (
            <p className="mt-4 border-t border-[var(--color-line-soft)] pt-3 text-xs text-[var(--color-faint)]">
              Confidence would rise if you added: {fit.missingData.slice(0, 4).join(", ")}.
            </p>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------- on you -- */}
      <div>
        <SectionTitle hint="Two different questions. The figure is built from your measurements and answers whether it fits; the photo shows what it looks like on you, and knows nothing about your chest.">
          On you
        </SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <BodyAvatar
              measurements={profile.measurements}
              unit={profile.unit}
              garments={[garment]}
            />
          </div>
          <TryOnPhoto
            garmentIds={[garment.id]}
            label={garment.name}
            hasAnyPhoto={garment.imageIds.length > 0}
            initialPhotoId={profile.bodyPhotoIds?.[0] ?? null}
          />
        </div>
      </div>

      {/* --------------------------------------------------- pairings -- */}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] [&>*]:min-w-0">
        <div>
          <SectionTitle hint="Complete outfits built around this piece, scored against today.">
            What goes with it
          </SectionTitle>
          {pairings.length === 0 ? (
            <Card className="p-6 text-sm text-[var(--color-muted)]">
              Nothing in your wardrobe makes a complete, wearable outfit with this yet. That&apos;s
              usually a gap somewhere else —{" "}
              <Link href="/gaps" className="text-[var(--color-accent)] hover:underline">
                see what would fix it
              </Link>
              .
            </Card>
          ) : (
            <div className="space-y-3">
              {pairings.map((p) => (
                <OutfitCard
                  key={p.garments.map((x) => x.id).join("-")}
                  garments={p.garments}
                  score={p.score}
                  href={`/studio?items=${p.garments.map((x) => x.id).join(",")}`}
                  compact
                />
              ))}
            </div>
          )}
        </div>

        <GarmentActions garment={garment} />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">{label}</p>
      <p className="tabular mt-1 text-lg">{value}</p>
      {sub && <p className="text-xs text-[var(--color-faint)]">{sub}</p>}
    </Card>
  );
}
