"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deltaE2000, labToRgb, rgbToHex, rgbToLab, type Lab } from "@/lib/color/space";

const MAX_EDGE = 1400;

/** Draws a source into a canvas no larger than MAX_EDGE, preserving aspect. */
function fitToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.88));

/**
 * Downscale in the browser before upload. A modern phone photo is 4-8MB; the
 * app only ever needs a thumbnail and a try-on input, so shipping the original
 * is pure waste on both ends of the wire.
 *
 * Returns null when the browser can't decode the format at all — Chrome has no
 * HEIC decoder, so every iPhone photo lands here, and no browser reads TIFF.
 * The caller then sends the original and lets the server convert it, which is
 * slower but always works.
 */
async function downscale(file: File): Promise<{ blob: Blob; canvas: HTMLCanvasElement } | null> {
  try {
    // `from-image` applies the EXIF orientation phones record instead of
    // rotating pixels; without it a photo taken sideways stays sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = fitToCanvas(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    return { blob: await toBlob(canvas), canvas };
  } catch {
    return null;
  }
}

/** Reads a stored image back, so colours can be pulled from what the server
 *  converted when the browser couldn't read the original. */
export function canvasFromUrl(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(fitToCanvas(img, img.naturalWidth, img.naturalHeight));
    img.onerror = () => reject(new Error("Could not read the stored image back."));
    img.src = url;
  });
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

/* ---------------------------------------------------------------- camera -- */

function cameraProblem(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow it for this site in your browser settings, or choose a file instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera found on this device.";
  }
  if (name === "NotReadableError") {
    return "The camera is already in use by another app.";
  }
  return "Couldn't start the camera. Choose a file instead.";
}

/**
 * A full-screen viewfinder. Full-screen because framing a whole garment on a
 * phone through a thumbnail-sized preview is miserable, and this is the moment
 * the photo is either square-on and evenly lit or it isn't.
 */
function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (canvas: HTMLCanvasElement) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [manyCameras, setManyCameras] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      stop();
      setReady(false);
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // `ideal` rather than `exact`: a laptop has no environment-facing
          // camera and an exact constraint would fail outright instead of
          // falling back to the one camera it does have.
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);

        // Device labels are only populated once permission is granted, which
        // is why this runs after the stream opens rather than before it.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setManyCameras(devices.filter((d) => d.kind === "videoinput").length > 1);
      } catch (err) {
        if (!cancelled) setError(cameraProblem(err));
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function shoot() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    onCapture(fitToCanvas(video, video.videoWidth, video.videoHeight));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Take a photo"
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-contain"
          // Framing yourself in an unmirrored preview is disorienting, so the
          // front camera is flipped for display. The captured frame is not,
          // because that is what the lens actually saw.
          style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
        />

        {!ready && !error && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Starting the camera…
          </p>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <p className="max-w-xs text-center text-sm leading-relaxed text-white/80">{error}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 px-6 py-5">
        <button
          type="button"
          onClick={onClose}
          className="min-w-20 text-left text-sm text-white/80 hover:text-white"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={shoot}
          disabled={!ready}
          aria-label="Take photo"
          className="h-16 w-16 rounded-full border-4 border-white/90 bg-white/20 transition-transform active:scale-95 disabled:opacity-40"
        />

        <div className="min-w-20 text-right">
          {manyCameras && (
            <button
              type="button"
              onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
              className="text-sm text-white/80 hover:text-white"
            >
              Flip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- uploader -- */

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [liveCamera, setLiveCamera] = useState(false);

  // Decided after mount, not during render: `navigator` doesn't exist on the
  // server, and getUserMedia is absent outside a secure context — which is
  // every plain-HTTP deployment.
  useEffect(() => {
    setLiveCamera(Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext);
  }, []);

  /**
   * One place where a photo becomes a stored image, whatever produced it.
   * `canvas` is null when the browser couldn't decode the file and the original
   * is being sent for the server to convert.
   */
  const upload = useCallback(
    async (payload: File, canvas: HTMLCanvasElement | null, ids: string[]): Promise<string> => {
      const form = new FormData();
      form.append("file", payload);
      form.append("kind", kind);

      const res = await fetch("/api/images", { method: "POST", body: form });

      if (!res.ok) {
        // A bare "Upload failed" hides whether the problem was the file, the
        // session, the size or the server. Anything the server said comes
        // through; if it said nothing, the status code does.
        const body = await res.text();
        let message = "";
        try {
          message = (JSON.parse(body) as { error?: string }).error ?? "";
        } catch {
          /* not JSON — a proxy or a crash */
        }
        if (!message) {
          message =
            res.status === 401 ? "Your session expired. Sign in again."
            : res.status === 413 ? "That image is too large for the server to accept."
            : `Upload failed (HTTP ${res.status}).`;
        }
        throw new Error(message);
      }

      const { id, url } = (await res.json()) as { id: string; url: string };

      // Colours come off whichever image we can actually read: the local one
      // when the browser decoded it, otherwise the converted one coming back.
      if (onColors && ids.length === 0) {
        try {
          const source = canvas ?? (await canvasFromUrl(url));
          const colors = extractColors(source);
          if (colors.length) onColors(colors);
        } catch {
          /* colour extraction is a convenience, never a reason to fail. */
        }
      }

      return id;
    },
    [kind, onColors],
  );

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const next = [...imageIds];

    try {
      for (const file of Array.from(files).slice(0, max - imageIds.length)) {
        const shrunk = await downscale(file);
        const payload = shrunk
          ? new File([shrunk.blob], "photo.jpg", { type: "image/jpeg" })
          : file;
        next.push(await upload(payload, shrunk?.canvas ?? null, next));
      }
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      // Both are cleared: picking the same file twice in a row fires no change
      // event otherwise, so a re-take would silently do nothing.
      if (inputRef.current) inputRef.current.value = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCapture(canvas: HTMLCanvasElement) {
    setCameraOpen(false);
    setBusy(true);
    setError(null);
    try {
      const next = [...imageIds];
      const blob = await toBlob(canvas);
      next.push(await upload(new File([blob], "photo.jpg", { type: "image/jpeg" }), canvas, next));
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function openCamera() {
    // Where getUserMedia isn't available, the capture attribute still opens the
    // phone's own camera app — which is the case that matters most.
    if (liveCamera) setCameraOpen(true);
    else inputRef.current?.click();
  }

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        {imageIds.map((id) => (
          <div key={id} className="group relative h-28 w-24 overflow-hidden rounded-2xl border border-[var(--color-line)]">
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
          <>
            <button
              type="button"
              onClick={openCamera}
              disabled={busy}
              className="flex h-28 w-24 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              {busy ? (
                "Uploading…"
              ) : (
                <>
                  <CameraIcon />
                  <span>Take photo</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="flex h-28 w-24 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              <span className="text-lg leading-none">+</span>
              <span>Choose file</span>
            </button>
          </>
        )}
      </div>

      {/* The camera fallback: on a phone without getUserMedia this still opens
          the native camera rather than the photo library. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif,.avif,.tif,.tiff"
        multiple={max > 1}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {hint && <p className="mt-2 text-xs text-[var(--color-faint)]">{hint}</p>}
      {error && <p className="mt-2 text-xs text-[var(--color-bad)]">{error}</p>}

      {cameraOpen && (
        <CameraCapture onCapture={handleCapture} onClose={() => setCameraOpen(false)} />
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1 1 0 0 0 .83-.45l.94-1.4A1 1 0 0 1 9.3 4.7h5.4a1 1 0 0 1 .83.45l.94 1.4a1 1 0 0 0 .83.45h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}
