"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FIBERS, describeFabric } from "@/lib/data/fabrics";
import {
  GARMENT_MEASURE_KEYS,
  MEASURE_META,
  subcategoriesFor,
  subcategoryDef,
} from "@/lib/data/garmentTypes";
import { SIZE_SYSTEM_LABELS, sizeOptions, suggestSize } from "@/lib/data/sizeCharts";
import { evaluateGarmentFit, verdictLabel } from "@/lib/engine/fit";
import { describeColor } from "@/lib/color/space";
import { formatDelta, fromDisplay, toDisplay, unitLabel } from "@/lib/units";
import type {
  CareState,
  FitPreference,
  Garment,
  GarmentCategory,
  GarmentMeasurements,
  Pattern,
  PatternScale,
  Profile,
  SizeSystem,
} from "@/lib/types";
import { Button, Card, Pill, SectionTitle, Swatch } from "./ui";
import { ImageUploader, canvasFromUrl, extractColors } from "./ImageUploader";
import type { ImportedProduct } from "@/lib/import/product";

const CATEGORIES: { key: GarmentCategory; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "dress", label: "Dress / one-piece" },
  { key: "outerwear", label: "Outerwear" },
  { key: "shoes", label: "Shoes" },
  { key: "accessory", label: "Accessory" },
  { key: "bag", label: "Bag" },
];

const PATTERNS: Pattern[] = ["solid", "stripe", "check", "floral", "geometric", "animal", "graphic", "texture"];
const SCALES: PatternScale[] = ["none", "micro", "medium", "bold"];
const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
const CARE: { key: CareState; label: string }[] = [
  { key: "clean", label: "Ready to wear" },
  { key: "laundry", label: "In the wash" },
  { key: "repair", label: "Needs repair" },
  { key: "stored", label: "Stored away" },
  { key: "loaned", label: "Lent out" },
];

const FIBER_KEYS = Object.keys(FIBERS);

