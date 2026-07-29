"use client";

import { useMemo, useState } from "react";
import { MEASUREMENT_GROUPS } from "@/lib/data/measurementFields";
import { deriveSeason, paletteSwatches, SEASON_NAMES } from "@/lib/color/palette";
import { deriveBodyShape, SHAPE_LABEL, SHAPE_STRATEGY } from "@/lib/engine/bodyShape";
import { fromDisplay, toDisplay, unitLabel } from "@/lib/units";
import {
  fromFeetInches,
  measurementProblems,
  problemFor,
  toFeetInches,
  weightFromDisplay,
  weightToDisplay,
} from "@/lib/measurements";
import type {
  BodyMeasurements,
  BodyShape,
  FitPreference,
  GarmentCategory,
  Profile,
  SeasonName,
  Undertone,
  Unit,
} from "@/lib/types";
import { Button, Card, ConfidenceBar, Pill, SectionTitle, Swatch } from "./ui";
import { BodyAvatar } from "./BodyAvatar";
import { ImageUploader } from "./ImageUploader";

const UNDERTONES: { key: Undertone; label: string; how: string }[] = [
  { key: "cool", label: "Cool", how: "Veins look blue or purple; silver suits you more than gold." },
  { key: "warm", label: "Warm", how: "Veins look green; gold suits you more than silver." },
  { key: "neutral", label: "Neutral", how: "Hard to tell; both metals look fine." },
  { key: "olive", label: "Olive", how: "A green-grey cast that reads neither warm nor cool." },
];

const FIT_CATEGORIES: { key: GarmentCategory; label: string }[] = [
  { key: "top", label: "Tops" },
  { key: "bottom", label: "Bottoms" },
  { key: "dress", label: "Dresses" },
  { key: "outerwear", label: "Outerwear" },
];

const FIT_OPTIONS: FitPreference[] = ["slim", "regular", "relaxed", "oversized"];

