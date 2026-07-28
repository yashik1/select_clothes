"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/auth/${signup ? "signup" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      // A full navigation, not a client-side push: every page reads the session
      // on the server, so the router cache has to be dropped.
      window.location.href = "/";
      return;
    }

    const payload = await res.json().catch(() => ({}));
    setError(payload.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="display text-4xl">
        {signup ? "Create an account" : "Sign in"}
      </h1>
      <p className="mt-3 text-[1.0625rem] text-[var(--color-muted)]">
        {signup
          ? "Your measurements and wardrobe are private to your account."
          : "Welcome back."}
      </p>

      <Card className="mt-8 p-7">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={signup ? 10 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
            />
            {signup && (
              <p className="mt-1 text-xs text-[var(--color-faint)]">
                At least 10 characters. Length is what matters — a short phrase beats
                a mangled word.
              </p>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10 p-2.5 text-sm text-[var(--color-bad)]"
            >
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full justify-center py-3">
            {busy ? "One moment…" : signup ? "Create account" : "Sign in"}
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-sm text-[var(--color-muted)]">
        {signup ? "Already have an account? " : "No account yet? "}
        <Link
          href={signup ? "/login" : "/signup"}
          className="font-medium text-[var(--color-text)] underline underline-offset-4"
        >
          {signup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}
