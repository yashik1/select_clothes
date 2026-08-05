"use client";

import { useState } from "react";
import Link from "next/link";

export function AccountMenu({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    // Full reload rather than a router push, so no server-rendered page from
    // the signed-in session survives in the router cache.
    window.location.href = "/login";
  }

  return (
    <div className="flex items-center gap-2.5">
      {/*
        The address doubles as the way in to the account page. It was already
        the only place the signed-in identity appeared, and a separate "Account"
        link beside it would say the same thing twice.
      */}
      <Link
        href="/account"
        title={`${email} — account settings`}
        className="hidden max-w-[16ch] truncate rounded-md px-1.5 py-1 text-xs text-[var(--color-faint)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-text)] sm:inline-block"
      >
        {email}
      </Link>
      <button
        onClick={signOut}
        disabled={busy}
        className="rounded-md px-2 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-text)] disabled:opacity-50"
      >
        {busy ? "…" : "Sign out"}
      </button>
    </div>
  );
}
