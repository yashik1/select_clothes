import "server-only";

import {
  getOrCreateProfile,
  listCalibrations,
  listGarments,
  listWearLogs,
} from "@/lib/db";
import { getForecast, type Forecast } from "@/lib/weather";
import type { Garment, OccasionKey, Profile, ScoringContext } from "@/lib/types";

export interface AppContext {
  profile: Profile;
  wardrobe: Garment[];
  forecast: Forecast | null;
  scoring: ScoringContext;
}

/**
 * Assembles everything the engines need in one place, so no page or route has
 * to remember that scoring wants the wear log and the brand calibrations too.
 */
export async function appContext(occasion?: OccasionKey): Promise<AppContext> {
  const profile = getOrCreateProfile();
  const wardrobe = listGarments();
  const recentWear = listWearLogs(120);
  const calibrations = listCalibrations();

  const forecast =
    typeof profile.locationLat === "number" && typeof profile.locationLon === "number"
      ? await getForecast(profile.locationLat, profile.locationLon)
      : null;

  return {
    profile,
    wardrobe,
    forecast,
    scoring: {
      occasion,
      weather: forecast ?? undefined,
      date: new Date().toISOString(),
      recentWear,
      calibrations,
      fitCache: new Map(),
    },
  };
}

/** Profile completeness, used to decide whether to nudge the user to onboarding. */
export function profileReadiness(profile: Profile): {
  ready: boolean;
  pct: number;
  missing: string[];
} {
  const m = profile.measurements;
  const checks: [boolean, string][] = [
    [typeof m.height === "number", "height"],
    [typeof m.chest === "number", "chest / bust"],
    [typeof m.waistNatural === "number", "natural waist"],
    [typeof m.hip === "number", "hip"],
    [typeof m.inseam === "number", "inseam"],
    [typeof m.shoulderWidth === "number", "shoulder width"],
    [typeof m.armLength === "number", "arm length"],
    [Boolean(profile.coloring.undertone), "skin undertone"],
    [typeof profile.coloring.skinDepth === "number", "skin depth"],
    [Boolean(profile.coloring.hairHex), "hair colour"],
  ];
  const done = checks.filter(([ok]) => ok).length;
  return {
    ready: done >= 5,
    pct: done / checks.length,
    missing: checks.filter(([ok]) => !ok).map(([, name]) => name),
  };
}
