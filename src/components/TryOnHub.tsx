"use client";

import { useMemo, useState } from "react";
import { Card, SectionTitle, Button, GarmentThumb, Pill } from "@/components/ui";
import { TryOnPhoto } from "@/components/TryOnPhoto";
import type { Garment, GarmentCategory } from "@/lib/types";

const RENDERABLE: GarmentCategory[] = ["dress", "top", "bottom", "outerwear"];

export function TryOnHub({ wardrobe, bodyPhotoId, provider }: { wardrobe: Garment[]; bodyPhotoId: string | null; provider: any }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const byId = useMemo(() => new Map(wardrobe.map((g) => [g.id, g])), [wardrobe]);

  const visible = wardrobe.filter((g) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return g.name.toLowerCase().includes(q) || (g.brand || "").toLowerCase().includes(q) || g.subcategory.includes(q);
  });

  function toggle(g: Garment) {
    setSelected((prev) => {
      if (prev.includes(g.id)) return prev.filter((id) => id !== g.id);
      if (!RENDERABLE.includes(g.category)) return prev;
      const structural = new Set<GarmentCategory>(["dress", "top", "bottom", "outerwear"]);
      const next = prev.filter((id) => {
        const old = byId.get(id);
        if (!old) return false;
        if (g.category === "dress") return !["top", "bottom"].includes(old.category);
        if (g.category === "top" || g.category === "bottom") return old.category !== "dress";
        return !(structural.has(old.category) && old.category === g.category);
      });
      return [...next, g.id];
    });
  }

  const renderable = selected.map((id) => byId.get(id)).filter((g): g is Garment => !!g && RENDERABLE.includes(g.category));

  return (
    <div className="space-y-6">
      <SectionTitle hint="Build a look from your actual wardrobe, then use the configured render provider for the visual layer. FitCheck's measurement engine remains the source of fit truth.">Try On</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Card className="p-4"><div className="flex flex-wrap gap-2"><input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search wardrobe…" aria-label="Search your wardrobe" className="min-h-11 flex-1" /><Button variant="ghost" onClick={() => setSelected([])}>Clear</Button></div><div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">{visible.map((g) => { const active = selected.includes(g.id); const allowed = RENDERABLE.includes(g.category); return <button key={g.id} disabled={!allowed} onClick={() => toggle(g)} className={"overflow-hidden rounded-lg border text-left " + (active ? "border-[var(--color-accent)]" : "border-[var(--color-line)]") + " " + (allowed ? "" : "opacity-45")}><div className="aspect-[3/4]"><GarmentThumb garment={g} /></div><p className="truncate px-2 py-1.5 text-xs">{g.name}</p></button>; })}</div></Card>
        <div className="space-y-4"><Card className="p-5"><p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Selected</p><div className="mt-3 flex flex-wrap gap-1.5">{renderable.map((g) => <Pill key={g.id}>{g.name}</Pill>)}</div>{!renderable.length && <p className="mt-2 text-sm text-[var(--color-muted)]">Choose a dress, top, bottom or outer layer.</p>}</Card>
          {renderable.length > 0 && <TryOnPhoto garmentIds={renderable.map((g) => g.id)} label={renderable.length === 1 ? renderable[0].name : "selected outfit"} hasAnyPhoto={renderable.some((g) => g.imageIds.length > 0)} initialPhotoId={bodyPhotoId} initialProvider={provider} />}
        </div>
      </div>
    </div>
  );
}