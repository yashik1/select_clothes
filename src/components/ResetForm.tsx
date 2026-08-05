"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { FocusHeading, Status, useStatus } from "@/components/Status";

/* ------------------------------------------------------------- request -- */

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ delivery: "email" | "log" } | null>(null);
  const status = useStatus();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    status.busy("One moment…");
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
      status.fail(err instanceof Error ? err.message : "Something went wrong.");
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
            The form this replaced held focus. Without somewhere to put it,
            focus falls to the top of the document and the person who just
            pressed the button is told nothing at all.
          */}
          <FocusHeading className="text-lg font-medium">Check your email</FocusHeading>
          {/*
            Worded so it is true either way, and never says whether the address
            is registered — the sign-in form goes to some trouble not to, and
            "we couldn't find that account" here would give it away.
          */}
          <p className="mt-2 text-[0.9375rem]">
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

              <Status {...status.props} />

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

/**
 * Pulls the token out of `#token=…` and takes it out of the address bar.
 *
 * Null while it has not been read yet, which on the very first render is
 * always — the server has no fragment to render from, so anything derived from
 * it has to happen in an effect or the two renders disagree.
 */
function useTokenFromFragment(): { token: string | null; read: boolean } {
  const [state, setState] = useState<{ token: string | null; read: boolean }>({
    token: null,
    read: false,
  });

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    /*
     * The query string is still read, though nothing generates it any more.
     * Links sent in the 45 minutes before this change deploys carry `?token=`
     * and are still perfectly valid; refusing them would tell people with a
     * working link that it was broken. Some mail security gateways also
     * unwrap and reissue URLs in a way that drops the fragment, and this is
     * the only thing standing between that and an unusable reset.
     */
    const query = new URLSearchParams(window.location.search).get("token");
    const token = fragment ?? query;
    setState({ token, read: true });

    if (token) {
      /*
       * Out of the address bar, so it does not end up in browser history, in a
       * screenshot, or in the URL the next person to borrow this laptop finds
       * in the autocomplete list. The token is in state by now; the page does
       * not need the URL again.
       */
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  return state;
}

export function ResetForm() {
  const { token, read } = useTokenFromFragment();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const status = useStatus();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    status.busy("One moment…");
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
      status.fail(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  // Nothing at all until the fragment has been read, rather than a flash of
  // "that link is incomplete" at everyone who followed a perfectly good link.
  if (!read) return <div className="mx-auto max-w-md py-10" aria-busy="true" />;

  if (!token) {
    return (
      <div className="mx-auto max-w-md py-10">
        <FocusHeading className="display text-4xl">That link is incomplete</FocusHeading>
        <Card className="mt-6 p-5 text-[0.9375rem]">
          <p>
            The address is missing its token, which usually means a mail client broke the link
            across two lines. Copy the whole thing, or ask for a new one.
          </p>
          <p className="mt-4">
            <Link href="/forgot" className="underline underline-offset-4">
              Send a new link
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md py-10">
        <FocusHeading className="display text-4xl">Password changed</FocusHeading>
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

          <Status {...status.props} />

          <Button type="submit" disabled={busy || !password} className="w-full">
            {busy ? "One moment…" : "Set the password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
