"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Today" },
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/studio", label: "Studio" },
  { href: "/calendar", label: "Calendar" },
  { href: "/gaps", label: "Gaps" },
  { href: "/pack", label: "Pack" },
  { href: "/insights", label: "Insights" },
  { href: "/try-on", label: "Try On" },
  { href: "/shop-check", label: "Shop Check" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/capsule", label: "Capsule" },
  { href: "/inspiration", label: "Inspiration" },
  { href: "/profile", label: "You" },
];

/**
 * Thirteen destinations, on their own row.
 *
 * There used to be a second `inline` shape that sat in the header row on a wide
 * window. It is gone, because it could no longer fit: the header is capped at
 * `max-w-6xl`, which leaves about 700px beside the wordmark and the account
 * controls, and thirteen pills want 963px. No viewport made that true, since
 * the cap is on the container rather than the window — so the row overflowed
 * and painted over the account block at every desktop width.
 *
 * On its own row the same pills fit inside 1152px with room to spare, and on a
 * phone the row scrolls sideways, which is what it always did.
 *
 * Sideways scrolling rather than a hamburger because the labels stay visible:
 * a menu that has to be opened hides where you are as well as where you could
 * go, and this is a bar people move along constantly rather than visit once.
 */
export function Nav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      // Bleeds to the container's edges so the first and last pill sit flush
      // with the same margin as everything else while the row itself scrolls
      // the full width. The negative margin has to track the container's own
      // padding, which steps up at `sm` — mismatched, the last pill stopped
      // 8px short of the content below it.
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 text-sm sm:-mx-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {NAV.map((item) => {
        // "/" would otherwise match every route; everything else matches its
        // own subtree, so a garment detail page still lights up Wardrobe.
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            // 44px tall: it is a thumb target, and this row is the one people
            // hit most often.
            className={`relative flex min-h-11 shrink-0 items-center justify-center rounded-full px-3.5 transition-colors ${
              active
                ? "text-[var(--color-text)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {active && (
              <span aria-hidden className="absolute inset-0 rounded-full bg-[var(--color-raised)]" />
            )}
            <span className="relative whitespace-nowrap">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
