import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "FitCheck — will this actually work?",
  description:
    "Your wardrobe and your measurements, scored together. Explainable outfit advice grounded in centimetres, not vibes.",
};

const NAV = [
  { href: "/", label: "Today" },
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/studio", label: "Studio" },
  { href: "/gaps", label: "Gaps" },
  { href: "/pack", label: "Pack" },
  { href: "/insights", label: "Insights" },
  { href: "/profile", label: "You" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-ink)]/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
            <Link href="/" className="display text-lg font-semibold tracking-tight">
              Fit<span className="text-[var(--color-accent)]">Check</span>
            </Link>
            <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2.5 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Link
              href="/wardrobe/new"
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-ink)] transition-opacity hover:opacity-90"
            >
              Add item
            </Link>
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
