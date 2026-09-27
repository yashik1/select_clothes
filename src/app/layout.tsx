import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/server/session";
import { AccountMenu } from "@/components/AccountMenu";
import { ClearLegacyStorage } from "@/components/ClearLegacyStorage";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Nav } from "@/components/Nav";
import { sans, serif } from "./fonts";

export const metadata: Metadata = {
  title: "FitCheck — will this actually work?",
  description:
    "Your wardrobe and your measurements, scored together. Explainable outfit advice grounded in centimetres, not vibes.",
  // `manifest.ts` generates the file; this is the link element that points at it.
  manifest: "/manifest.webmanifest",
  applicationName: "FitCheck",
  appleWebApp: { capable: true, title: "FitCheck", statusBarStyle: "default" },
  // Only the Apple one. The browser tab icon is `src/app/icon.svg`, which Next
  // wires up by file convention, and declaring `icon` here as well would
  // replace it with a worse raster copy.
  icons: { apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }] },
};

export const viewport: Viewport = {
  // Matches the manifest's background, so an installed app's status bar and the
  // area behind a bounced scroll are the page colour rather than white.
  themeColor: "#faf8f5",
  width: "device-width",
  initialScale: 1,
  // Not locked: pinching a garment photo to look at a seam is a reasonable
  // thing to want, and disabling zoom is an accessibility failure besides.
  maximumScale: 5,
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
                    The nav is never inline any more, at any width.

                    It used to sit in this row above `lg`, which worked while
                    there were eight destinations. There are now thirteen, and
                    this header is capped at `max-w-6xl` — so after the wordmark
                    and the account controls there is about 700px for a nav that
                    wants 963px, and no viewport can change that, because the
                    cap is on the container rather than the window. The pills
                    duly overflowed and painted straight over the account block:
                    294px of overlap at every width from 1024 to 1920, and the
                    page scrolled sideways below 1100.

                    On its own row they fit across the full 1152px with room to
                    spare, still visible and still labelled. It costs about 45px
                    of header height on a desktop, which is the right trade
                    against a menu that hides where you are — and exactly what a
                    phone has been doing all along.
                  */}
                  <div className="ml-auto flex shrink-0 items-center gap-2">
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

            {/* At every width now, not just below `lg`. See above. */}
            {user && <Nav />}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-12 sm:pt-10">{children}</main>

        <footer className="mx-auto max-w-6xl border-t border-[var(--color-line)] px-4 py-8 text-sm text-[var(--color-faint)] sm:px-6">
          Every score on this site is arithmetic over your measurements, not a
          guess from a model. Open any verdict to see the numbers behind it.
        </footer>

        {/*
          Registers the service worker for everyone; only *offers* to install to
          someone already signed in. A person still deciding whether to make an
          account does not need a second thing to say no to.
        */}
        <InstallPrompt offer={Boolean(user)} />

        {/*
          Renders nothing. It is here rather than on the wishlist and
          inspiration pages because the person whose browser is still holding
          megabytes of their old board is the one who never opens that page.
        */}
        <ClearLegacyStorage />
      </body>
    </html>
  );
}