function blank(profile: Profile): Garment {
  const now = new Date().toISOString();
  return {
    id: "",
    name: "",
    category: "top",
    subcategory: "t-shirt",
    colors: [{ hex: "#3a4756", share: 1 }],
    pattern: "solid",
    patternScale: "none",
    fabric: { cotton: 1 },
    formality: 1,
    fitIntent: "regular",
    measurements: {},
    seasons: [],
    careState: "clean",
    imageIds: [],
    wearCount: 0,
    lastWornAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function GarmentForm({ profile, initial }: { profile: Profile; initial?: Garment }) {
  const router = useRouter();
  const [g, setG] = useState<Garment>(initial ?? blank(profile));
  const [fabricRows, setFabricRows] = useState<{ fiber: string; pct: number }[]>(
    Object.entries(initial?.fabric ?? { cotton: 1 }).map(([fiber, pct]) => ({
      fiber,
      pct: Math.round(pct * 100),
    })),
  );
  const [showMeasurements, setShowMeasurements] = useState(
    Object.keys(initial?.measurements ?? {}).length > 0,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unit = profile.unit;
  const def = useMemo(() => subcategoryDef(g.subcategory, g.category), [g.subcategory, g.category]);
  const subcategories = useMemo(() => subcategoriesFor(g.category), [g.category]);

  const patch = (p: Partial<Garment>) => setG((prev) => ({ ...prev, ...p }));

  /**
   * Fills in what a product page could tell us, and nothing more.
   *
   * Only empty fields are written, so a link pasted after some typing can't
   * overwrite what the user already knows. The colours come from the stored
   * photo rather than the shop's colour word — "Navy" is not a value the
   * colour engine can do anything with.
   */
  async function applyImport(result: ImportResult) {
    const p = result.product;
    setG((prev) => {
      const next: Garment = { ...prev };
      if (p.name && !prev.name.trim()) next.name = p.name;
      if (p.brand && !prev.brand) next.brand = p.brand;
      if (p.size && !prev.size) next.size = p.size;
      if (p.retailer && !prev.retailer) next.retailer = p.retailer;
      if (p.currency && !prev.currency) next.currency = p.currency;
      if (typeof p.pricePaid === "number" && prev.pricePaid === undefined) next.pricePaid = p.pricePaid;
      next.productUrl = p.productUrl;
      if (p.category && p.subcategory) {
        next.category = p.category;
        next.subcategory = p.subcategory;
      }
      if (result.imageId && !prev.imageIds.includes(result.imageId)) {
        next.imageIds = [...prev.imageIds, result.imageId];
      }
      return next;
    });

    if (p.fabric && Object.keys(p.fabric).length) {
      setFabricRows(
        Object.entries(p.fabric).map(([fiber, share]) => ({
          fiber,
          pct: Math.round(share * 100),
        })),
      );
    }

    // Same-origin now that it is stored, so the canvas isn't tainted and the
    // colours can be read off it exactly as they are for an upload.
    if (result.imageId) {
      try {
        const canvas = await canvasFromUrl(`/api/images/${result.imageId}`);
        const colors = extractColors(canvas);
        if (colors.length) patch({ colors });
      } catch {
        // The photo is stored either way; the colour picker is still there.
      }
    }
  }

  /* Live fit preview — the same engine the server runs, executed as you type.
     Watching "too tight at the chest" appear the moment you enter a size is the
     moment the app justifies itself. */
  const fabric = useMemo(() => {
    const total = fabricRows.reduce((s, r) => s + r.pct, 0) || 1;
    return Object.fromEntries(fabricRows.filter((r) => r.pct > 0).map((r) => [r.fiber, r.pct / total]));
  }, [fabricRows]);

  const preview = useMemo(
    () => evaluateGarmentFit({ ...g, fabric }, profile),
    [g, fabric, profile],
  );

  const recommendedSize = useMemo(() => {
    if (!g.sizeSystem || g.sizeSystem === "free" || g.sizeSystem === "waist-inseam" || g.sizeSystem === "neck-sleeve") {
      return null;
    }
    return suggestSize(g.sizeSystem, profile.measurements, g.category);
  }, [g.sizeSystem, g.category, profile.measurements]);

  function changeCategory(category: GarmentCategory) {
    const first = subcategoriesFor(category)[0];
    patch({
      category,
      subcategory: first.key,
      formality: first.formality,
      seasons: first.seasons ?? [],
    });
  }

  function changeSubcategory(key: string) {
    const d = subcategoryDef(key, g.category);
    patch({ subcategory: key, formality: d.formality, seasons: d.seasons ?? g.seasons });
  }

  function setMeasurement(key: keyof GarmentMeasurements, raw: string) {
    setG((prev) => {
      const next = { ...prev.measurements };
      if (raw.trim() === "") delete next[key];
      else {
        const v = fromDisplay(raw, unit);
        if (v !== undefined) next[key] = v;
      }
      return { ...prev, measurements: next };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...g,
        fabric,
        brand: g.brand || undefined,
        size: g.size || undefined,
        productUrl: g.productUrl || undefined,
        gsm: g.gsm ?? null,
        pricePaid: g.pricePaid ?? null,
        rating: g.rating ?? null,
      };
      const res = await fetch(initial ? `/api/garments/${initial.id}` : "/api/garments", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const first = json.issues?.[0];
        throw new Error(first ? `${first.path?.join(".")}: ${first.message}` : json.error ?? "Save failed");
      }
      const { garment } = await res.json();
      router.push(`/wardrobe/${garment.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const relevantMeasures = GARMENT_MEASURE_KEYS.filter(
    (k) => def.ease[k] !== undefined || def.lengths[k] !== undefined,
  );

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold">{initial ? "Edit item" : "Add an item"}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            A name and a category is enough to start. Everything below sharpens the advice.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="max-w-xs text-xs text-[var(--color-bad)]">{error}</span>}
          <Button onClick={save} disabled={saving || !g.name.trim()}>
            {saving ? "Saving…" : "Save item"}
          </Button>
        </div>
      </div>

      {!initial && <ImportBar onImport={applyImport} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {/* ------------------------------------------------- photos -- */}
          <Card className="p-5">
            <p className="display mb-4 text-xl">Photos</p>
            <ImageUploader
              imageIds={g.imageIds}
              onChange={(imageIds) => patch({ imageIds })}
              onColors={(colors) => patch({ colors })}
              hint="Lay it flat on a plain background. Colours are read straight off the photo and filled in below."
            />
          </Card>

          {/* --------------------------------------------------- what -- */}
          <Card className="space-y-4 p-5">
            <p className="display text-xl">What is it?</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Name</Label>
                <input
                  type="text"
                  placeholder="Navy merino crewneck"
                  value={g.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
              <div>
                <Label>Brand</Label>
                <input
                  type="text"
                  placeholder="Optional — but this is what trains size calibration"
                  value={g.brand ?? ""}
                  onChange={(e) => patch({ brand: e.target.value })}
                />
              </div>
              <div>
                <Label>Category</Label>
                <select value={g.category} onChange={(e) => changeCategory(e.target.value as GarmentCategory)}>
                  {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Type</Label>
                <select value={g.subcategory} onChange={(e) => changeSubcategory(e.target.value)}>
                  {subcategories.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>
          </Card>

          {/* --------------------------------------------------- size -- */}
          <Card className="space-y-4 p-5">
            <p className="display text-xl">Size</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Sizing system</Label>
                <select
                  value={g.sizeSystem ?? "free"}
                  onChange={(e) => patch({ sizeSystem: e.target.value as SizeSystem })}
                >
                  {(Object.keys(SIZE_SYSTEM_LABELS) as SizeSystem[]).map((s) => (
                    <option key={s} value={s}>{SIZE_SYSTEM_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Size on the label</Label>
                {g.sizeSystem && sizeOptions(g.sizeSystem).length > 0 ? (
                  <select value={g.size ?? ""} onChange={(e) => patch({ size: e.target.value })}>
                    <option value="">—</option>
                    {sizeOptions(g.sizeSystem).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={g.sizeSystem === "waist-inseam" ? "32x32" : g.sizeSystem === "neck-sleeve" ? "15.5/34" : "e.g. M"}
                    value={g.size ?? ""}
                    onChange={(e) => patch({ size: e.target.value })}
                  />
                )}
                {recommendedSize && (
                  <p className="mt-1 text-xs text-[var(--color-faint)]">
                    On the standard chart your measurements point to {recommendedSize.size}.
                  </p>
                )}
              </div>
            </div>
            <div>
              <Label>How it's cut</Label>
              <div className="flex flex-wrap gap-1.5">
                {(["slim", "regular", "relaxed", "oversized"] as FitPreference[]).map((f) => (
                  <Choice key={f} active={g.fitIntent === f} onClick={() => patch({ fitIntent: f })}>
                    {f}
                  </Choice>
                ))}
              </div>
            </div>
          </Card>

          {/* -------------------------------------------------- colour -- */}
          <Card className="space-y-4 p-5">
            <p className="display text-xl">Colour and pattern</p>
            <div>
              <Label>Colours</Label>
              <div className="space-y-2">
                {g.colors.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="color"
                      className="!w-16"
                      value={c.hex}
                      onChange={(e) => {
                        const colors = [...g.colors];
                        colors[i] = { ...colors[i], hex: e.target.value };
                        patch({ colors });
                      }}
                    />
                    <span className="w-32 text-sm text-[var(--color-muted)]">{describeColor(c.hex)}</span>
                    <input
                      type="range"
                      min={5}
                      max={100}
                      value={Math.round(c.share * 100)}
                      onChange={(e) => {
                        const colors = [...g.colors];
                        colors[i] = { ...colors[i], share: Number(e.target.value) / 100 };
                        patch({ colors });
                      }}
                    />
                    <span className="tabular w-10 text-right text-xs text-[var(--color-faint)]">
                      {Math.round(c.share * 100)}%
                    </span>
                    {g.colors.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-[var(--color-faint)] hover:text-[var(--color-bad)]"
                        onClick={() => patch({ colors: g.colors.filter((_, x) => x !== i) })}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {g.colors.length < 3 && (
                <button
                  type="button"
                  className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
                  onClick={() => patch({ colors: [...g.colors, { hex: "#cccccc", share: 0.3 }] })}
                >
                  + Add a second colour
                </button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Pattern</Label>
                <select
                  value={g.pattern}
                  onChange={(e) => {
                    const pattern = e.target.value as Pattern;
                    patch({ pattern, patternScale: pattern === "solid" ? "none" : g.patternScale === "none" ? "medium" : g.patternScale });
                  }}
                >
                  {PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <Label>Pattern scale</Label>
                <select
                  value={g.patternScale}
                  disabled={g.pattern === "solid"}
                  onChange={(e) => patch({ patternScale: e.target.value as PatternScale })}
                >
                  {SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </Card>

          {/* -------------------------------------------------- fabric -- */}
          <Card className="space-y-4 p-5">
            <div className="flex items-baseline justify-between">
              <p className="display text-xl">Fabric</p>
              <p className="text-xs text-[var(--color-faint)]">
                Off the care label. Drives stretch, warmth and breathability.
              </p>
            </div>
            <div className="space-y-2">
              {fabricRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={row.fiber}
                    onChange={(e) => {
                      const rows = [...fabricRows];
                      rows[i] = { ...rows[i], fiber: e.target.value };
                      setFabricRows(rows);
                    }}
                  >
                    {FIBER_KEYS.map((f) => <option key={f} value={f}>{FIBERS[f].label}</option>)}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="tabular !w-20"
                    value={row.pct}
                    onChange={(e) => {
                      const rows = [...fabricRows];
                      rows[i] = { ...rows[i], pct: Number(e.target.value) };
                      setFabricRows(rows);
                    }}
                  />
                  <span className="text-xs text-[var(--color-faint)]">%</span>
                  {fabricRows.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-[var(--color-faint)] hover:text-[var(--color-bad)]"
                      onClick={() => setFabricRows(fabricRows.filter((_, x) => x !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="text-xs text-[var(--color-accent)] hover:underline"
              onClick={() => setFabricRows([...fabricRows, { fiber: "elastane", pct: 2 }])}
            >
              + Add a fibre
            </button>
            <div>
              <Label>Fabric weight (gsm, optional)</Label>
              <input
                type="number"
                className="tabular"
                placeholder="180"
                value={g.gsm ?? ""}
                onChange={(e) => patch({ gsm: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </div>
          </Card>

          {/* --------------------------------------------- measurements -- */}
          <Card className="p-5">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setShowMeasurements(!showMeasurements)}
            >
              <span>
                <span className="font-medium">Garment measurements</span>
                <span className="mt-0.5 block text-sm text-[var(--color-muted)]">
                  Optional, and the single highest-value thing you can add. Five minutes with a
                  tape takes this item&apos;s fit confidence from about 45% to over 90%.
                </span>
              </span>
              <span className="text-[var(--color-muted)]">{showMeasurements ? "−" : "+"}</span>
            </button>

            {showMeasurements && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {relevantMeasures.map((k) => (
                  <div key={k}>
                    <Label>{MEASURE_META[k].label}</Label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        className="tabular pr-10"
                        value={toDisplay(g.measurements[k], unit)}
                        onChange={(e) => setMeasurement(k, e.target.value)}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-faint)]">
                        {unitLabel(unit)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-[var(--color-faint)]">
                      {MEASURE_META[k].how}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* --------------------------------------------------- admin -- */}
          <Card className="space-y-4 p-5">
            <p className="display text-xl">Practicalities</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label>Formality (1 lounge → 5 black tie)</Label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={0.5}
                  value={g.formality}
                  onChange={(e) => patch({ formality: Number(e.target.value) })}
                />
                <p className="tabular mt-1 text-xs text-[var(--color-faint)]">{g.formality}</p>
              </div>
              <div>
                <Label>Availability</Label>
                <select value={g.careState} onChange={(e) => patch({ careState: e.target.value as CareState })}>
                  {CARE.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Price paid</Label>
                <input
                  type="number"
                  className="tabular"
                  placeholder="For cost per wear"
                  value={g.pricePaid ?? ""}
                  onChange={(e) => patch({ pricePaid: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <Label>Seasons</Label>
              <div className="flex flex-wrap gap-1.5">
                {SEASONS.map((s) => (
                  <Choice
                    key={s}
                    active={g.seasons.includes(s)}
                    onClick={() =>
                      patch({
                        seasons: g.seasons.includes(s)
                          ? g.seasons.filter((x) => x !== s)
                          : [...g.seasons, s],
                      })
                    }
                  >
                    {s}
                  </Choice>
                ))}
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <textarea
                rows={2}
                placeholder="Runs long in the sleeve. Only wear it with the brown belt."
                value={g.notes ?? ""}
                onChange={(e) => patch({ notes: e.target.value })}
              />
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------ live panel -- */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Live fit check</p>
            {preview.findings.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Add a size (or a measurement or two) and this fills in with a per-landmark verdict.
              </p>
            ) : (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="tabular display text-3xl">{Math.round(preview.score)}</span>
                  <span className="text-xs text-[var(--color-faint)]">
                    {Math.round(preview.confidence * 100)}% confident
                    {preview.inferred ? " · estimated from the size label" : ""}
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {preview.findings.slice(0, 5).map((f) => (
                    <li key={f.landmark} className="text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[var(--color-muted)]">{f.label}</span>
                        <span
                          className="tabular text-xs"
                          style={{
                            color:
                              f.verdict === "ideal" ? "var(--color-good)"
                              : f.verdict === "snug" || f.verdict === "relaxed" || f.verdict === "oversized" ? "var(--color-warn)"
                              : "var(--color-bad)",
                          }}
                        >
                          {verdictLabel(f.verdict)} {formatDelta(f.effectiveEaseCm, unit)}
                        </span>
                      </div>
                      {f.advice && (
                        <p className="mt-0.5 text-xs leading-snug text-[var(--color-faint)]">{f.advice}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preview.missingData.length > 0 && (
              <p className="mt-3 border-t border-[var(--color-line-soft)] pt-2 text-xs text-[var(--color-faint)]">
                Add {preview.missingData.slice(0, 2).join(" and ")} to raise confidence.
              </p>
            )}
          </Card>

          <Card className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--color-faint)]">This item reads as</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone="accent">{def.label}</Pill>
              <Pill>formality {g.formality}</Pill>
              <Pill>{def.knit ? "knit" : "woven"}</Pill>
              {g.colors.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
                  <Swatch hex={c.hex} size={10} />
                  {describeColor(c.hex)}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--color-faint)]">{describeFabric(fabric)}</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{children}</span>;
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs capitalize transition-colors ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
          : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-muted)]"
      }`}
    >
      {children}
    </button>
  );
}

export { SectionTitle };

interface ImportResult {
  product: ImportedProduct;
  imageId?: string;
  stillNeeded: string[];
}

/**
 * Pasting a link from the shop you bought it from.
 *
 * It fills the catalogue fields and stops there, and says so. Structured
 * product data carries a name, a brand, a price and a photo; it does not carry
 * how wide the chest is laid flat, which is the number the fit engine actually
 * runs on. Hiding that would produce an item that looks finished and scores at
 * the confidence of a guessed size, so the result names what is still missing
 * rather than leaving it to be discovered on the verdict screen.
 */
function ImportBar({ onImport }: { onImport: (r: ImportResult) => void | Promise<void> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);

  async function run() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/garments/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`);
      setDone(json);
      await onImport(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That link couldn't be read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <p className="display text-xl">Start from a link</p>
      <p className="mt-0.5 text-sm text-[var(--color-muted)]">
        Paste the product page from the shop. It fills in the name, brand, price and photo — the
        measurements it can&apos;t know are the ones worth adding yourself.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="https://…"
          aria-label="Product page link"
          className="min-w-0 flex-1"
        />
        <Button variant="ghost" onClick={run} disabled={busy || !url.trim()}>
          {busy ? "Reading…" : "Fill it in"}
        </Button>
      </div>

      {error && <p className="mt-2.5 text-xs text-[var(--color-bad)]">{error}</p>}

      {done && (
        <div className="mt-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-raised)] p-3 text-xs leading-relaxed">
          <p className="text-[var(--color-text)]">
            Filled in from {done.product.retailer ?? "the page"}
            {done.product.found.length ? `: ${done.product.found.join(", ")}` : ""}.
          </p>
          {/* Named outright, because it is the one imported field that is a
              guess rather than a reading — and a wrong one silently changes
              how the garment is scored and drawn. */}
          {done.product.subcategory && (
            <p className="mt-1 text-[var(--color-text)]">
              Read as{" "}
              <strong className="font-medium">
                {subcategoryDef(done.product.subcategory, done.product.category ?? "top").label}
              </strong>{" "}
              from the name — change it under &ldquo;What is it?&rdquo; if that&apos;s wrong.
            </p>
          )}
          <p className="mt-1 text-[var(--color-muted)]">
            Still yours to add: {done.stillNeeded.join(", ")}. A size label alone gets the fit
            verdict to about 45% confidence; the garment&apos;s own measurements take it past 90%.
          </p>
        </div>
      )}
    </Card>
  );
}
