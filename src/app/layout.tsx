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
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex items-center gap-3 py-3 sm:gap-6 sm:py-4">
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
                  {/*
                    Inline only where seven pills actually fit. Below that they
                    move to their own scrolling row underneath, rather than
                    wrapping into a column that pushed the page's first
                    heading off the bottom of a phone screen.
                  */}
                  <div className="hidden min-w-0 flex-1 lg:flex">
                    <Nav />
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
                    <Link
                      href="/wardrobe/new"
                      className="flex min-h-11 items-center rounded-full bg-[var(--color-ink)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-deep)] active:scale-[0.98]"
                    >
                      Add<span className="hidden sm:inline">&nbsp;item</span>
                    </Link>
                    <AccountMenu email={user.email} />
                  </div>
                </>
              ) : (
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Link
                    href="/login"
                    className="flex min-h-11 items-center rounded-full px-4 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-raised)]"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/signup"
                    className="flex min-h-11 items-center rounded-full bg-[var(--color-ink)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-deep)] active:scale-[0.98]"
                  >
                    Create<span className="hidden sm:inline">&nbsp;account</span>
                  </Link>
                </div>
              )}
            </div>

            {user && (
              <div className="lg:hidden">
                <Nav layout="strip" />
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>

        <footer className="mx-auto max-w-6xl border-t border-[var(--color-line)] px-4 py-8 text-sm text-[var(--color-faint)] sm:px-6">
          Every score on this site is arithmetic over your measurements, not a
          guess from a model. Open any verdict to see the numbers behind it.
        </footer>
      </body>
    </html>
  );
}
