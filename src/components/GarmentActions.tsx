"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CareState, FitVerdict, Garment } from "@/lib/types";
import { Button, Card } from "./ui";

const VERDICTS: { key: FitVerdict; label: string }[] = [
  { key: "too-tight", label: "Too tight" },
  { key: "snug", label: "A bit snug" },
  { key: "ideal", label: "Just right" },
  { key: "relaxed", label: "A bit loose" },
  { key: "too-loose", label: "Too loose" },
];

export function GarmentActions({ garment }: { garment: Garment }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/garments/${garment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ __patch: true, ...body }),
    });
    setBusy(false);
    router.refresh();
  }

  async function wearToday(verdict?: FitVerdict) {
    setBusy(true);
    await fetch("/api/wear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        garmentIds: [garment.id],
        date: new Date().toISOString(),
        fitFeedback: verdict ? [{ garmentId: garment.id, landmark: "overall", verdict }] : undefined,
      }),
    });
    setBusy(false);
    setFeedbackSent(true);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete "${garment.name}" permanently? This can't be undone.`)) return;
    setBusy(true);
    await fetch(`/api/garments/${garment.id}`, { method: "DELETE" });
    router.push("/wardrobe");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">
          How did it actually fit?
        </p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          One tap after wearing it. Answers here teach the app how{" "}
          {garment.brand ? garment.brand : "this brand"} sizes on your body, and that carries over
          to everything else you buy from them.
        </p>
        {feedbackSent ? (
          <p className="mt-3 text-sm text-[var(--color-good)]">
            Logged. Calibration updated.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {VERDICTS.map((v) => (
              <button
                key={v.key}
                disabled={busy}
                onClick={() => wearToday(v.key)}
                className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <p className="mb-1 text-xs font-medium text-[var(--color-muted)]">Availability</p>
          <select
            value={garment.careState}
            disabled={busy}
            onChange={(e) => patch({ careState: e.target.value as CareState })}
          >
            <option value="clean">Ready to wear</option>
            <option value="laundry">In the wash</option>
            <option value="repair">Needs repair</option>
            <option value="stored">Stored away</option>
            <option value="loaned">Lent out</option>
          </select>
          <p className="mt-1 text-xs text-[var(--color-faint)]">
            Anything not ready to wear is left out of suggestions.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="ghost" onClick={() => wearToday()} disabled={busy}>
            Wore it today
          </Button>
          <Button href={`/wardrobe/${garment.id}/edit`} variant="ghost">
            Edit
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => patch({ archivedAt: garment.archivedAt ? null : new Date().toISOString() })}
          >
            {garment.archivedAt ? "Restore" : "Archive"}
          </Button>
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-faint)] transition-colors hover:border-[var(--color-bad)] hover:text-[var(--color-bad)] disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </Card>
    </div>
  );
}
