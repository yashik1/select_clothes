import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/server/session";
import { AccountMenu } from "@/components/AccountMenu";
import { Nav } from "@/components/Nav";
import { sans, serif } from "./fonts";

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
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-surface)]/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
            <Link href="/" className="group flex shrink-0 items-center gap-2">
              <span
                aria-hidden
                className="display flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-ink)] text-sm text-white transition-transform duration-200 group-hover:-rotate-6"
              >
                F
              </span>
              <span className="display text-xl">FitCheck</span>
            </Link>

            {user ? (
              <>
                <Nav />
                <Link
                  href="/wardrobe/new"
                  className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-deep)] active:scale-[0.98]"
                >
                  Add item
                </Link>
                <AccountMenu email={user.email} />
              </>
            ) : (
              <div className="flex flex-1 justify-end gap-2">
                <Link
                  href="/login"
                  className="rounded-full px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-raised)]"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-deep)] active:scale-[0.98]"
                >
                  Create account
                </Link>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-12">{children}</main>

        <footer className="mx-auto max-w-6xl border-t border-[var(--color-line)] px-6 py-8 text-sm text-[var(--color-faint)]">
          Every score on this site is arithmetic over your measurements, not a
          guess from a model. Open any verdict to see the numbers behind it.
        </footer>
      </body>
    </html>
  );
}
