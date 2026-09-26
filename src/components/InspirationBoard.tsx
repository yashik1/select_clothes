"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { Inspiration } from "@/lib/types";
import { Card, SectionTitle } from "@/components/ui";
import { Status, useStatus } from "@/components/Status";
import { shrinkFile } from "@/components/ImageUploader";

/*
 * Reference photos of other people's outfits.
 *
 * Rows now, with the picture in the `image` table like every other photo in
 * this app. It used to be base64 data URLs in `localStorage`, which was both
 * invisible from any other device and — because that store holds about 5MB per
 * origin and costs two bytes a character — smaller than a single phone photo.
 */

export function InspirationBoard({ initial }: { initial: Inspiration[] }) {
  const [looks, setLooks] = useState<Inspiration[]>(initial);
  const [busy, setBusy] = useState(false);
  const status = useStatus();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/inspiration");
      if (res.ok) setLooks(((await res.json()) as { items: Inspiration[] }).items);
    } catch {
      /* Keeps what is on screen. */
    }
  }, []);

  async function add(file: File) {
    setBusy(true);
    try {
      /*
       * Downscaled in the browser first, by the same helper the garment
       * uploader uses — so a reference photo gets the same treatment as
       * everything else: EXIF rotation applied, one quality setting, one size.
       * When the browser cannot decode the format at all (HEIC in Chrome, TIFF
       * anywhere) the original is sent and the server converts it instead.
       */
      const shrunk = await shrinkFile(file);
      const form = new FormData();
      form.append(
        "file",
        shrunk ? new File([shrunk.blob], "reference.jpg", { type: "image/jpeg" }) : file,
      );
      form.append("kind", "inspiration");

      const up = await fetch("/api/images", { method: "POST", body: form });
      if (!up.ok) {
        const body = (await up.json().catch(() => ({}))) as { error?: string };
        status.fail(body.error ?? "That image couldn’t be saved.");
        return;
      }
      const { id: imageId } = (await up.json()) as { id: string };

      const saved = await fetch("/api/inspiration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name.replace(/\.[^.]+$/, "") || "Reference",
          imageId,
        }),
      });
      if (!saved.ok) {
        const body = (await saved.json().catch(() => ({}))) as { error?: string };
        status.fail(body.error ?? "That reference couldn’t be saved.");
        return;
      }

      status.say("Saved.");
      await refresh();
    } catch {
      status.fail("That didn’t save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(look: Inspiration) {
    setBusy(true);
    try {
      const res = await fetch(`/api/inspiration/${look.id}`, { method: "DELETE" });
      if (!res.ok) {
        status.fail("Couldn’t remove that.");
        return;
      }
      status.say(`Removed ${look.name}.`);
      await refresh();
    } catch {
      status.fail("Couldn’t remove that — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionTitle hint="Save outfit references from social media, shops or friends. The next step is mapping the pieces to your wardrobe in Studio.">
        Inspiration
      </SectionTitle>

      <Status {...status.props} />

      <Card className="p-5">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-[var(--color-ink)] px-4 text-sm text-white">
          {busy ? "Adding…" : "Add outfit image"}
          <input
            className="sr-only"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so choosing the same file twice still fires a change.
              e.target.value = "";
              if (file) void add(file);
            }}
          />
        </label>
      </Card>

      {looks.length === 0 ? (
        <Card className="p-8 text-sm text-[var(--color-muted)]">No inspiration saved yet.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {looks.map((look) => (
            <Card key={look.id} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/images/${look.imageId}`}
                alt={look.name}
                className="aspect-[3/4] w-full object-cover"
                loading="lazy"
              />
              <div className="p-4">
                <p className="truncate text-sm font-medium">{look.name}</p>
                <div className="mt-3 flex gap-2">
                  <Link
                    href="/studio"
                    className="inline-flex min-h-10 items-center rounded-full bg-[var(--color-ink)] px-4 text-xs text-white"
                  >
                    Recreate in Studio
                  </Link>
                  <button
                    onClick={() => remove(look)}
                    disabled={busy}
                    className="min-h-10 text-xs text-[var(--color-muted)] disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
