import Link from "next/link";
import type { Garment, Reason, Severity, SubScore, Verdict } from "@/lib/types";
import { contrastText } from "@/lib/color/space";

/* ------------------------------------------------------------- primitives -- */

/**
 * A card is a lit surface, not an outline. The gradient plus the hairline
 * highlight along the top edge is what separates it from the page — a 1px
 * border on a near-identical grey does not.
 */
export function Card({
  children,
  className = "",
  as: Tag = "div",
  interactive = false,
  delay,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "li";
  /** Lifts toward the pointer. Only for cards that are actually clickable. */
  interactive?: boolean;
  /** Milliseconds to stagger the entrance by. */
  delay?: number;
}) {
  return (
    <Tag
      style={delay !== undefined ? ({ "--delay": `${delay}ms` } as React.CSSProperties) : undefined}
      className={[
        "relative rounded-3xl border border-[var(--color-line)] bg-[var(--color-paper)]",
        "shadow-[0_1px_2px_rgba(50,48,47,0.04)]",
        delay !== undefined ? "rise" : "",
        interactive
          ? "transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-[#d2ccc2] hover:shadow-[0_10px_30px_-12px_rgba(50,48,47,0.18)] active:scale-[0.995]"
          : "",
        className,
      ].join(" ")}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h2 className="display text-[1.75rem] leading-tight">{children}</h2>
        {hint && <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--color-muted)]">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

const SEVERITY_COLOR: Record<Severity, string> = {
  good: "var(--color-good)",
  info: "var(--color-info)",
  warn: "var(--color-warn)",
  bad: "var(--color-bad)",
};

export function Dot({ severity }: { severity: Severity }) {
  return (
    <span
      aria-hidden
      className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: SEVERITY_COLOR[severity] }}
    />
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: Severity | "neutral" | "accent";
}) {
  const color =
    tone === "neutral" ? "var(--color-muted)"
    : tone === "accent" ? "var(--color-accent)"
    : SEVERITY_COLOR[tone];
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
      style={{
        color,
        // No border: on paper a tinted chip is already distinct, and an outline
        // as well makes a page of them look like a form.
        background: `color-mix(in srgb, ${color} 13%, white)`,
      }}
    >
      {children}
    </span>
  );
}

export function Empty({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <Card className="px-8 py-16 text-center">
      <p className="display text-2xl">{title}</p>
      <p className="mx-auto mt-3 max-w-md leading-relaxed text-[var(--color-muted)]">{body}</p>
      {cta && <div className="mt-7">{cta}</div>}
    </Card>
  );
}

export function Button({
  children,
  href,
  variant = "primary",
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  href?: string;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // Named properties rather than `all`: `all` transitions layout too, and the
  // press has to be instant to read as the button hearing the click.
  const base =
    "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium " +
    "transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] " +
    "active:scale-[0.97] disabled:active:scale-100";
  // Danger is filled rather than outlined on purpose: an irreversible action
  // should not look like a secondary one, and red text on a pale button reads
  // as a warning about the page rather than a description of the button.
  const styles =
    variant === "primary"
      ? "bg-[var(--color-ink)] text-white hover:bg-[var(--color-accent-deep)] disabled:bg-[var(--color-raised)] disabled:text-[var(--color-faint)]"
      : variant === "danger"
        ? "bg-[var(--color-bad)] text-white hover:brightness-95 disabled:bg-[var(--color-raised)] disabled:text-[var(--color-faint)]"
        : "border border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-text)] hover:border-[var(--color-ink)] disabled:text-[var(--color-faint)]";
  if (href) {
    return (
      <Link href={href} className={`${base} ${styles} ${className}`}>
        {children}
      </Link>
    );
  }
  return (
    <button className={`${base} ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- score -- */

const VERDICT_TONE: Record<Verdict, { color: string; from: string; label: string }> = {
  "wear-it": { color: "var(--color-good)", from: "#4bb87e", label: "Wear it" },
  close: { color: "var(--color-warn)", from: "var(--color-yellow)", label: "One tweak away" },
  skip: { color: "var(--color-bad)", from: "#e88a6f", label: "Skip it" },
};

/** The hue each scored dimension owns, so a score has a readable shape. */
const DIMENSION_COLOR: Record<string, string> = {
  fit: "var(--color-dim-fit)",
  color: "var(--color-dim-color)",
  proportion: "var(--color-dim-proportion)",
  formality: "var(--color-dim-formality)",
  weather: "var(--color-dim-weather)",
  novelty: "var(--color-dim-novelty)",
};

/**
 * The single most interesting number in the app, so it is allowed to behave
 * like it: a gradient arc that sweeps in from zero, over a glow that gets
 * stronger the better the score. The glow is the honest bit of theatre — it
 * only appears when the arithmetic says the outfit is actually good.
 */
export function ScoreRing({
  score,
  verdict,
  size = 92,
  animate = true,
}: {
  score: number;
  verdict: Verdict;
  size?: number;
  animate?: boolean;
}) {
  const stroke = Math.max(4, size / 9);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, score));
  const filled = (value / 100) * circumference;
  const t = VERDICT_TONE[verdict];
  const id = `ring-${verdict}-${Math.round(size)}`;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${Math.round(value)} out of 100 — ${t.label}`}
        className="relative"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={t.from} />
            <stop offset="100%" stopColor={t.color} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-raised)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={
            animate
              ? ({
                  // The arc grows from nothing. Declared in CSS so
                  // prefers-reduced-motion collapses it to an instant draw.
                  "--sweep-from": `${filled}`,
                  strokeDashoffset: 0,
                  animation: "sweep 0.9s cubic-bezier(0.22, 1, 0.36, 1) both",
                } as React.CSSProperties)
              : undefined
          }
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="tabular display"
          fontSize={size * 0.36}
          fill="var(--color-text)"
        >
          {Math.round(value)}
        </text>
      </svg>
    </div>
  );
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const t = VERDICT_TONE[verdict];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        color: t.color,
        background: `color-mix(in srgb, ${t.color} 12%, white)`,
      }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
      {t.label}
    </span>
  );
}

