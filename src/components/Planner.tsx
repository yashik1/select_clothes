"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DayPlan, Garment, Outfit, OccasionKey, WearLog } from "@/lib/types";
import { OCCASIONS } from "@/lib/engine/formality";
import {
  dayOf,
  mergeWorn,
  monthGrid,
  relativeDay,
  wornByDay,
  ymd,
} from "@/lib/calendar";
import { Button, Card, Empty, GarmentThumb, SectionTitle } from "./ui";
import { Status, useStatus } from "./Status";

/*
 * The calendar.
 *
 * Two facts share one grid and they are not the same kind of fact. A wear
 * happened: it moved wear counts, cost per wear and the rotation score, and it
 * cannot be edited away from here. A plan is an intention: it moves nothing
 * until it is confirmed, at which point it becomes a wear and stops being a
 * plan. The grid draws worn days solid and planned days dashed for exactly that
 * reason — the distinction is the feature, not decoration.
 *
 * Everything here works in *local* days. The wear log stores UTC instants, so
 * every one of them is converted before it is binned; a shirt worn at 9pm in
 * Los Angeles belongs on that Tuesday, not on Wednesday because UTC had already
 * rolled over.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function longDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function Planner({
  wardrobe,
  outfits,
  plans,
  wearLogs,
}: {
  wardrobe: Garment[];
  outfits: Outfit[];
  plans: DayPlan[];
  wearLogs: WearLog[];
}) {
  const router = useRouter();
  const today = ymd(new Date());

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selected, setSelected] = useState<string>(today);
  const [busy, setBusy] = useState(false);
  const status = useStatus();

  /*
   * Optimistic overrides, layered over what the server sent. `undefined` means
   * "no local opinion, use the server's"; an explicit `null` means cleared.
   * Written this way rather than by copying the props into state, because props
   * arrive again after every `router.refresh()` and state seeded from props
   * would then quietly ignore the fresh copy.
   */
  const [planEdits, setPlanEdits] = useState<Record<string, DayPlan | null>>({});
  const [wornEdits, setWornEdits] = useState<Record<string, string[]>>({});
  const [shareLinks, setShareLinks] = useState<Record<string, string | null>>({});

  const byId = useMemo(() => new Map(wardrobe.map((g) => [g.id, g])), [wardrobe]);
  const resolve = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));

  const serverPlans = useMemo(() => {
    const map: Record<string, DayPlan> = {};
    for (const p of plans) map[dayOf(p.date)] = p;
    return map;
  }, [plans]);

  const planFor = (date: string): DayPlan | null =>
    date in planEdits ? planEdits[date] : (serverPlans[date] ?? null);

  const serverWorn = useMemo(() => wornByDay(wearLogs), [wearLogs]);

  // The merge, and why it deduplicates, is in `@/lib/calendar`.
  const wornOn = (date: string): string[] => mergeWorn(serverWorn, wornEdits, date);

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function shiftMonth(by: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + by, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  /* ---------------------------------------------------------- mutations -- */

  /*
   * Every one of these has both a `!res.ok` branch and a `catch`, and the
   * catch is the one that is easy to leave out. These handlers are called
   * from `onClick` without being awaited, so a rejected `fetch` — offline, DNS
   * gone, request aborted — is an unhandled rejection that nobody sees: the
   * spinner clears from the `finally` and the button simply appears not to have
   * worked. That is a bad failure anywhere and a worse one here, because this
   * app now installs to a home screen and will be opened on a train.
   */

  async function planOutfit(date: string, outfit: Outfit) {
    const garmentIds = resolve(outfit.garmentIds).map((g) => g.id);
    if (!garmentIds.length) {
      status.fail("Every piece in that outfit has since been deleted.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, garmentIds, outfitId: outfit.id, occasion: outfit.occasion }),
      });
      if (!res.ok) {
        status.fail("That plan didn’t save.");
        return;
      }
      const { plan } = (await res.json()) as { plan: DayPlan };
      setPlanEdits((prev) => ({ ...prev, [date]: plan }));
      status.say(`${outfit.name || "Outfit"} planned for ${longDate(date)}.`);
      router.refresh();
    } catch {
      status.fail("That plan didn’t save.");
    } finally {
      setBusy(false);
    }
  }

  async function clearPlan(date: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/plan?date=${date}`, { method: "DELETE" });
      if (!res.ok) {
        status.fail("Couldn’t clear that day.");
        return;
      }
      setPlanEdits((prev) => ({ ...prev, [date]: null }));
      status.say(`Cleared ${longDate(date)}.`);
      router.refresh();
    } catch {
      status.fail("Couldn’t clear that day.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmWorn(date: string, plan: DayPlan) {
    setBusy(true);
    try {
      const res = await fetch("/api/wear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          garmentIds: plan.garmentIds,
          outfitId: plan.outfitId ?? undefined,
          // The plain day, not an instant: this is a statement about a date.
          date,
          // Tells the server to retire the plan now that it has happened.
          planDate: date,
          occasion: plan.occasion,
        }),
      });
      if (!res.ok) {
        status.fail(
          res.status === 429
            ? "That’s a lot of entries in one hour — try again shortly."
            : "Couldn’t log that.",
        );
        return;
      }
      setWornEdits((prev) => ({ ...prev, [date]: plan.garmentIds }));
      setPlanEdits((prev) => ({ ...prev, [date]: null }));
      status.say(`Logged for ${longDate(date)}.`);
      router.refresh();
    } catch {
      status.fail("Couldn’t log that — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function patchOutfit(outfit: Outfit, patch: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/outfits/${outfit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        status.fail("That change didn’t stick.");
        return null;
      }
      const { outfit: updated } = (await res.json()) as { outfit: Outfit };
      router.refresh();
      return updated;
    } catch {
      status.fail("That change didn’t stick — check your connection.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggleShare(outfit: Outfit, on: boolean) {
    const updated = await patchOutfit(outfit, { shared: on });
    if (!updated) return;
    const link = updated.shareToken ? `${window.location.origin}/o/${updated.shareToken}` : null;
    setShareLinks((prev) => ({ ...prev, [outfit.id]: link }));
    if (link) {
      // Best effort: the clipboard needs a secure context and permission, and
      // the link is shown in a field either way so a refusal costs nothing.
      try {
        await navigator.clipboard?.writeText(link);
        status.say("Link copied.");
      } catch {
        status.say("Link ready — copy it from the field.");
      }
    } else {
      status.say("Sharing stopped. That link no longer opens.");
    }
  }

  async function removeOutfit(outfit: Outfit) {
    setBusy(true);
    try {
      const res = await fetch(`/api/outfits/${outfit.id}`, { method: "DELETE" });
      if (!res.ok) {
        status.fail("Couldn’t delete that.");
        return;
      }
      status.say(`Deleted ${outfit.name || "that outfit"}.`);
      router.refresh();
    } catch {
      status.fail("Couldn’t delete that — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------------------------------------- render -- */

  const plan = planFor(selected);
  const worn = wornOn(selected);
  const isPast = selected <= today;

  return (
    <div className="space-y-6">
      <SectionTitle hint="What you wore, and what you mean to. A plan moves nothing until you confirm it — then it becomes a wear and starts counting.">
        Calendar
      </SectionTitle>

      <Status {...status.props} />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] [&>*]:min-w-0">
        {/* ------------------------------------------------------ month -- */}
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]"
            >
              ‹
            </button>
            <p className="font-medium">{monthLabel}</p>
            <button
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]"
            >
              ›
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const cellWorn = wornOn(cell.date);
              const cellPlan = planFor(cell.date);
              const shown = cellWorn.length ? cellWorn : (cellPlan?.garmentIds ?? []);
              const pieces = resolve(shown).slice(0, 3);
              const isToday = cell.date === today;
              const isSelected = cell.date === selected;

              const state = cellWorn.length
                ? "worn"
                : cellPlan
                  ? "planned"
                  : "nothing";

              return (
                <button
                  key={cell.date}
                  onClick={() => setSelected(cell.date)}
                  aria-pressed={isSelected}
                  aria-label={`${longDate(cell.date)} — ${
                    state === "worn" ? "worn" : state === "planned" ? "planned" : "nothing yet"
                  }`}
                  className={`relative flex min-h-[3.25rem] flex-col items-center gap-0.5 rounded-lg border p-1 transition-colors sm:min-h-[4.25rem] ${
                    isSelected
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                      : state === "worn"
                        ? "border-[var(--color-line)] bg-[var(--color-raised)]"
                        : state === "planned"
                          ? "border-dashed border-[var(--color-muted)]"
                          : "border-[var(--color-line)] hover:border-[var(--color-muted)]"
                  } ${cell.inMonth ? "" : "opacity-40"}`}
                >
                  <span
                    className={`text-[10px] leading-none ${
                      isToday
                        ? "rounded-full bg-[var(--color-ink)] px-1.5 py-0.5 text-white"
                        : "text-[var(--color-muted)]"
                    }`}
                  >
                    {cell.dayNumber}
                  </span>
                  {pieces.length > 0 && (
                    <span className="flex gap-0.5">
                      {pieces.map((g) => (
                        <span
                          key={g.id}
                          className="h-4 w-4 overflow-hidden rounded-sm sm:h-5 sm:w-5"
                        >
                          <GarmentThumb garment={g} />
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-faint)]">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-[var(--color-line)] bg-[var(--color-raised)]" />
              worn
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-dashed border-[var(--color-muted)]" />
              planned
            </span>
          </p>
        </Card>

        {/* ------------------------------------------------------- day -- */}
        <div className="space-y-4">
          <Card className="p-4">
            <p className="font-medium">{relativeDay(selected, today)}</p>
            <p className="text-xs text-[var(--color-muted)]">{longDate(selected)}</p>

            {worn.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Worn</p>
                <DayGarments garments={resolve(worn)} />
                <p className="mt-3 text-xs text-[var(--color-muted)]">
                  This one has counted — it is in cost per wear and the rotation score.
                </p>
              </div>
            ) : plan ? (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">
                  Planned{plan.occasion ? ` · ${OCCASIONS[plan.occasion as OccasionKey]?.label}` : ""}
                </p>
                <DayGarments garments={resolve(plan.garmentIds)} />
                <div className="mt-4 flex flex-wrap gap-2">
                  {isPast && (
                    <Button onClick={() => confirmWorn(selected, plan)} disabled={busy}>
                      I wore this
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    href={`/studio?items=${plan.garmentIds.join(",")}${
                      plan.occasion ? `&occasion=${plan.occasion}` : ""
                    }${plan.outfitId ? `&outfit=${plan.outfitId}` : ""}`}
                  >
                    Open in Studio
                  </Button>
                  <Button variant="ghost" onClick={() => clearPlan(selected)} disabled={busy}>
                    Clear
                  </Button>
                </div>
                {!isPast && (
                  <p className="mt-3 text-xs text-[var(--color-muted)]">
                    Nothing counts yet. Confirm it on the day and it becomes a wear.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--color-muted)]">
                Nothing here yet. Pick one of your saved outfits below.
              </p>
            )}
          </Card>

          {/* Choosing what goes on the selected day. */}
          {!worn.length && outfits.length > 0 && (
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">
                Put an outfit on {relativeDay(selected, today).toLowerCase()}
              </p>
              <ul className="mt-3 space-y-1">
                {outfits.slice(0, 8).map((o) => (
                  <li key={o.id}>
                    <button
                      onClick={() => planOutfit(selected, o)}
                      disabled={busy}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors hover:bg-[var(--color-raised)] disabled:opacity-50"
                    >
                      <span className="flex shrink-0 gap-0.5">
                        {resolve(o.garmentIds).slice(0, 3).map((g) => (
                          <span key={g.id} className="h-7 w-7 overflow-hidden rounded">
                            <GarmentThumb garment={g} />
                          </span>
                        ))}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{o.name || "Unnamed outfit"}</span>
                      {typeof o.scoreSnapshot === "number" && (
                        <span className="shrink-0 text-xs text-[var(--color-muted)]">
                          {Math.round(o.scoreSnapshot)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ saved outfits -- */}
      <section className="space-y-3">
        <h2 className="display text-xl">Saved outfits</h2>

        {outfits.length === 0 ? (
          <Empty
            title="Nothing saved yet"
            body="Build a combination in the studio and save it. Saved outfits are what you put on a day, and what you share when you want a second opinion."
            cta={<Button href="/studio">Open the studio</Button>}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {outfits.map((o) => {
              const pieces = resolve(o.garmentIds);
              const link =
                o.id in shareLinks
                  ? shareLinks[o.id]
                  : o.shareToken
                    ? `${typeof window === "undefined" ? "" : window.location.origin}/o/${o.shareToken}`
                    : null;

              return (
                <li key={o.id}>
                  <Card className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{o.name || "Unnamed outfit"}</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {pieces.length} piece{pieces.length === 1 ? "" : "s"}
                          {o.occasion ? ` · ${OCCASIONS[o.occasion as OccasionKey]?.label}` : ""}
                          {typeof o.scoreSnapshot === "number"
                            ? ` · scored ${Math.round(o.scoreSnapshot)}`
                            : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => patchOutfit(o, { pinned: !o.pinned })}
                        disabled={busy}
                        aria-pressed={o.pinned}
                        aria-label={o.pinned ? "Unpin this outfit" : "Pin this outfit"}
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                          o.pinned
                            ? "text-[var(--color-accent)]"
                            : "text-[var(--color-faint)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        ★
                      </button>
                    </div>

                    {pieces.length === 0 ? (
                      <p className="text-xs text-[var(--color-warn)]">
                        Every piece in this one has been deleted.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {pieces.map((g) => (
                          <span key={g.id} className="h-12 w-12 overflow-hidden rounded">
                            <GarmentThumb garment={g} />
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto flex flex-wrap gap-1.5 text-xs">
                      <Link
                        href={`/studio?items=${o.garmentIds.join(",")}${
                          o.occasion ? `&occasion=${o.occasion}` : ""
                        }&outfit=${o.id}${o.name ? `&name=${encodeURIComponent(o.name)}` : ""}`}
                        className="flex min-h-11 items-center rounded-full border border-[var(--color-line)] px-3 transition-colors hover:border-[var(--color-ink)]"
                      >
                        Open
                      </Link>
                      <button
                        onClick={() => toggleShare(o, !o.shareToken)}
                        disabled={busy}
                        className="flex min-h-11 items-center rounded-full border border-[var(--color-line)] px-3 transition-colors hover:border-[var(--color-ink)] disabled:opacity-50"
                      >
                        {o.shareToken ? "Stop sharing" : "Share"}
                      </button>
                      <button
                        onClick={() => removeOutfit(o)}
                        disabled={busy}
                        className="flex min-h-11 items-center rounded-full border border-[var(--color-line)] px-3 text-[var(--color-muted)] transition-colors hover:border-[var(--color-bad)] hover:text-[var(--color-bad)] disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>

                    {link && (
                      <div>
                        {/*
                          Specific rather than reassuring. "Can see this outfit"
                          is true and useless: the verdict includes reasons like
                          "your torso is already the longer half", which is a
                          description of your proportions, and someone deciding
                          whether to send a link deserves to know that before
                          they send it rather than after.
                        */}
                        <label
                          htmlFor={`share-${o.id}`}
                          className="text-[11px] text-[var(--color-faint)]"
                        >
                          Anyone with this link sees these pieces and the full verdict — including
                          the fit and proportion notes, which describe your shape. Not your
                          measurements, and nothing else you own. Stop sharing to break it.
                        </label>
                        <input
                          id={`share-${o.id}`}
                          readOnly
                          value={link}
                          onFocus={(e) => e.currentTarget.select()}
                          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-raised)] px-3 text-xs"
                        />
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DayGarments({ garments }: { garments: Garment[] }) {
  if (!garments.length) {
    return (
      <p className="mt-2 text-xs text-[var(--color-warn)]">
        Those pieces are no longer in your wardrobe.
      </p>
    );
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {garments.map((g) => (
        <li key={g.id} className="w-16">
          <Link href={`/wardrobe/${g.id}`} className="block">
            <span className="block aspect-[3/4] overflow-hidden rounded-lg border border-[var(--color-line)]">
              <GarmentThumb garment={g} />
            </span>
            <span className="mt-1 block truncate text-[11px]">{g.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
