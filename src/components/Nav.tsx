"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PRIMARY = [
  { href: "/", label: "Today", icon: "⌂" },
  { href: "/wardrobe", label: "Wardrobe", icon: "▦" },
  { href: "/studio", label: "Studio", icon: "✦" },
  { href: "/calendar", label: "Planner", icon: "□" },
];

const MORE = [
  { href: "/gaps", label: "Wardrobe gaps" },
  { href: "/pack", label: "Packing" },
  { href: "/insights", label: "Style insights" },
  { href: "/try-on", label: "Virtual try-on" },
  { href: "/shop-check", label: "Shop Check" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/capsule", label: "Capsule builder" },
  { href: "/inspiration", label: "Inspiration" },
  { href: "/profile", label: "Profile & measurements" },
];

function activePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <>
      <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
        {PRIMARY.map((item) => {
          const active = activePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={"group flex min-h-10 items-center gap-2 rounded-full px-4 text-sm transition-colors " +
                (active
                  ? "bg-[var(--color-ink)] text-white"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]")}
            >
              <span aria-hidden className={"text-xs " + (active ? "opacity-80" : "opacity-50")}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        <details className="relative">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-full px-4 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]">
            More <span aria-hidden className="text-xs">⌄</span>
          </summary>
          <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-2 shadow-[0_18px_50px_-18px_rgba(50,48,47,0.3)]">
            <p className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">Explore FitCheck</p>
            {MORE.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={"flex min-h-10 items-center rounded-xl px-3 text-sm transition-colors " +
                  (activePath(pathname, item.href)
                    ? "bg-[var(--color-raised)] text-[var(--color-text)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]")}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </details>
      </nav>

      <nav aria-label="Mobile primary" className="fixed inset-x-3 bottom-3 z-50 flex rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)]/95 p-1.5 shadow-[0_14px_40px_-16px_rgba(50,48,47,0.35)] backdrop-blur-xl lg:hidden">
        {PRIMARY.map((item) => {
          const active = activePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={"flex min-h-12 flex-1 flex-col items-center justify-center rounded-xl gap-0.5 text-[10px] font-medium " +
                (active ? "bg-[var(--color-ink)] text-white" : "text-[var(--color-muted)]")}
            >
              <span aria-hidden className="text-sm">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
        <details className="relative flex min-h-12 flex-1">
          <summary className="flex w-full cursor-pointer list-none flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium text-[var(--color-muted)]">
            <span aria-hidden className="text-sm">•••</span>
            More
          </summary>
          <div className="absolute bottom-14 right-0 w-60 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-2 shadow-[0_18px_50px_-18px_rgba(50,48,47,0.3)]">
            {MORE.map((item) => (
              <Link key={item.href} href={item.href} className="flex min-h-10 items-center rounded-xl px-3 text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface)]">
                {item.label}
              </Link>
            ))}
          </div>
        </details>
      </nav>
    </>
  );
}