export function ProfileForm({ initial }: { initial: Profile }) {
  const [name, setName] = useState(initial.name);
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [measurements, setMeasurements] = useState<BodyMeasurements>(initial.measurements ?? {});
  const [coloring, setColoring] = useState(initial.coloring ?? {});
  const [fitPreferences, setFitPreferences] = useState(initial.fitPreferences ?? {});
  const [shapeOverride, setShapeOverride] = useState<BodyShape | "">(initial.bodyShapeOverride ?? "");
  const [styleNotes, setStyleNotes] = useState(initial.styleNotes ?? "");
  const [bodyPhotoIds, setBodyPhotoIds] = useState<string[]>(initial.bodyPhotoIds ?? []);

  const [location, setLocation] = useState({
    label: initial.locationLabel ?? "",
    lat: initial.locationLat,
    lon: initial.locationLon,
  });
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<
    { name: string; country: string; admin1?: string; latitude: number; longitude: number }[]
  >([]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Derived analysis runs client-side from the same pure functions the server
     uses, so the palette and body shape update as you type. */
  const season = useMemo(() => deriveSeason(coloring), [coloring]);
  const swatches = useMemo(() => paletteSwatches(season.band), [season.band]);
  const body = useMemo(
    () => deriveBodyShape(measurements, shapeOverride || null),
    [measurements, shapeOverride],
  );

  /*
   * Checked as you type rather than on save, because a wrong measurement is
   * only obvious next to the figure it produces — and by the time you have
   * pressed save you have stopped looking at the field that caused it.
   */
  const problems = useMemo(() => measurementProblems(measurements, unit), [measurements, unit]);

  const setMeasurement = (key: keyof BodyMeasurements, raw: string) => {
    setMeasurements((prev) => {
      const next = { ...prev };
      if (raw.trim() === "") delete next[key];
      else {
        // Weight is a mass, not a length; it does not convert by 2.54.
        const v = key === "weight" ? weightFromDisplay(raw, unit) : fromDisplay(raw, unit);
        if (v !== undefined) next[key] = v;
      }
      return next;
    });
    setSaved(false);
  };

  const setHeightParts = (ft: string, inches: string) => {
    setMeasurements((prev) => {
      const next = { ...prev };
      if (ft.trim() === "" && inches.trim() === "") delete next.height;
      else {
        const v = fromFeetInches(
          ft.trim() === "" ? "" : parseFloat(ft),
          inches.trim() === "" ? "" : parseFloat(inches),
        );
        if (v !== undefined) next.height = v;
      }
      return next;
    });
    setSaved(false);
  };

  async function searchLocation(q: string) {
    setLocationQuery(q);
    if (q.trim().length < 2) return setLocationResults([]);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      setLocationResults(json.results ?? []);
    } catch {
      setLocationResults([]);
    }
  }

  async function save() {
    // Saving an impossible body is worse than not saving: every score the app
    // produces afterwards is computed against it, confidently and wrongly.
    if (problems.length) {
      setError(
        problems.length === 1
          ? "One measurement can't be right — see the field marked in red."
          : `${problems.length} measurements can't be right — see the fields marked in red.`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          unit,
          measurements,
          coloring,
          fitPreferences,
          bodyShapeOverride: shapeOverride || null,
          styleNotes,
          locationLat: location.lat ?? null,
          locationLon: location.lon ?? null,
          locationLabel: location.label || undefined,
          bodyPhotoIds,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Save failed (${res.status})`);
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const filled = Object.values(measurements).filter((v) => typeof v === "number").length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold">You</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">
            Everything here is private to your account. Nothing leaves this server unless you
            explicitly turn on a try-on provider.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-[var(--color-good)]">Saved</span>}
          {error && <span className="max-w-sm text-xs text-[var(--color-bad)]">{error}</span>}
          <Button onClick={save} disabled={saving || problems.length > 0}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------- basics -- */}
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <FieldLabel>Name</FieldLabel>
            <input type="text" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
          </div>
          <div>
            <FieldLabel>Units</FieldLabel>
            <div className="flex gap-1.5">
              {(["cm", "in"] as Unit[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                    unit === u
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-line)] text-[var(--color-muted)]"
                  }`}
                >
                  {u === "cm" ? "Centimetres" : "Inches"}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <FieldLabel>Location (for weather)</FieldLabel>
            <input
              type="search"
              placeholder={location.label || "Search a city…"}
              value={locationQuery}
              onChange={(e) => searchLocation(e.target.value)}
            />
            {locationResults.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-raised)] shadow-xl">
                {locationResults.map((r) => (
                  <li key={`${r.latitude},${r.longitude}`}>
                    <button
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface)]"
                      onClick={() => {
                        setLocation({
                          label: `${r.name}${r.admin1 ? `, ${r.admin1}` : ""}, ${r.country}`,
                          lat: r.latitude,
                          lon: r.longitude,
                        });
                        setLocationResults([]);
                        setLocationQuery("");
                        setSaved(false);
                      }}
                    >
                      {r.name}
                      <span className="text-[var(--color-faint)]">
                        {r.admin1 ? `, ${r.admin1}` : ""}, {r.country}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {location.label && (
              <p className="mt-1 text-xs text-[var(--color-faint)]">Using {location.label}</p>
            )}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------- measurements -- */}
      <div>
        <SectionTitle
          hint={`${filled} recorded. The engine tells you which missing ones would sharpen a verdict, so there's no need to do them all now.`}
          action={<Pill tone={filled >= 4 ? "good" : "warn"}>{filled >= 4 ? "Fit engine active" : "Needs 4 core"}</Pill>}
        >
          Measurements
        </SectionTitle>

        <div className="grid gap-5 lg:grid-cols-[1fr_23rem]">
        <div className="space-y-4">
          {MEASUREMENT_GROUPS.map((group) => (
            <Card key={group.title} className="p-5">
              <p className="display text-xl">{group.title}</p>
              <p className="mt-0.5 mb-4 text-sm text-[var(--color-muted)]">{group.blurb}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields.map((f) => {
                  const problem = problemFor(problems, f.key);
                  const ring = problem
                    ? "border-[var(--color-bad)] focus:border-[var(--color-bad)]"
                    : "";
                  // Nobody describes their height as sixty-four inches, and a
                  // box that asks for one invites "5.4" — which is how a
                  // stature of 13cm gets into the database.
                  const asFeet = f.key === "height" && unit === "in";
                  const { ft, inches } = asFeet
                    ? toFeetInches(measurements.height)
                    : { ft: "" as number | "", inches: "" as number | "" };

                  return (
                    <div key={f.key}>
                      <FieldLabel htmlFor={asFeet ? `m-${f.key}-ft` : `m-${f.key}`}>
                        {f.label}
                        {f.core && <span className="ml-1 text-[var(--color-accent)]">*</span>}
                      </FieldLabel>

                      {asFeet ? (
                        <div className="flex gap-2">
                          {([
                            ["ft", ft, (v: string) => setHeightParts(v, String(inches))],
                            ["in", inches, (v: string) => setHeightParts(String(ft), v)],
                          ] as const).map(([suffix, value, onChange]) => (
                            <div key={suffix} className="relative flex-1">
                              <input
                                type="number"
                                id={`m-${f.key}-${suffix}`}
                                step={suffix === "ft" ? "1" : "0.5"}
                                inputMode="decimal"
                                aria-label={suffix === "ft" ? "Height, feet" : "Height, inches"}
                                aria-invalid={problem ? true : undefined}
                                className={`tabular pr-8 ${ring}`}
                                value={value}
                                onChange={(e) => onChange(e.target.value)}
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-faint)]">
                                {suffix}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="relative">
                          <input
                            type="number"
                            id={`m-${f.key}`}
                            step="0.1"
                            inputMode="decimal"
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={`m-${f.key}-note`}
                            className={`tabular pr-10 ${ring}`}
                            value={
                              f.key === "weight"
                                ? weightToDisplay(measurements.weight, unit)
                                : toDisplay(measurements[f.key], unit)
                            }
                            onChange={(e) => setMeasurement(f.key, e.target.value)}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-faint)]">
                            {f.key === "weight" ? (unit === "in" ? "lb" : "kg") : unitLabel(unit)}
                          </span>
                        </div>
                      )}

                      <p
                        id={`m-${f.key}-note`}
                        className={`mt-1 text-xs leading-snug ${
                          problem ? "text-[var(--color-bad)]" : "text-[var(--color-faint)]"
                        }`}
                      >
                        {problem ?? f.how}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>

          {/* Beside the fields rather than below them, and sticky, so a
              measurement you type changes the figure while you're still
              looking at the box you typed it into. */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <BodyAvatar measurements={measurements} unit={unit} />
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- shape -- */}
      <div>
        <SectionTitle hint="Derived from your measurements. Override it if you disagree — you know your body better than a ratio does.">
          Shape and proportion
        </SectionTitle>
        <Card className="p-5">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="flex items-center gap-3">
                <span className="display text-2xl">{SHAPE_LABEL[body.shape]}</span>
                {body.shape !== "unknown" && body.runnerUp && !shapeOverride && (
                  <span className="text-xs text-[var(--color-faint)]">
                    (leaning toward {SHAPE_LABEL[body.runnerUp].toLowerCase()})
                  </span>
                )}
              </div>
              <div className="mt-3 max-w-xs">
                <ConfidenceBar value={body.confidence} />
              </div>

              {body.notes.length > 0 && (
                <p className="mt-3 text-sm text-[var(--color-muted)]">
                  You have {body.notes.join(", ")}.
                </p>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <Ratio label="Chest ÷ hip" value={body.ratios.chestToHip} />
                <Ratio label="Waist ÷ hip" value={body.ratios.waistToHip} />
                <Ratio label="Leg ÷ height" value={body.ratios.legToHeight} />
                <Ratio label="Shoulder ÷ hip" value={body.ratios.shoulderToHip} />
              </dl>

              <div className="mt-4">
                <FieldLabel>Override</FieldLabel>
                <select
                  value={shapeOverride}
                  onChange={(e) => { setShapeOverride(e.target.value as BodyShape | ""); setSaved(false); }}
                >
                  <option value="">Use the derived shape</option>
                  {(Object.keys(SHAPE_LABEL) as BodyShape[])
                    .filter((s) => s !== "unknown")
                    .map((s) => (
                      <option key={s} value={s}>{SHAPE_LABEL[s]}</option>
                    ))}
                </select>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-raised)] p-4">
              <p className="text-sm font-medium">{SHAPE_STRATEGY[body.shape].goal}</p>
              {SHAPE_STRATEGY[body.shape].likes.length > 0 && (
                <>
                  <p className="mt-3 text-xs uppercase tracking-wide text-[var(--color-faint)]">Works for you</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-[var(--color-muted)]">
                    {SHAPE_STRATEGY[body.shape].likes.map((l) => <li key={l}>· {l}</li>)}
                  </ul>
                  <p className="mt-3 text-xs uppercase tracking-wide text-[var(--color-faint)]">Watch for</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-[var(--color-muted)]">
                    {SHAPE_STRATEGY[body.shape].watch.map((l) => <li key={l}>· {l}</li>)}
                  </ul>
                </>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ---------------------------------------------------- colouring -- */}
      <div>
        <SectionTitle hint="Four answers give the colour engine a palette to grade every garment against.">
          Colouring
        </SectionTitle>
        <Card className="p-5">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-5">
              <div>
                <FieldLabel>Skin depth</FieldLabel>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={coloring.skinDepth ?? 5}
                  onChange={(e) => { setColoring({ ...coloring, skinDepth: Number(e.target.value) }); setSaved(false); }}
                />
                <div className="flex justify-between text-xs text-[var(--color-faint)]">
                  <span>Very fair</span>
                  <span className="tabular">{coloring.skinDepth ?? "—"}</span>
                  <span>Deep</span>
                </div>
              </div>

              <div>
                <FieldLabel>Undertone</FieldLabel>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {UNDERTONES.map((u) => (
                    <button
                      key={u.key}
                      onClick={() => { setColoring({ ...coloring, undertone: u.key }); setSaved(false); }}
                      className={`rounded-lg border p-2.5 text-left transition-colors ${
                        coloring.undertone === u.key
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                          : "border-[var(--color-line)] hover:border-[var(--color-muted)]"
                      }`}
                    >
                      <span className="text-sm font-medium">{u.label}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-[var(--color-faint)]">{u.how}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Hair colour</FieldLabel>
                  <input
                    type="color"
                    value={coloring.hairHex ?? "#3b2b22"}
                    onChange={(e) => { setColoring({ ...coloring, hairHex: e.target.value }); setSaved(false); }}
                  />
                </div>
                <div>
                  <FieldLabel>Eye colour</FieldLabel>
                  <input
                    type="color"
                    value={coloring.eyeHex ?? "#4a5a3f"}
                    onChange={(e) => { setColoring({ ...coloring, eyeHex: e.target.value }); setSaved(false); }}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-raised)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="display text-xl">{season.season}</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">{season.band.blurb}</p>
                </div>
              </div>

              <div className="mt-3 max-w-[14rem]">
                <ConfidenceBar value={season.confidence} />
              </div>
              {season.missing.length > 0 && (
                <p className="mt-2 text-xs text-[var(--color-faint)]">
                  Add your {season.missing.join(", ")} to firm this up.
                </p>
              )}

              <p className="mt-4 text-xs uppercase tracking-wide text-[var(--color-faint)]">Your palette</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {swatches.map((s, i) => (
                  <span
                    key={`${s.hex}-${i}`}
                    className="h-7 w-7 rounded-full border border-black/10"
                    style={{ background: s.hex }}
                    title={s.hex}
                  />
                ))}
              </div>

              <div className="mt-4">
                <FieldLabel>Override season</FieldLabel>
                <select
                  value={coloring.seasonOverride ?? ""}
                  onChange={(e) => {
                    setColoring({ ...coloring, seasonOverride: (e.target.value || null) as SeasonName | null });
                    setSaved(false);
                  }}
                >
                  <option value="">Use the derived season</option>
                  {SEASON_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ---------------------------------------------- fit preferences -- */}
      <div>
        <SectionTitle hint="How you like things to sit. This shifts the whole ease band, so an oversized preference stops the engine calling your oversized coat oversized.">
          Fit preferences
        </SectionTitle>
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FIT_CATEGORIES.map((c) => (
              <div key={c.key}>
                <FieldLabel>{c.label}</FieldLabel>
                <select
                  value={fitPreferences[c.key] ?? "regular"}
                  onChange={(e) => {
                    setFitPreferences({ ...fitPreferences, [c.key]: e.target.value as FitPreference });
                    setSaved(false);
                  }}
                >
                  {FIT_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* --------------------------------------------------- body photo -- */}
      <div>
        <SectionTitle hint="Only needed if you switch on an AI try-on provider. Everything else works without it.">
          Full-length photo
        </SectionTitle>
        <Card className="p-5">
          <ImageUploader
            kind="body"
            imageIds={bodyPhotoIds}
            onChange={(ids) => { setBodyPhotoIds(ids); setSaved(false); }}
            hint="Stand square to the camera, arms slightly away from your body, plain background."
            max={2}
          />
        </Card>
      </div>

      <div>
        <SectionTitle>Style notes</SectionTitle>
        <Card className="p-5">
          <textarea
            rows={3}
            placeholder="Anything the engine should know — a uniform you're building toward, colours you refuse to wear, a shoulder that needs room."
            value={styleNotes}
            onChange={(e) => { setStyleNotes(e.target.value); setSaved(false); }}
          />
        </Card>
      </div>

      <div className="flex justify-end gap-3 pb-6">
        {error && <span className="self-center text-xs text-[var(--color-bad)]">{error}</span>}
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}

/**
 * A real `<label>` when it has something to point at. These were spans, which
 * look identical and leave every field with no accessible name at all — a
 * screen reader reads twenty-two anonymous number boxes.
 */
function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  const className = "mb-1 block text-xs font-medium text-[var(--color-muted)]";
  return htmlFor ? (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ) : (
    <span className={className}>{children}</span>
  );
}

function Ratio({ label, value }: { label: string; value: number | null }) {
  return (
    <>
      <dt className="text-[var(--color-faint)]">{label}</dt>
      <dd className="tabular text-right">{value === null ? "—" : value.toFixed(2)}</dd>
    </>
  );
}

export { Swatch };
