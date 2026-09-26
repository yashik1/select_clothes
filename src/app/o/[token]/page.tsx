import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrCreateProfile, listCalibrations } from "@/lib/db";
import { scoreOutfit } from "@/lib/engine";
import { OCCASIONS } from "@/lib/engine/formality";
import { LIMITS, callerFromHeaders, consume } from "@/lib/server/rateLimit";
import { loadSharedOutfit } from "@/lib/server/share";
import { Button, Card, ConfidenceBar, DimensionRow, GarmentThumb, ReasonRow, ScoreRing, VerdictBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

/*
 * Somebody else's outfit.
 *
 * The second-opinion page: a link you send a friend so they can see what you
 * put together and what the engine made of it. It is the only page in the app
 * that renders without a session, so what it is *not* allowed to show matters
 * as much as what it shows.
 *
 * Out: the owner's name and email, their measurements as numbers, their body
 * figure — the avatar is drawn from real girths and would be a disclosure of
 * body shape — their location, their wear history, and every other garment they
 * own.
 *
 * In: the clothes in this one outfit, and the verdict. Be clear-eyed about what
 * the verdict contains. The reasons quote ease in centimetres ("4cm tighter than
 * comfortable at the chest"), which is a fact about the gap between a garment
 * and a body rather than about the body — but they also say things like "your
 * torso is already the longer half" and "a bold-scale pattern on a petite
 * frame". That is a qualitative description of the owner's proportions, and it
 * travels with the link. It is also the entire reason anyone would want a
 * second opinion from this app instead of a photo, so it stays — and the person
 * minting the link is told plainly that this is what they are sending.
 *
 * The other half of the problem is grammatical. Every reason the engine writes
 * is in the second person, addressed to the wardrobe's owner. On this page the
 * reader is somebody else, so an unframed "your own colouring" tells the viewer
 * something false about themselves. Rewriting the strings to third person turns
 * them into mush ("the clothes will get looked at before them do"), so the page
 * says once, in the place the reader's eye is already going, who "you" is.
 */

export const metadata: Metadata = {
  title: "A shared outfit — FitCheck",
  /*
   * A share link is unlisted, not public. Indexing one would put an outfit
   * someone sent to two friends into a search engine, where revoking the link
   * no longer takes it back.
   */
  robots: { index: false, follow: false, nocache: true },
};

export default async function SharedOutfitPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const who = callerFromHeaders(await headers());
  const verdict = await consume(`share:${who.id}`, LIMITS.share);
  // Only gate a caller we can actually tell apart. Behind an adapter that sets
  // no forwarding header every visitor shares one counter, and refusing on that
  // would take the page down for everyone rather than slow one reader.
  if (!verdict.ok && who.identified) {
    return (
      <Shell>
        <p className="text-[var(--color-muted)]">
          This link is being opened faster than the server will render it. Try again in a
          moment.
        </p>
      </Shell>
    );
  }

  const shared = await loadSharedOutfit(token);
  // A revoked link, a mistyped one and one that never existed all answer the
  // same way. There is nothing useful to tell them apart with.
  if (!shared) notFound();

  const { outfit, garments, ownerId } = shared;

  const [profile, calibrations] = await Promise.all([
    getOrCreateProfile(ownerId),
    listCalibrations(ownerId),
  ]);

  /*
   * Scored without weather and without the wear log. Both are private — one is
   * a location, the other is a diary — and neither belongs in a link handed to
   * someone else. So the weather and rotation dimensions come back at the
   * confidence of no data, which is honest, and the four dimensions a second
   * opinion is actually for are identical to what the owner sees.
   */
  const score = scoreOutfit(garments, profile, {
    occasion: outfit.occasion,
    calibrations,
  });

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr] [&>*]:min-w-0">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <ScoreRing score={score.total} verdict={score.verdict} />
              <div className="min-w-0">
                <VerdictBadge verdict={score.verdict} />
                <p className="mt-2 text-sm leading-relaxed">{score.headline}</p>
              </div>
            </div>
            <div className="mt-4">
              <ConfidenceBar value={score.confidence} />
            </div>
          </Card>

          <Card className="p-5">
            <p className="font-medium">
              {outfit.name || "An outfit"}
              {outfit.occasion && (
                <span className="font-normal text-[var(--color-muted)]">
                  {" "}· {OCCASIONS[outfit.occasion]?.label}
                </span>
              )}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {garments.map((g) => (
                <li key={g.id} className="w-20">
                  <span className="block aspect-[3/4] overflow-hidden rounded-lg border border-[var(--color-line)]">
                    {/* The token is what entitles this page to the photo; without
                        it `/api/images` answers 404, as it should. */}
                    <GarmentThumb garment={g} share={token} />
                  </span>
                  <span className="mt-1 block truncate text-[11px]">{g.name}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <p className="font-medium">How it scores</p>
            <div className="mt-3 space-y-1">
              {score.dimensions.map((d) => (
                <DimensionRow key={d.key} dimension={d} />
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[var(--color-faint)]">
              Scored against the owner’s own measurements. Weather and rotation are left out of a
              shared view — one needs their location and the other their wear history, and neither
              travels with a link.
            </p>
          </Card>

          {score.dimensions.some((d) => d.reasons.length > 0) && (
            <Card className="p-5">
              <p className="font-medium">Why</p>
              {/*
                The one line that stops every reason below being read as a
                statement about the reader. The engine writes in the second
                person because it normally addresses the person whose wardrobe
                it is, and here that person is not the one reading.
              */}
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Written to whoever shared this — “you” below means them.
              </p>
              <div className="mt-3 space-y-1">
                {score.dimensions.flatMap((d) =>
                  d.reasons.map((r, i) => <ReasonRow key={`${d.key}-${i}`} reason={r} />),
                )}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <p className="font-medium">This is arithmetic, not a guess</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
              Every number above came from comparing garment measurements against body
              measurements in centimetres — which is why it can tell you a shirt won’t close, and
              why a rendered picture can’t.
            </p>
            <div className="mt-4">
              <Button href="/signup">Score your own wardrobe</Button>
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Shared with you</p>
        <h1 className="display mt-1 text-3xl">A second opinion</h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-[var(--color-muted)]">
          Someone shared one outfit from their wardrobe. You can see the pieces and the verdict —
          nothing else they own, and none of their measurements.{" "}
          <Link href="/" className="underline hover:text-[var(--color-text)]">
            What is FitCheck?
          </Link>
        </p>
      </div>
      {children}
    </div>
  );
}