export function ConfidenceBar({ value, label = "Confidence" }: { value: number; label?: string }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[11px] text-[var(--color-faint)]">
        <span>{label}</span>
        <span className="tabular">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-raised)]">
        <div
          className="h-full rounded-full bg-[var(--color-muted)] transition-[width] duration-500"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function DimensionRow({ dimension }: { dimension: SubScore }) {
  const score = Math.round(dimension.score);
  const hue = DIMENSION_COLOR[dimension.key] ?? "var(--color-muted)";
  // The bar carries the dimension's own colour and fades out as the score
  // drops, so a weak dimension reads as weak without a second legend to learn.
  const strength = 0.35 + (score / 100) * 0.65;

  return (
    <div className="group flex items-center gap-3 py-2">
      <span className="flex w-24 shrink-0 items-center gap-2 text-sm text-[var(--color-muted)]">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: hue, opacity: strength }} />
        {dimension.label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-raised)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(2, score)}%`,
            // Solid, and paled toward paper as the score drops. A gradient to
            // transparent reads as a rendering artefact on white.
            background: `color-mix(in srgb, ${hue} ${Math.round(strength * 100)}%, white)`,
          }}
        />
      </div>
      <span className="tabular w-8 shrink-0 text-right text-sm font-medium" style={{ color: hue }}>
        {score}
      </span>
      <span
        className="tabular w-10 shrink-0 text-right text-[11px] text-[var(--color-faint)]"
        title={`We are ${Math.round(dimension.confidence * 100)}% confident in this dimension`}
      >
        ±{Math.round((1 - dimension.confidence) * 40)}
      </span>
    </div>
  );
}

export function ReasonRow({ reason }: { reason: Reason }) {
  return (
    <li className="flex gap-2.5 py-1.5">
      <Dot severity={reason.severity} />
      <div className="min-w-0">
        <p className="text-sm leading-snug">{reason.text}</p>
        {reason.fix && (
          <p className="mt-1 flex gap-1.5 text-sm leading-snug text-[var(--color-muted)]">
            <span aria-hidden className="text-[var(--color-faint)]">→</span>
            <span>{reason.fix}</span>
          </p>
        )}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------- garments -- */

export function Swatch({ hex, size = 14 }: { hex: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full border border-black/10"
      style={{ background: hex, width: size, height: size }}
      title={hex}
    />
  );
}

/** Thumbnail with a colour-block fallback, so items added without a photo
 *  still read at a glance in the grid. */
export function GarmentThumb({
  garment,
  className = "",
  share,
}: {
  garment: Garment;
  className?: string;
  /**
   * A share token, on the public page for a shared outfit. Photos are private
   * to their account, so without it the images there would all 404 — with it,
   * `/api/images` will serve exactly the ones this outfit's garments own.
   */
  share?: string;
}) {
  const imageId = garment.imageIds?.[0];
  if (imageId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={share ? `/api/images/${imageId}?share=${share}` : `/api/images/${imageId}`}
        alt={garment.name}
        className={`h-full w-full object-cover ${className}`}
        loading="lazy"
      />
    );
  }
  // No photo: the garment's own colours become the tile. A flat fill looked
  // like a missing image; a lit one looks deliberate, and the colour is real
  // information either way.
  const primary = garment.colors?.[0]?.hex ?? "#3a3f4a";
  const secondary = garment.colors?.[1]?.hex;
  return (
    <div
      className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`}
      style={{
        background: secondary
          ? `linear-gradient(150deg, ${primary} 0%, ${primary} 52%, ${secondary} 52%, ${secondary} 100%)`
          : primary,
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.16), transparent 46%, rgba(0,0,0,0.28))" }}
      />
      <span
        className="relative px-2 text-center text-[10px] font-medium uppercase tracking-wide opacity-80"
        style={{ color: contrastText(primary) }}
      >
        {garment.subcategory.replace(/-/g, " ")}
      </span>
    </div>
  );
}

export function GarmentChip({ garment }: { garment: Garment }) {
  return (
    <Link
      href={`/wardrobe/${garment.id}`}
      className="flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] py-1 pl-1 pr-3 text-xs transition-colors hover:border-[var(--color-ink)]"
    >
      <span className="h-7 w-7 overflow-hidden rounded-full">
        <GarmentThumb garment={garment} />
      </span>
      <span className="max-w-[11rem] truncate">{garment.name}</span>
    </Link>
  );
}
