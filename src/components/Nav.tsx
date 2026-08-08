"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Today" },
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/studio", label: "Studio" },
  { href: "/gaps", label: "Gaps" },
  { href: "/pack", label: "Pack" },
  { href: "/insights", label: "Insights" },
  { href: "/profile", label: "You" },
];

/**
 * Seven destinations, in two shapes.
 *
 * `inline` sits in the header row and is what a wide window gets. `strip`
 * gets its own row underneath and scrolls sideways, which is what a phone
 * gets — seven pills will not fit across 390px, and the alternative the
 * header used to reach for, wrapping, turned them into a seven-line column
 * that took three quarters of the screen before any content began.
 *
 * Sideways scrolling rather than a hamburger because the labels stay visible:
 * a menu that has to be opened hides where you are as well as where you could
 * go, and this is a bar people move along constantly rather than visit once.
 */
export function Nav({ layout = "inline" }: { layout?: "inline" | "strip" }) {
  const pathname = usePathname();
  const strip = layout === "strip";

  return (
    <nav
      aria-label="Sections"
      className={
        strip
          ? // Bleeds to the screen edges so the first and last pill can sit
            // flush with the same margin as everything else while the row
            // itself scrolls the full width.
            "-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex flex-1 items-center gap-0.5 text-sm"
      }
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
            className={`relative flex shrink-0 items-center justify-center rounded-full px-3.5 transition-colors ${
              // 44px on the strip: it is a thumb target, and the row it sits
              // in is the one people hit most often.
              strip ? "min-h-11" : "py-1.5"
            } ${
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
