"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ProviderStatus } from "@/lib/tryon";
import { Button, Card } from "./ui";
import { Status, useStatus } from "./Status";
import { CameraCapture, canvasToJpeg, shrinkFile } from "./ImageUploader";

/**
 * See a garment on your own photograph.
 *
 * The figure beside this is drawn from measurements and answers whether the
 * thing fits. This answers a different question — what it looks like on you —
 * and it is worth being clear which is which, because a generated picture is
 * confident about drape it cannot possibly know. So the render sits next to
 * the arithmetic rather than replacing it, and says so.
 *
 * The photo is taken here rather than only on the profile page because this is
 * where the thought occurs. It is still saved to the profile: one photo of
 * you, reused by every garment and by the studio, replaceable from anywhere.
 */
export function TryOnPhoto({
  garmentId,
  garmentName,
  hasGarmentPhoto,
  initialPhotoId,
}: {
  garmentId: string;
  garmentName: string;
  hasGarmentPhoto: boolean;
  initialPhotoId: string | null;
}) {
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [photoId, setPhotoId] = useState(initialPhotoId);
  const [camera, setCamera] = useState(false);
  const [liveCamera, setLiveCamera] = useState(false);
  const [busy, setBusy] = useState<"photo" | "render" | null>(null);
  const [render, setRender] = useState<{ image: string; cached: boolean } | null>(null);
  const status = useStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  /*
   * Whether a render is even possible is a property of the deployment, so it
   * is asked once and the whole panel is shaped by the answer. Offering a
   * camera that leads to "no provider configured" wastes somebody's time and
   * their photo.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/tryon")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && j && setProvider(j.provider))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Decided after mount: `navigator` doesn't exist on the server, and
  // getUserMedia is absent outside a secure context, which is every plain-HTTP
  // deployment.
  useEffect(() => {
    setLiveCamera(Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext);
  }, []);

  async function attach(blob: Blob) {
    setBusy("photo");
    status.busy("Saving your photo…");
    try {
      const form = new FormData();
      form.append("file", new File([blob], "you.jpg", { type: "image/jpeg" }));
      form.append("kind", "body");
      const up = await fetch("/api/images", { method: "POST", body: form });
      const upJson = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upJson.error ?? "That photo couldn't be saved.");

      const set = await fetch("/api/profile/photo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: upJson.id }),
      });
      const setJson = await set.json().catch(() => ({}));
      if (!set.ok) throw new Error(setJson.error ?? "That photo couldn't be saved.");

      setPhotoId(upJson.id);
      // A new body means every render of the old one is wrong, and the server
      // has just thrown them away — so this one goes too.
      setRender(null);
      status.say("Photo saved. It's used for every garment, not just this one.");
    } catch (err) {
      status.fail(err instanceof Error ? err.message : "That photo couldn't be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    // Shrunk in the browser where possible; the original goes up when the
    // browser can't decode it (HEIC, TIFF) and the server converts instead.
    const shrunk = await shrinkFile(file);
    await attach(shrunk?.blob ?? file);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onShot(canvas: HTMLCanvasElement) {
    setCamera(false);
    await attach(await canvasToJpeg(canvas));
  }

  async function run(refresh = false) {
    setBusy("render");
    status.busy(refresh ? "Rendering again…" : "Putting it on you — this takes a few seconds…");
    try {
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ garmentIds: [garmentId], refresh }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "The render failed.");
      if (!json.ok) throw new Error(json.error ?? "The render failed.");

      setRender({ image: json.image, cached: Boolean(json.cached) });
      status.say(json.cached ? "Shown from the last render." : "Rendered.");
      // The picture is the answer, and it appeared below the button that was
      // just pressed — which nothing announces and a keyboard user has no way
      // to find except by tabbing past it.
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (err) {
      status.fail(err instanceof Error ? err.message : "The render failed.");
    } finally {
      setBusy(null);
    }
  }

  /* ------------------------------------------------------------ states -- */

  if (!provider) {
    return <Card className="p-5 text-sm text-[var(--color-muted)]">Checking…</Card>;
  }

  // Nothing here can work, so nothing here is offered.
  if (provider.id === "none" || !provider.configured) {
    return (
      <Card className="p-5">
        <p className="text-[0.9375rem]">Seeing it on your own photo needs a render service.</p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
          {provider.hint} The figure alongside needs none of that — no key, no account, no photo of
          you — and it is the one that answers whether this fits, because it is drawn from your
          measurements rather than guessed from a picture.
        </p>
      </Card>
    );
  }

  if (!hasGarmentPhoto) {
    return (
      <Card className="p-5">
        <p className="text-[0.9375rem]">This garment has no photo to put on you.</p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          A render needs a picture of the item itself.{" "}
          <Link
            href={`/wardrobe/${garmentId}/edit`}
            className="text-[var(--color-accent)] hover:underline"
          >
            Add one
          </Link>
          .
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      {photoId ? (
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/images/${photoId}`}
            alt="The photo of you that renders use"
            className="h-28 w-21 rounded-lg border border-[var(--color-line)] object-cover"
            style={{ width: "5.25rem" }}
          />
          <div className="min-w-48 flex-1">
            <p className="text-[0.9375rem]">Your photo is ready.</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              This is the picture every render uses. Replace it any time.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => run(false)} disabled={busy !== null}>
                {busy === "render" ? "Rendering…" : `See the ${garmentName.toLowerCase()} on me`}
              </Button>
              <Button
                variant="ghost"
                onClick={() => (liveCamera ? setCamera(true) : fileRef.current?.click())}
                disabled={busy !== null}
              >
                Retake
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[0.9375rem]">Take a photo of yourself and see it on you.</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
            Stand square to the camera, arms slightly away from your body, against a plain wall,
            with as much of you in frame as you can manage. It is taken once and used for every
            garment.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {liveCamera && (
              <Button onClick={() => setCamera(true)} disabled={busy !== null}>
                {busy === "photo" ? "Saving…" : "Use the camera"}
              </Button>
            )}
            <Button
              variant={liveCamera ? "ghost" : "primary"}
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
            >
              Choose a photo
            </Button>
          </div>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files)}
      />

      <Status {...status.props} className="mt-3" />

      {render && (
        <div
          ref={resultRef}
          tabIndex={-1}
          className="mt-4 outline-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={render.image}
            alt={`A render of you wearing ${garmentName}`}
            className="max-h-[30rem] rounded-xl border border-[var(--color-line)]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-xs text-[var(--color-faint)]">
              {render.cached
                ? "Kept from the last render, so this one was free."
                : "Freshly rendered and saved — opening this page again won't pay for it twice."}
            </p>
            <button
              onClick={() => run(true)}
              disabled={busy !== null}
              className="text-xs text-[var(--color-muted)] underline underline-offset-4 hover:text-[var(--color-text)] disabled:opacity-50"
            >
              Render it again
            </button>
          </div>
        </div>
      )}

      {/*
        Said before the button is pressed, not after. A photograph of somebody's
        body leaving the server is the one thing in this app that does that, and
        the profile page promises it happens only when a provider is switched
        on. Whoever is about to take that photo should be the one deciding.
      */}
      <p className="mt-4 border-t border-[var(--color-line-soft)] pt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
        Rendering sends your photo and the garment&apos;s photo to {provider.label}
        {provider.source === "inferred" && ", picked up from the API key set on this server"}, and
        costs about $0.075 each time. Nothing is sent until you press the button. Your photo stays
        on this server otherwise, and{" "}
        <Link href="/profile" className="underline underline-offset-2">
          removing it
        </Link>{" "}
        takes it and every render with it.
      </p>

      {camera && (
        <CameraCapture
          initialFacing="user"
          label="Take a photo of yourself"
          guide="Square to the camera, arms slightly out, as much of you in frame as fits."
          onCapture={onShot}
          onClose={() => setCamera(false)}
        />
      )}
    </Card>
  );
}
