"use client";

import { useMemo, useState } from "react";
import type { Garment } from "@/lib/types";
import { Card, SectionTitle, Button, GarmentThumb, Pill } from "@/components/ui";

export function CapsuleBuilder({ wardrobe }: { wardrobe: Garment[] }) {
  const [days, setDays] = useState(7);
  const [selected, setSelected] = useState<string[]>([]);

  const candidates = useMemo(() => {
    const clean = wardrobe.filter((g) => g.careState === "clean" && !g.archivedAt);
    const rank = (g: Garment) => g.wearCount === 0 ? 0 : g.wearCount < 3 ? 1 : 2;
    return [...clean].sort((a, b) => rank(a) - rank(b));
  }, [wardrobe]);

  function build() {
    const limits: Record<string, number> = { top: 4, bottom: 3, outerwear: 2, shoes: 2, accessory: 3, bag: 1, dress: 2 };
    const counts: Record<string, number> = {};
    const picked: string[] = [];
    for (const g of candidates) {
      const n = counts[g.category] || 0;
      const limit = limits[g.category] ?? 1;
      if (n < limit) { picked.push(g.id); counts[g.category] = n + 1; }
    }
    setSelected(picked);
  }

  const pieces = selected.map((id) => wardrobe.find((g) => g.id === id)).filter(Boolean) as Garment[];

  return (
    <div className="space-y-6">
      <SectionTitle hint="A capsule is a constraint problem: enough variety for the trip without packing your whole wardrobe.">Capsule Builder</SectionTitle>
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Trip length
            <input className="mt-1 block min-h-11 w-28" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value)))} />
          </label>
          <Button onClick={build}>Build capsule</Button>
          <p className="text-xs text-[var(--color-faint)]">Target: roughly {Math.min(14, Math.max(5, Math.ceil(days * 1.4)))} pieces.</p>
        </div>
      </Card>
      {pieces.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {pieces.map((g) => <Card key={g.id} className="overflow-hidden"><div className="aspect-[3/4]"><GarmentThumb garment={g} /></div><div className="p-3"><p className="truncate text-sm">{g.name}</p><Pill>{g.category}</Pill></div></Card>)}
        </div>
        <Card className="p-5"><p className="text-sm font-medium">Coverage</p><p className="mt-1 text-sm text-[var(--color-muted)]">This starter capsule contains {pieces.length} pieces for {days} days. Use Studio to swap any piece and confirm the complete outfit score for each occasion.</p></Card>
      </>}
    </div>
  );
}