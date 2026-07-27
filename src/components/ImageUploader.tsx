"use client";

import { useRef, useState } from "react";
import { deltaE2000, labToRgb, rgbToHex, rgbToLab, type Lab } from "@/lib/color/space";

const MAX_EDGE = 1400;

/**
 * Downscale in the browser before upload. A modern phone photo is 4-8MB; the
 * app only ever needs a thumbnail and a try-on input, so shipping the original
 * is pure waste on both ends of the wire.
 */
async function downscale(file: File): Promise<{ blob: Blob; canvas: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.88),
  );
  return { blob, canvas };
}

/**
 * Pull the garment's actual colours out of the photo.
 *
 * Two things make this work where a naive "average the pixels" doesn't: the
 * background is estimated from the border and excluded, and clustering happens
 * in CIELAB so a navy shirt on a white hanger doesn't average out to periwinkle.
 */
export function extractColors(canvas: HTMLCanvasElement, k = 3): { hex: string; share: number }[] {
  const size = 72;
  const small = document.createElement("canvas");
  small.width = size;
  small.height = size;
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const at = (x: number, y: number) => {
    const i = (y * size + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };

  // Background estimate: the median of the border ring.
  const border: Lab[] = [];
  for (let i = 0; i < size; i++) {
    for (const p of [at(i, 0), at(i, size - 1), at(0, i), at(size - 1, i)]) {
      if (p.a > 200) border.push(rgbToLab(p));
    }
  }
  const bg =
    border.length > 0
      ? {
          L: median(border.map((c) => c.L)),
          a: median(border.map((c) => c.a)),
          b: median(border.map((c) => c.b)),
        }
      : null;

  const points: Lab[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = at(x, y);
      if (p.a < 200) continue;
      const lab = rgbToLab(p);
      if (bg && deltaE2000(lab, bg) < 9) continue;
      points.push(lab);
    }
  }
  if (points.length < 30) return [];

  // k-means++ style seeding: spread the initial centroids out so a photo with
  // one dominant colour doesn't collapse every cluster onto the same point.
  let centroids: Lab[] = [points[Math.floor(points.length / 2)]];
  while (centroids.length < k) {
    let best = points[0];
    let bestDist = -1;
    for (const p of points) {
      const d = Math.min(...centroids.map((c) => deltaE2000(p, c)));
      if (d > bestDist) {
        bestDist = d;
        best = p;
      }
    }
    centroids.push(best);
  }

  const assignment = new Array(points.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let bestIdx = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = deltaE2000(points[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestIdx = c;
        }
      }
      if (assignment[i] !== bestIdx) {
        assignment[i] = bestIdx;
        moved = true;
      }
    }
    centroids = centroids.map((old, c) => {
      const members = points.filter((_, i) => assignment[i] === c);
      if (!members.length) return old;
      return {
        L: mean(members.map((m) => m.L)),
        a: mean(members.map((m) => m.a)),
        b: mean(members.map((m) => m.b)),
      };
    });
    if (!moved) break;
  }

  const counts = centroids.map((_, c) => assignment.filter((a) => a === c).length);
  const total = counts.reduce((s, n) => s + n, 0) || 1;

  return centroids
    .map((c, i) => ({ lab: c, share: counts[i] / total }))
    .filter((x) => x.share > 0.12)
    .sort((a, b) => b.share - a.share)
    .slice(0, 2)
    .map((x) => ({ hex: rgbToHex(labToRgb(x.lab)), share: Math.round(x.share * 100) / 100 }));
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function ImageUploader({
  imageIds,
  onChange,
  onColors,
  kind = "garment",
  hint,
  max = 4,
}: {
  imageIds: string[];
  onChange: (ids: string[]) => void;
  /** Fired with the dominant colours of the first uploaded image. */
  onColors?: (colors: { hex: string; share: number }[]) => void;
  kind?: string;
  hint?: string;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const next = [...imageIds];

    try {
      for (const file of Array.from(files).slice(0, max - imageIds.length)) {
        const { blob, canvas } = await downscale(file);

        if (onColors && next.length === 0) {
          const colors = extractColors(canvas);
          if (colors.length) onColors(colors);
        }

        const form = new FormData();
        form.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
        form.append("kind", kind);

        const res = await fetch("/api/images", { method: "POST", body: form });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Upload failed");
        }
        const { id } = await res.json();
        next.push(id);
      }
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        {imageIds.map((id) => (
          <div key={id} className="group relative h-28 w-24 overflow-hidden rounded-lg border border-[var(--color-line)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/images/${id}`} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(imageIds.filter((x) => x !== id))}
              className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
            >
              Remove
            </button>
          </div>
        ))}

        {imageIds.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex h-28 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--color-line)] text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
          >
            {busy ? "Uploading…" : (<><span className="text-lg leading-none">+</span><span>Add photo</span></>)}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={max > 1}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {hint && <p className="mt-2 text-xs text-[var(--color-faint)]">{hint}</p>}
      {error && <p className="mt-2 text-xs text-[var(--color-bad)]">{error}</p>}
    </div>
  );
}
