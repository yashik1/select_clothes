"use client";

import { useState } from "react";
import { OCCASIONS, OCCASION_KEYS } from "@/lib/engine/formality";
import type { OccasionKey } from "@/lib/types";
import { Button, Card, Pill, SectionTitle } from "./ui";
import { ScreenReaderStatus, Status, useStatus } from "./Status";

interface PackResponse {
  items: { id: string; name: string; category: string; subcategory: string; imageIds: string[]; colors: { hex: string }[] }[];
  outfits: { day: number; occasion: OccasionKey; score: number; garments: { id: string; name: string }[] }[];
  uncovered: { day: number; occasion: OccasionKey }[];
  totalCombinations: number;
  notes: string[];
}

export function PackPlanner() {
  const [days, setDays] = useState(5);
  const [itinerary, setItinerary] = useState<OccasionKey[]>([
    "travel", "office", "office", "casual-social", "travel",
  ]);
  const [tempLowC, setTempLowC] = useState(9);
  const [tempHighC, setTempHighC] = useState(18);
  const [rain, setRain] = useState(false);
  const [maxItems, setMaxItems] = useState(10);

  const [result, setResult] = useState<PackResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useStatus();

  function setDayCount(n: number) {
    const clamped = Math.max(1, Math.min(21, n));
    setDays(clamped);
    setItinerary((prev) => {
      const next = [...prev];
      while (next.length < clamped) next.push(next[next.length - 1] ?? "casual-social");
      return next.slice(0, clamped);
    });
  }

  async function plan() {
    setBusy(true);
    status.busy("Working out the smallest bag that covers every day…");
    try {
      const res = await fetch("/api/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, itinerary, tempLowC, tempHighC, rain, maxItems }),
      });
      if (!res.ok) throw new Error("Could not plan this trip.");
      const plan: PackResponse = await res.json();
      setResult(plan);
      status.say(`Packed ${plan.items.length} items for ${days} days.`);
    } catch (e) {
      status.fail(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionTitle hint="The fewest items that still give you a scored, wearable outfit for every day and every occasion.">
        Pack for a trip
      </SectionTitle>

      <Card className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label>Days</Label>
            <input
              type="number"
              min={1}
              max={21}
              className="tabular"
              value={days}
              onChange={(e) => setDayCount(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Coldest it gets (°C)</Label>
            <input type="number" className="tabular" value={tempLowC} onChange={(e) => setTempLowC(Number(e.target.value))} />
          </div>
          <div>
            <Label>Warmest it gets (°C)</Label>
            <input type="number" className="tabular" value={tempHighC} onChange={(e) => setTempHighC(Number(e.target.value))} />
          </div>
          <div>
            <Label>Suitcase limit (items)</Label>
            <input
              type="number"
              min={3}
              max={30}
              className="tabular"
              value={maxItems}
              onChange={(e) => setMaxItems(Number(e.target.value))}
            />
          </div>
        </div>

        {/* The label carries the height so the whole phrase is the target,
            which is what a checkbox label is for. */}
        <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={rain}
            onChange={(e) => setRain(e.target.checked)}
            className="!h-5 !w-5 accent-[var(--color-accent)]"
          />
          Rain is likely
        </label>

        <div>
          <Label>What each day is for</Label>
          <div className="space-y-1.5">
            {itinerary.map((occ, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-[var(--color-faint)]">Day {i + 1}</span>
                <select
                  value={occ}
                  onChange={(e) => {
                    const next = [...itinerary];
                    next[i] = e.target.value as OccasionKey;
                    setItinerary(next);
                  }}
                >
                  {OCCASION_KEYS.map((k) => (
                    <option key={k} value={k}>{OCCASIONS[k].label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={plan} disabled={busy}>
            {busy ? "Working it out…" : "Plan the suitcase"}
          </Button>
          <Status {...status.props} />
        </div>
      </Card>

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Items to pack" value={String(result.items.length)} />
            <Stat label="Days covered" value={`${result.outfits.length} of ${days}`} />
            <Stat label="Outfits it makes" value={String(result.totalCombinations)} />
          </div>

          {result.notes.length > 0 && (
            <Card className="p-4">
              <ul className="space-y-1.5 text-sm text-[var(--color-warn)]">
                {result.notes.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            </Card>
          )}

          <div>
            <SectionTitle>The list</SectionTitle>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
              {result.items.map((item) => (
                <Card key={item.id} className="overflow-hidden">
                  <div className="aspect-square overflow-hidden bg-[var(--color-raised)]">
                    {item.imageIds[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/images/${item.imageIds[0]}`} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full" style={{ background: item.colors[0]?.hex ?? "#333" }} />
                    )}
                  </div>
                  <p className="truncate px-2 py-1.5 text-[11px]">{item.name}</p>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>Day by day</SectionTitle>
            <div className="space-y-2">
              {result.outfits.map((o) => (
                <Card key={o.day} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-3">
                    <span className="tabular w-14 text-sm text-[var(--color-faint)]">Day {o.day}</span>
                    <Pill tone="accent">{OCCASIONS[o.occasion].label}</Pill>
                    <span className="text-sm text-[var(--color-muted)]">
                      {o.garments.map((g) => g.name).join(" · ")}
                    </span>
                  </div>
                  <span
                    className="tabular text-sm"
                    style={{ color: o.score >= 76 ? "var(--color-good)" : "var(--color-warn)" }}
                  >
                    {o.score}
                  </span>
                </Card>
              ))}
              {result.uncovered.map((u) => (
                <Card key={`u-${u.day}`} className="flex items-center gap-3 p-3">
                  <span className="tabular w-14 text-sm text-[var(--color-faint)]">Day {u.day}</span>
                  <Pill tone="bad">{OCCASIONS[u.occasion].label}</Pill>
                  <span className="text-sm text-[var(--color-bad)]">
                    No wearable outfit within the item limit.
                  </span>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{children}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">{label}</p>
      <p className="tabular display mt-1 text-2xl">{value}</p>
    </Card>
  );
}
