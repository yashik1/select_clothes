"use client";

import { useState } from "react";

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
      <span className="hidden text-xs text-[var(--color-faint)] sm:inline" title={email}>
        {email}
      </span>
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
