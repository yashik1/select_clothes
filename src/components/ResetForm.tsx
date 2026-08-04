"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";

/* ------------------------------------------------------------- request -- */

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ delivery: "email" | "log" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Something went wrong. Try again.");
      setSent({ delivery: payload.delivery === "email" ? "email" : "log" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="display text-4xl">Reset your password</h1>

      {sent ? (
        <Card className="mt-6 p-5">
          {/*
            Worded so it is true either way, and never says whether the address
            is registered — the sign-in form goes to some trouble not to, and
            "we couldn't find that account" here would give it away.
          */}
          <p className="text-[0.9375rem]">
            If there&apos;s an account for <strong className="font-medium">{email}</strong>, a link
            to set a new password is on its way. It works once and expires in 45 minutes.
          </p>
          {sent.delivery === "log" && (
            <p className="mt-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] p-3 text-xs leading-relaxed text-[var(--color-muted)]">
              This instance has no mail provider configured, so nothing was actually emailed — the
              link was written to the server log instead. Whoever runs this server can read it out;
              set <code className="tabular">RESEND_API_KEY</code> to send it properly.
            </p>
          )}
          <p className="mt-4 text-sm">
            <Link href="/login" className="underline underline-offset-4">
              Back to sign in
            </Link>
          </p>
        </Card>
      ) : (
        <>
          <p className="mt-3 text-[1.0625rem] text-[var(--color-muted)]">
            Enter your address and we&apos;ll send a link to set a new one.
          </p>
          <Card className="mt-6 p-5">
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
                />
              </div>

              {error && (
                <p role="alert" className="text-xs text-[var(--color-bad)]">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={busy || !email.trim()} className="w-full">
                {busy ? "One moment…" : "Send the link"}
              </Button>
            </form>
          </Card>
          <p className="mt-5 text-sm text-[var(--color-muted)]">
            Remembered it?{" "}
            <Link href="/login" className="text-[var(--color-text)] underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- finish -- */

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Something went wrong. Try again.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md py-10">
        <h1 className="display text-4xl">Password changed</h1>
        <Card className="mt-6 p-5">
          <p className="text-[0.9375rem]">
            Every device that was signed in has been signed out, including this one. Sign in again
            with the new password.
          </p>
          <div className="mt-4">
            <Button href="/login">Sign in</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="display text-4xl">Choose a new password</h1>
      <Card className="mt-6 p-5">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-medium text-[var(--color-muted)]"
            >
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1 text-xs text-[var(--color-faint)]">
              Length is the only rule. A short phrase beats a mangled word.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-[var(--color-bad)]">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy || !password} className="w-full">
            {busy ? "One moment…" : "Set the password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
