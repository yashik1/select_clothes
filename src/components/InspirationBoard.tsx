"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { Status, useStatus } from "@/components/Status";
import { thumbnailDataUrl } from "@/components/ImageUploader";

/*
 * Reference images, kept in the browser.
 *
 * Worth being plain about the compromise: this is the only thing in FitCheck
 * that does not live in Postgres. Everything else is a row, which is why a
 * `pg_dump` is a complete backup and why the account export is a complete copy.
 * These are not — they are on this device, in this browser, and they are not in
 * the export and do not go when the account does. Moving them into `image` like
 * every other picture is the right next step.
 *
 * Until then the two things that made it lose your work are fixed: the photo is
 * shrunk to a thumbnail before it is stored, and every write is guarded.
 */

const KEY = "fitcheck:inspiration:v1";

/**
 * Twenty, not thirty.
 *
 * At roughly 110KB stored per thumbnail this is about 2.2MB of a ~5MB budget,
 * which leaves room for the wishlist and whatever else shares the origin.
 */
const MAX_LOOKS = 20;

type Look = { id: string; name: string; dataUrl: string; createdAt: string };

function load(): Look[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * Returns false rather than throwing when the browser refuses.
 *
 * `setItem` throws `QuotaExceededError` when the origin is full, and in Safari's
 * private mode it throws whatever you do. The old code called it bare inside a
 * `FileReader.onload`, where nothing was catching — and because the state had
 * already been set, the picture appeared on screen, was never written, and was
 * simply gone on the next load. Silent data loss is the worst failure mode
 * available, so this one reports.
 */
function save(looks: Look[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(looks));
    return true;
  } catch {
    return false;
  }
}

export function InspirationBoard() {
  const [looks, setLooks] = useState<Look[]>([]);
  const [busy, setBusy] = useState(false);
  const status = useStatus();

  useEffect(() => setLooks(load()), []);

  async function add(file: File) {
    setBusy(true);
    try {
      const dataUrl = await thumbnailDataUrl(file);
      if (!dataUrl) {
        status.fail("This browser can't read that image format. A JPEG or PNG will work.");
        return;
      }

      /*
       * Read from storage rather than from `looks`. Two pictures chosen in
       * quick succession both resolve against whatever the state was when they
       * started, so the second would drop the first.
       */
      const next: Look[] = [
        {
          id:
            globalThis.crypto?.randomUUID?.() ??
            // `randomUUID` needs a secure context: over plain http on a LAN
            // address it is undefined, and calling it throws.
            `look-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          name: file.name.replace(/\.[^.]+$/, "") || "Untitled",
          dataUrl,
          createdAt: new Date().toISOString(),
        },
        ...load(),
      ].slice(0, MAX_LOOKS);

      if (!save(next)) {
        status.fail(
          "There's no room left in this browser's storage. Remove a few references and try again.",
        );
        return;
      }
      setLooks(next);
      status.say("Saved.");
    } finally {
      setBusy(false);
    }
  }

  function remove(id: string) {
    const next = load().filter((x) => x.id !== id);
    if (!save(next)) {
      status.fail("Couldn't update this browser's storage.");
      return;
    }
    setLooks(next);
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
        <p className="mt-3 text-xs text-[var(--color-faint)]">
          {looks.length} of {MAX_LOOKS} saved. These are kept in this browser, not in your account —
          they won&rsquo;t appear on another device or in your data export.
        </p>
      </Card>

      {looks.length === 0 ? (
        <Card className="p-8 text-sm text-[var(--color-muted)]">No inspiration saved yet.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {looks.map((look) => (
            <Card key={look.id} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={look.dataUrl} alt={look.name} className="aspect-[3/4] w-full object-cover" />
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
                    onClick={() => remove(look.id)}
                    className="min-h-10 text-xs text-[var(--color-muted)]"
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
