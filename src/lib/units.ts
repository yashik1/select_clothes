/** Unit conversion at the UI edge. Storage and engines are always centimetres. */
import type { Unit } from "./types";

export const CM_PER_IN = 2.54;

export function toDisplay(cm: number | undefined | null, unit: Unit): number | "" {
  if (typeof cm !== "number" || Number.isNaN(cm)) return "";
  const v = unit === "in" ? cm / CM_PER_IN : cm;
  return Math.round(v * 10) / 10;
}

export function fromDisplay(value: string | number, unit: Unit): number | undefined {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return undefined;
  return unit === "in" ? n * CM_PER_IN : n;
}

export function unitLabel(unit: Unit): string {
  return unit === "in" ? "in" : "cm";
}

export function formatLength(cm: number, unit: Unit): string {
  const v = toDisplay(cm, unit);
  return `${v}${unitLabel(unit)}`;
}

/** Signed deltas need an explicit sign — "+4cm of room" reads better than "4cm". */
export function formatDelta(cm: number, unit: Unit): string {
  const v = unit === "in" ? cm / CM_PER_IN : cm;
  const rounded = Math.round(v * 10) / 10;
  return `${rounded >= 0 ? "+" : ""}${rounded}${unitLabel(unit)}`;
}
