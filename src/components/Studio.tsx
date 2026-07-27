"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Garment, GarmentCategory, OccasionKey } from "@/lib/types";
import type { ScoreResult } from "@/lib/engine";
import { OCCASIONS, OCCASION_KEYS } from "@/lib/engine/formality";
import { categoryLabel } from "@/lib/engine/insights";
import {
  Button,
  Card,
  ConfidenceBar,
  DimensionRow,
  Empty,
  GarmentThumb,
  Pill,
  ReasonRow,
  ScoreRing,
  SectionTitle,
  VerdictBadge,
} from "./ui";

const ORDER: GarmentCategory[] = ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "bag"];

interface ScoreResponse {
  score: ScoreResult;
  gaps: { text: string; dimension: string }[];
  insulation: string;
  weather: { tempC: number; label?: string } | null;
}

export function Studio({ wardrobe }: { wardrobe: Garment[] }) {
  const router = useRouter();
  const search = useSearchParams();

  const [selected, setSelected] = useState<string[]>(
    () => search.get("items")?.split(",").filter(Boolean) ?? [],
  );
  const [occasion, setOccasion] = useState<OccasionKey>(
    () => (OCCASION_KEYS as string[]).includes(search.get("occasion") ?? "")
      ? (search.get("occasion") as OccasionKey)
      : "casual-social",
  );
  const [filter, setFilter] = useState("");
  const [activeCategory, setActiveCategory] = useState<GarmentCategory | "all">("all");

  const [result, setResult] = useState<ScoreResponse | null>(null);
  const [scoring, setScoring] = useState(false);
  const [logged, setLogged] = useState(false);

  const [tryOn, setTryOn] = useState<{ busy: boolean; image?: string; error?: string }>({ busy: false });

  const byId = useMemo(() => new Map(wardrobe.map((g) => [g.id, g])), [wardrobe]);
  const chosen = useMemo(
    () => selected.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g)),
    [selected, byId],
  );

  /* Debounced live scoring: the studio re-scores on every toggle, so a burst of
     clicks shouldn't turn into a burst of requests. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runScore = useCallback(
    (ids: string[], occ: OccasionKey) => {
      if (timer.current) clearTimeout(timer.current);
      if (ids.length === 0) {
        setResult(null);
        return;
      }
      setScoring(true);
      timer.current = setTimeout(async () => {
        try {
          const res = await fetch("/api/score", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ garmentIds: ids, occasion: occ }),
          });
          setResult(res.ok ? await res.json() : null);
        } catch {
          setResult(null);
        } finally {
          setScoring(false);
        }
      }, 220);
    },
    [],
  );

  useEffect(() => {
    runScore(selected, occasion);
    setLogged(false);
    setTryOn({ busy: false });
  }, [selected, occasion, runScore]);

  function toggle(id: string) {
    setSelected((prev) => {
      const g = byId.get(id);
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (!g) return prev;
      // One garment per structural slot — picking a second pair of trousers
      // should swap, not stack.
      const exclusive: GarmentCategory[] = ["top", "bottom", "dress", "outerwear", "shoes"];
      if (exclusive.includes(g.category)) {
        const without = prev.filter((x) => byId.get(x)?.category !== g.category);
        // A dress replaces a top-and-bottom pairing, and vice versa.
        if (g.category === "dress") {
          return [...without.filter((x) => !["top", "bottom"].includes(byId.get(x)?.category ?? "")), id];
        }
        if (g.category === "top" || g.category === "bottom") {
          return [...without.filter((x) => byId.get(x)?.category !== "dress"), id];
        }
        return [...without, id];
      }
      return [...prev, id];
    });
  }

  async function logWear() {
    await fetch("/api/wear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ garmentIds: selected, occasion, date: new Date().toISOString() }),
    });
    setLogged(true);
    router.refresh();
  }

  async function renderTryOn() {
    setTryOn({ busy: true });
    try {
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ garmentIds: selected }),
      });
      const json = await res.json();
      setTryOn(json.ok ? { busy: false, image: json.image } : { busy: false, error: json.error });
    } catch {
      setTryOn({ busy: false, error: "Render failed." });
    }
  }

  const visible = wardrobe.filter((g) => {
    if (activeCategory !== "all" && g.category !== activeCategory) return false;
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      g.name.toLowerCase().includes(q) ||
      (g.brand ?? "").toLowerCase().includes(q) ||
      g.subcategory.includes(q)
    );
  });

  if (!wardrobe.length) {
    return (
      <Empty
        title="Nothing to build with yet"
        body="Add a few pieces to your wardrobe and the studio will score any combination live as you assemble it."
        cta={<Button href="/wardrobe/new">Add an item</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle hint="Pick pieces and watch the verdict change. Every number opens up into the reason behind it.">
        Studio
      </SectionTitle>

      <div className="flex flex-wrap gap-1.5">
        {OCCASION_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setOccasion(key)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              key === occasion
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-muted)]"
            }`}
          >
            {OCCASIONS[key].label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        {/* --------------------------------------------------- picker -- */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                type="search"
                placeholder="Search your wardrobe…"
                className="!w-56"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button
                onClick={() => setActiveCategory("all")}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  activeCategory === "all"
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-line)] text-[var(--color-muted)]"
                }`}
              >
                All
              </button>
              {ORDER.filter((c) => wardrobe.some((g) => g.category === c)).map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCategory(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    activeCategory === c
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-line)] text-[var(--color-muted)]"
                  }`}
                >
                  {categoryLabel(c)}
                </button>
              ))}
            </div>

            <div className="grid max-h-[28rem] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-5">
              {visible.map((g) => {
                const isSelected = selected.includes(g.id);
                const unavailable = g.careState !== "clean";
                return (
                  <button
                    key={g.id}
                    onClick={() => toggle(g.id)}
                    className={`group overflow-hidden rounded-lg border text-left transition-colors ${
                      isSelected
                        ? "border-[var(--color-accent)]"
                        : "border-[var(--color-line)] hover:border-[var(--color-muted)]"
                    }`}
                  >
                    <div className={`aspect-square overflow-hidden ${unavailable ? "opacity-40" : ""}`}>
                      <GarmentThumb garment={g} />
                    </div>
                    <p className="truncate px-1.5 py-1 text-[11px]">{g.name}</p>
                    {unavailable && (
                      <p className="px-1.5 pb-1 text-[10px] text-[var(--color-warn)]">in the wash</p>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* ------------------------------------------------ preview -- */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">The outfit</p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={renderTryOn} disabled={tryOn.busy || !chosen.length}>
                  {tryOn.busy ? "Rendering…" : "Try it on"}
                </Button>
                <Button onClick={logWear} disabled={!chosen.length || logged}>
                  {logged ? "Logged" : "I wore this"}
                </Button>
              </div>
            </div>

            {chosen.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--color-muted)]">
                Nothing selected. Pick a top and a bottom to get started.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-3">
                {chosen.map((g) => (
                  <div key={g.id} className="w-24">
                    <div className="aspect-[3/4] overflow-hidden rounded-lg border border-[var(--color-line)]">
                      <GarmentThumb garment={g} />
                    </div>
                    <p className="mt-1 truncate text-[11px]">{g.name}</p>
                    <button
                      onClick={() => toggle(g.id)}
                      className="text-[10px] text-[var(--color-faint)] hover:text-[var(--color-bad)]"
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tryOn.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tryOn.image}
                alt="Virtual try-on render"
                className="mt-4 max-h-[28rem] rounded-lg border border-[var(--color-line)]"
              />
            )}
            {tryOn.error && (
              <p className="mt-3 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-raised)] p-3 text-xs text-[var(--color-muted)]">
                {tryOn.error} The flat-lay above is doing the same job for the
                &ldquo;does this combination work&rdquo; question — the score to the right is what
                actually answers whether it fits.
              </p>
            )}
          </Card>
        </div>

        {/* ---------------------------------------------------- verdict -- */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {!result ? (
            <Card className="p-6 text-sm text-[var(--color-muted)]">
              {scoring ? "Scoring…" : "The verdict appears here as soon as you pick something."}
            </Card>
          ) : (
            <>
              <Card className="p-4">
                <div className="flex items-start gap-4">
                  <ScoreRing score={result.score.total} verdict={result.score.verdict} size={82} />
                  <div className="min-w-0 flex-1">
                    <VerdictBadge verdict={result.score.verdict} />
                    <p className="mt-2 text-sm leading-snug">{result.score.headline}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <ConfidenceBar value={result.score.confidence} label="Overall confidence" />
                </div>
                <p className="mt-3 text-xs text-[var(--color-faint)]">{result.insulation}</p>
              </Card>

              <Card className="p-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-faint)]">
                  Breakdown
                </p>
                {result.score.dimensions.map((d) => (
                  <DimensionRow key={d.key} dimension={d} />
                ))}
                <p className="mt-2 text-[11px] leading-snug text-[var(--color-faint)]">
                  The ± column is how much the number could move once you fill in the missing data
                  for that dimension.
                </p>
              </Card>

              {result.score.topFixes.length > 0 && (
                <Card className="p-4">
                  <p className="mb-1 text-xs uppercase tracking-wide text-[var(--color-faint)]">
                    Fix these first
                  </p>
                  <ul>
                    {result.score.topFixes.map((r, i) => <ReasonRow key={i} reason={r} />)}
                  </ul>
                </Card>
              )}

              <Card className="p-4">
                <p className="mb-1 text-xs uppercase tracking-wide text-[var(--color-faint)]">
                  Everything we noticed
                </p>
                <ul>
                  {result.score.dimensions.flatMap((d) =>
                    d.reasons.map((r, i) => <ReasonRow key={`${d.key}-${i}`} reason={r} />),
                  )}
                </ul>
              </Card>

              {result.gaps.length > 0 && (
                <Card className="p-4">
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-faint)]">
                    Raise the confidence
                  </p>
                  <ul className="space-y-1 text-sm text-[var(--color-muted)]">
                    {result.gaps.map((g, i) => (
                      <li key={i}>
                        · {g.text} <Pill>{g.dimension}</Pill>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
