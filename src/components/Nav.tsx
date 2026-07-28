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

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-wrap items-center gap-0.5 text-sm">
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
            className={`relative rounded-full px-3.5 py-1.5 transition-colors ${
              active
                ? "text-[var(--color-text)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {active && (
              <span aria-hidden className="absolute inset-0 rounded-full bg-[var(--color-raised)]" />
            )}
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
