import Link from "next/link";
import type { Garment, Reason, Severity, SubScore, Verdict } from "@/lib/types";
import { contrastText } from "@/lib/color/space";

/* ------------------------------------------------------------- primitives -- */

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag
      className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] ${className}`}
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
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="display text-xl font-semibold">{children}</h2>
        {hint && <p className="mt-0.5 text-sm text-[var(--color-muted)]">{hint}</p>}
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
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      {children}
    </span>
  );
}

export function Empty({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <Card className="p-10 text-center">
      <p className="display text-lg">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted)]">{body}</p>
      {cta && <div className="mt-5">{cta}</div>}
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
  variant?: "primary" | "ghost";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-[var(--color-accent)] text-[var(--color-ink)] hover:opacity-90"
      : "border border-[var(--color-line)] text-[var(--color-muted)] hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]";
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

const VERDICT_TONE: Record<Verdict, { color: string; label: string }> = {
  "wear-it": { color: "var(--color-good)", label: "Wear it" },
  close: { color: "var(--color-warn)", label: "One tweak away" },
  skip: { color: "var(--color-bad)", label: "Skip it" },
};

export function ScoreRing({
  score,
  verdict,
  size = 92,
}: {
  score: number;
  verdict: Verdict;
  size?: number;
}) {
  const stroke = size / 11;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color = VERDICT_TONE[verdict].color;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="tabular"
        fontSize={size * 0.3}
        fontWeight={600}
        fill="var(--color-text)"
      >
        {Math.round(score)}
      </text>
    </svg>
  );
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const t = VERDICT_TONE[verdict];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color: t.color, background: `color-mix(in srgb, ${t.color} 14%, transparent)` }}
    >
      {t.label}
    </span>
  );
}

export function ConfidenceBar({ value, label = "Confidence" }: { value: number; label?: string }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-[var(--color-faint)]">
        <span>{label}</span>
        <span className="tabular">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[var(--color-line)]">
        <div
          className="h-full rounded-full bg-[var(--color-muted)]"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function DimensionRow({ dimension }: { dimension: SubScore }) {
  const score = Math.round(dimension.score);
  const color =
    score >= 78 ? "var(--color-good)" : score >= 60 ? "var(--color-warn)" : "var(--color-bad)";
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-24 shrink-0 text-sm text-[var(--color-muted)]">{dimension.label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="tabular w-8 shrink-0 text-right text-sm" style={{ color }}>
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
          <p className="mt-0.5 text-sm leading-snug text-[var(--color-muted)]">→ {reason.fix}</p>
        )}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------- garments -- */

export function Swatch({ hex, size = 14 }: { hex: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full border border-white/15"
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
}: {
  garment: Garment;
  className?: string;
}) {
  const imageId = garment.imageIds?.[0];
  if (imageId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/images/${imageId}`}
        alt={garment.name}
        className={`h-full w-full object-cover ${className}`}
        loading="lazy"
      />
    );
  }
  const primary = garment.colors?.[0]?.hex ?? "#3a3f4a";
  const secondary = garment.colors?.[1]?.hex;
  return (
    <div
      className={`flex h-full w-full items-center justify-center ${className}`}
      style={{
        background: secondary
          ? `linear-gradient(135deg, ${primary} 0%, ${primary} 55%, ${secondary} 55%, ${secondary} 100%)`
          : primary,
      }}
    >
      <span
        className="px-2 text-center text-[10px] font-medium uppercase tracking-wide opacity-70"
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
      className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-raised)] py-1 pl-1 pr-2.5 text-xs transition-colors hover:border-[var(--color-accent)]"
    >
      <span className="h-7 w-7 overflow-hidden rounded-md">
        <GarmentThumb garment={garment} />
      </span>
      <span className="max-w-[11rem] truncate">{garment.name}</span>
    </Link>
  );
}
