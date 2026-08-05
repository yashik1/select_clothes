"use client";

import { useRef, useState } from "react";
import { Button, Card, SectionTitle } from "./ui";
import { Status, useStatus } from "./Status";

export function AccountSettings({ email, stats }: {
  email: string;
  stats: { garments: number; outfits: number; wearLogs: number; photos: number; photoBytes: number };
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <div>
        <h1 className="display text-4xl">Account</h1>
        <p className="mt-2 text-[1.0625rem] text-[var(--color-muted)]">
          Signed in as <span className="text-[var(--color-text)]">{email}</span>.
        </p>
      </div>

      <Held stats={stats} />
      <Export />
      <DangerZone />
    </div>
  );
}

/* ---------------------------------------------------------------- what -- */

function Held({ stats }: { stats: Parameters<typeof AccountSettings>[0]["stats"] }) {
  const rows: [string, string][] = [
    ["Garments", String(stats.garments)],
    ["Outfits", String(stats.outfits)],
    ["Days logged", String(stats.wearLogs)],
    [
      "Photos",
      stats.photos === 0
        ? "none"
        : `${stats.photos} · ${(stats.photoBytes / 1024 / 1024).toFixed(1)}MB`,
    ],
  ];

  return (
    <div>
      <SectionTitle>What we hold</SectionTitle>
      <Card className="p-5">
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[var(--color-faint)]">{label}</dt>
              <dd className="tabular text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- export -- */

function Export() {
  return (
    <div>
      <SectionTitle hint="Plain JSON — your measurements, every garment with its own measurements, every outfit, and the whole wear history.">
        Take a copy
      </SectionTitle>
      <Card className="p-5">
        <p className="text-[0.9375rem] text-[var(--color-muted)]">
          The file lists your photos with the address that serves them rather than the images
          themselves — inlining them would produce a file too large to open. Save the photos
          separately if you want them.
        </p>
        <div className="mt-4">
          {/*
            A plain link, not a fetch-and-blob: the browser already knows how to
            save a response with a filename on it, and doing it in JavaScript
            means holding the whole export in memory to achieve the same thing.
          */}
          <Button href="/api/account/export">Download my data</Button>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- delete -- */

const PHRASE = "delete";

function DangerZone() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const status = useStatus();
  const passwordRef = useRef<HTMLInputElement>(null);

  function reveal() {
    setOpen(true);
    // The field that appeared is where the person now has to act, so put the
    // caret there — otherwise focus is left on a button that just vanished,
    // which a screen reader reports as nothing at all.
    requestAnimationFrame(() => passwordRef.current?.focus());
  }

  async function destroy(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    status.clear();
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "That didn't work. Try again.");
      status.say("Account deleted. Signing you out.");
      // Full reload, so nothing rendered for the account that no longer exists
      // survives in the router cache.
      window.location.href = "/login";
    } catch (err) {
      status.fail(err instanceof Error ? err.message : "That didn't work.");
      setBusy(false);
    }
  }

  const ready = password.length > 0 && confirm.trim().toLowerCase() === PHRASE;

  return (
    <div>
      <SectionTitle>Delete this account</SectionTitle>
      <Card className="border-[var(--color-bad)] p-5">
        <p className="text-[0.9375rem]">
          Every garment, outfit, photo and logged day goes with it, immediately and permanently.
          There is no undo and no backup to ask for. Download a copy first if you might want one.
        </p>

        {open ? (
          <form onSubmit={destroy} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="delete-password"
                className="mb-1 block text-xs font-medium text-[var(--color-muted)]"
              >
                Your password
              </label>
              <input
                ref={passwordRef}
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="delete-confirm"
                className="mb-1 block text-xs font-medium text-[var(--color-muted)]"
              >
                Type <span className="tabular text-[var(--color-text)]">{PHRASE}</span> to confirm
              </label>
              <input
                id="delete-confirm"
                type="text"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            <Status {...status.props} />

            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={busy || !ready}>
                {busy ? "Deleting…" : "Delete everything"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Keep my account
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4">
            <Button variant="danger" onClick={reveal}>
              Delete my account
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
