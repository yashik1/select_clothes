"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";

const KEY = "fitcheck:inspiration:v1";
type Look = { id: string; name: string; dataUrl: string; createdAt: string };

export function InspirationBoard() {
  const [looks, setLooks] = useState<Look[]>([]);
  useEffect(() => { try { setLooks(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {} }, []);

  function add(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const next: Look[] = [{ id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ""), dataUrl: String(reader.result), createdAt: new Date().toISOString() }, ...looks].slice(0, 30);
      setLooks(next); localStorage.setItem(KEY, JSON.stringify(next));
    };
    reader.readAsDataURL(file);
  }

  function remove(id: string) {
    const next = looks.filter((x) => x.id !== id);
    setLooks(next); localStorage.setItem(KEY, JSON.stringify(next));
  }

  return (
    <div className="space-y-6">
      <SectionTitle hint="Save outfit references from social media, shops or friends. The next step is mapping the pieces to your wardrobe in Studio.">Inspiration</SectionTitle>
      <Card className="p-5">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-[var(--color-ink)] px-4 text-sm text-white">
          Add outfit image
          <input className="sr-only" type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && add(e.target.files[0])} />
        </label>
      </Card>
      {looks.length === 0 ? <Card className="p-8 text-sm text-[var(--color-muted)]">No inspiration saved yet.</Card> :
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {looks.map((look) => <Card key={look.id} className="overflow-hidden"><img src={look.dataUrl} alt={look.name} className="aspect-[3/4] w-full object-cover" /><div className="p-4"><p className="truncate text-sm font-medium">{look.name}</p><div className="mt-3 flex gap-2"><Link href="/studio" className="inline-flex min-h-10 items-center rounded-full bg-[var(--color-ink)] px-4 text-xs text-white">Recreate in Studio</Link><button onClick={() => remove(look.id)} className="text-xs text-[var(--color-muted)]">Remove</button></div></div></Card>)}
        </div>}
    </div>
  );
}