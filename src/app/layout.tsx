import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/server/session";
import { AccountMenu } from "@/components/AccountMenu";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "FitCheck — will this actually work?",
  description:
    "Your wardrobe and your measurements, scored together. Explainable outfit advice grounded in centimetres, not vibes.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Signed out, every nav link would only bounce back to /login, so the header
  // collapses to the wordmark and a way in.
  const user = await currentUser();

  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-ink)]/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
            <Link href="/" className="group flex shrink-0 items-center gap-2">
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-deep)] text-[13px] font-bold text-[var(--color-ink)] shadow-[0_4px_12px_-4px_var(--color-accent)] transition-transform duration-200 group-hover:rotate-6"
              >
                F
              </span>
              <span className="display text-lg font-semibold tracking-tight">
                Fit<span className="text-[var(--color-accent)]">Check</span>
              </span>
            </Link>

            {user ? (
              <>
                <Nav />
                <Link
                  href="/wardrobe/new"
                  className="rounded-lg bg-gradient-to-b from-[var(--color-accent)] to-[var(--color-accent-deep)] px-3.5 py-2 text-sm font-medium text-[var(--color-ink)] shadow-[0_6px_16px_-8px_var(--color-accent)] transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  Add item
                </Link>
                <AccountMenu email={user.email} />
              </>
            ) : (
              <div className="flex flex-1 justify-end gap-2">
                <Link
                  href="/login"
                  className="rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-gradient-to-b from-[var(--color-accent)] to-[var(--color-accent-deep)] px-3.5 py-2 text-sm font-medium text-[var(--color-ink)] shadow-[0_6px_16px_-8px_var(--color-accent)] transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  Create account
                </Link>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>

        <footer className="mx-auto max-w-6xl px-5 pb-10 pt-4 text-xs text-[var(--color-faint)]">
          Every score on this site is arithmetic over your measurements, not a
          guess from a model. Open any verdict to see the numbers behind it.
        </footer>
      </body>
    </html>
  );
}
