/**
 * Storage.
 *
 * SQLite via Node's built-in `node:sqlite` — no native module to compile, no
 * server to run, and the whole wardrobe is one file the user can back up or
 * delete. Structured columns are used for anything we filter or sort on;
 * everything else rides along as JSON, which keeps the schema stable as the
 * garment model grows.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  BrandCalibration,
  FitFeedback,
  Garment,
  Outfit,
  Profile,
  WearLog,
} from "./types";

export const DATA_DIR = process.env.FITCHECK_DATA_DIR
  ? path.resolve(process.env.FITCHECK_DATA_DIR)
  : path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const g = globalThis as unknown as { __fitcheckDb?: DatabaseSync };

function init(): DatabaseSync {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "fitcheck.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      unit        TEXT NOT NULL DEFAULT 'cm',
      data        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS garment (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      category     TEXT NOT NULL,
      subcategory  TEXT NOT NULL,
      brand        TEXT,
      care_state   TEXT NOT NULL DEFAULT 'clean',
      formality    REAL NOT NULL DEFAULT 2,
      wear_count   INTEGER NOT NULL DEFAULT 0,
      last_worn_at TEXT,
      archived_at  TEXT,
      data         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS garment_category ON garment(category);
    CREATE INDEX IF NOT EXISTS garment_archived ON garment(archived_at);

    CREATE TABLE IF NOT EXISTS outfit (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      occasion    TEXT,
      pinned      INTEGER NOT NULL DEFAULT 0,
      score       REAL,
      data        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wear_log (
      id          TEXT PRIMARY KEY,
      date        TEXT NOT NULL,
      outfit_id   TEXT,
      occasion    TEXT,
      data        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wear_log_date ON wear_log(date);

    CREATE TABLE IF NOT EXISTS fit_feedback (
      id          TEXT PRIMARY KEY,
      garment_id  TEXT NOT NULL,
      landmark    TEXT NOT NULL,
      verdict     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS fit_feedback_garment ON fit_feedback(garment_id);

    CREATE TABLE IF NOT EXISTS brand_calibration (
      brand        TEXT NOT NULL,
      category     TEXT NOT NULL,
      ease_bias_cm REAL NOT NULL,
      sample_count INTEGER NOT NULL,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (brand, category)
    );

    CREATE TABLE IF NOT EXISTS image (
      id          TEXT PRIMARY KEY,
      mime        TEXT NOT NULL,
      filename    TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'garment',
      created_at  TEXT NOT NULL
    );
  `);

  return db;
}

export function db(): DatabaseSync {
  if (!g.__fitcheckDb) g.__fitcheckDb = init();
  return g.__fitcheckDb;
}

export const nowIso = () => new Date().toISOString();
export const newId = () => globalThis.crypto.randomUUID();

/* --------------------------------------------------------------- profile -- */

const DEFAULT_PROFILE_ID = "me";

export function getProfile(id = DEFAULT_PROFILE_ID): Profile | null {
  const row = db().prepare("SELECT * FROM profile WHERE id = ?").get(id) as
    | Record<string, string>
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    unit: row.unit as Profile["unit"],
    ...JSON.parse(row.data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as Profile;
}

export function emptyProfile(id = DEFAULT_PROFILE_ID): Profile {
  return {
    id,
    name: "Me",
    unit: "cm",
    measurements: {},
    coloring: {},
    fitPreferences: {},
    bodyPhotoIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function saveProfile(profile: Profile): Profile {
  const { id, name, unit, createdAt, ...rest } = profile;
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO profile (id, name, unit, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, unit = excluded.unit,
         data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(id, name, unit, JSON.stringify(rest), createdAt ?? now, now);
  return { ...profile, updatedAt: now };
}

/** Always returns something, so pages never have to null-check the profile. */
export function getOrCreateProfile(): Profile {
  return getProfile() ?? saveProfile(emptyProfile());
}

/* -------------------------------------------------------------- garments -- */

function rowToGarment(row: Record<string, unknown>): Garment {
  return {
    id: row.id as string,
    name: row.name as string,
    category: row.category as Garment["category"],
    subcategory: row.subcategory as string,
    brand: (row.brand as string) ?? undefined,
    careState: row.care_state as Garment["careState"],
    formality: row.formality as number,
    wearCount: row.wear_count as number,
    lastWornAt: (row.last_worn_at as string) ?? null,
    archivedAt: (row.archived_at as string) ?? null,
    ...JSON.parse(row.data as string),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  } as Garment;
}

export function listGarments(opts: { includeArchived?: boolean } = {}): Garment[] {
  const sql = opts.includeArchived
    ? "SELECT * FROM garment ORDER BY created_at DESC"
    : "SELECT * FROM garment WHERE archived_at IS NULL ORDER BY created_at DESC";
  return (db().prepare(sql).all() as Record<string, unknown>[]).map(rowToGarment);
}

export function getGarment(id: string): Garment | null {
  const row = db().prepare("SELECT * FROM garment WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToGarment(row) : null;
}

export function getGarments(ids: string[]): Garment[] {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db()
    .prepare(`SELECT * FROM garment WHERE id IN (${placeholders})`)
    .all(...ids) as Record<string, unknown>[];
  const byId = new Map(rows.map((r) => [r.id as string, rowToGarment(r)]));
  // Preserve the caller's ordering — outfit slot order is meaningful.
  return ids.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
}

export function saveGarment(garment: Garment): Garment {
  const {
    id, name, category, subcategory, brand, careState, formality,
    wearCount, lastWornAt, archivedAt, createdAt, ...rest
  } = garment;
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO garment (id, name, category, subcategory, brand, care_state, formality,
                            wear_count, last_worn_at, archived_at, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, category = excluded.category, subcategory = excluded.subcategory,
         brand = excluded.brand, care_state = excluded.care_state, formality = excluded.formality,
         wear_count = excluded.wear_count, last_worn_at = excluded.last_worn_at,
         archived_at = excluded.archived_at, data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(
      id, name, category, subcategory, brand ?? null, careState, formality,
      wearCount, lastWornAt ?? null, archivedAt ?? null,
      JSON.stringify(rest), createdAt ?? now, now,
    );
  return { ...garment, updatedAt: now };
}

export function deleteGarment(id: string): void {
  db().prepare("DELETE FROM garment WHERE id = ?").run(id);
  db().prepare("DELETE FROM fit_feedback WHERE garment_id = ?").run(id);
}

/* --------------------------------------------------------------- outfits -- */

function rowToOutfit(row: Record<string, unknown>): Outfit {
  return {
    id: row.id as string,
    name: (row.name as string) ?? undefined,
    occasion: (row.occasion as Outfit["occasion"]) ?? undefined,
    pinned: Boolean(row.pinned),
    scoreSnapshot: (row.score as number) ?? undefined,
    ...JSON.parse(row.data as string),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  } as Outfit;
}

export function listOutfits(): Outfit[] {
  return (
    db().prepare("SELECT * FROM outfit ORDER BY pinned DESC, updated_at DESC").all() as Record<
      string,
      unknown
    >[]
  ).map(rowToOutfit);
}

export function getOutfit(id: string): Outfit | null {
  const row = db().prepare("SELECT * FROM outfit WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToOutfit(row) : null;
}

export function saveOutfit(outfit: Outfit): Outfit {
  const { id, name, occasion, pinned, scoreSnapshot, createdAt, ...rest } = outfit;
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO outfit (id, name, occasion, pinned, score, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, occasion = excluded.occasion, pinned = excluded.pinned,
         score = excluded.score, data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(
      id, name ?? null, occasion ?? null, pinned ? 1 : 0, scoreSnapshot ?? null,
      JSON.stringify(rest), createdAt ?? now, now,
    );
  return { ...outfit, updatedAt: now };
}

export function deleteOutfit(id: string): void {
  db().prepare("DELETE FROM outfit WHERE id = ?").run(id);
}

/* -------------------------------------------------------------- wear log -- */

export function listWearLogs(sinceDays = 120): WearLog[] {
  const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString();
  return (
    db()
      .prepare("SELECT * FROM wear_log WHERE date >= ? ORDER BY date DESC")
      .all(cutoff) as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as string,
    date: row.date as string,
    outfitId: (row.outfit_id as string) ?? null,
    occasion: (row.occasion as WearLog["occasion"]) ?? undefined,
    ...JSON.parse(row.data as string),
    createdAt: row.created_at as string,
  })) as WearLog[];
}

/** Records the wear and rolls the derived counters on each garment. */
export function logWear(log: WearLog): WearLog {
  const { id, date, outfitId, occasion, createdAt, ...rest } = log;
  const now = nowIso();
  const database = db();
  database
    .prepare(
      `INSERT INTO wear_log (id, date, outfit_id, occasion, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, date, outfitId ?? null, occasion ?? null, JSON.stringify(rest), createdAt ?? now);

  const bump = database.prepare(
    `UPDATE garment
        SET wear_count = wear_count + 1,
            last_worn_at = CASE
              WHEN last_worn_at IS NULL OR last_worn_at < ? THEN ? ELSE last_worn_at END,
            updated_at = ?
      WHERE id = ?`,
  );
  for (const gid of log.garmentIds) bump.run(date, date, now, gid);

  return { ...log, createdAt: createdAt ?? now };
}

export function deleteWearLog(id: string): void {
  db().prepare("DELETE FROM wear_log WHERE id = ?").run(id);
}

/* ----------------------------------------------------------- calibration -- */

export function listCalibrations(): BrandCalibration[] {
  return (db().prepare("SELECT * FROM brand_calibration").all() as Record<string, unknown>[]).map(
    (r) => ({
      brand: r.brand as string,
      category: r.category as BrandCalibration["category"],
      easeBiasCm: r.ease_bias_cm as number,
      sampleCount: r.sample_count as number,
      updatedAt: r.updated_at as string,
    }),
  );
}

export function saveCalibration(c: BrandCalibration): void {
  db()
    .prepare(
      `INSERT INTO brand_calibration (brand, category, ease_bias_cm, sample_count, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(brand, category) DO UPDATE SET
         ease_bias_cm = excluded.ease_bias_cm,
         sample_count = excluded.sample_count,
         updated_at = excluded.updated_at`,
    )
    .run(c.brand.trim().toLowerCase(), c.category, c.easeBiasCm, c.sampleCount, c.updatedAt);
}

export function listFitFeedback(garmentId?: string): FitFeedback[] {
  const rows = garmentId
    ? (db().prepare("SELECT * FROM fit_feedback WHERE garment_id = ?").all(garmentId) as Record<string, unknown>[])
    : (db().prepare("SELECT * FROM fit_feedback").all() as Record<string, unknown>[]);
  return rows.map((r) => ({
    id: r.id as string,
    garmentId: r.garment_id as string,
    landmark: r.landmark as FitFeedback["landmark"],
    verdict: r.verdict as FitFeedback["verdict"],
    createdAt: r.created_at as string,
  }));
}

export function saveFitFeedback(f: FitFeedback): void {
  db()
    .prepare(
      "INSERT INTO fit_feedback (id, garment_id, landmark, verdict, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(f.id, f.garmentId, f.landmark, f.verdict, f.createdAt);
}

/* ---------------------------------------------------------------- images -- */

export interface ImageRecord {
  id: string;
  mime: string;
  filename: string;
  kind: string;
  createdAt: string;
}

export function saveImageRecord(rec: ImageRecord): void {
  db()
    .prepare("INSERT INTO image (id, mime, filename, kind, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(rec.id, rec.mime, rec.filename, rec.kind, rec.createdAt);
}

export function getImageRecord(id: string): ImageRecord | null {
  const r = db().prepare("SELECT * FROM image WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    id: r.id as string,
    mime: r.mime as string,
    filename: r.filename as string,
    kind: r.kind as string,
    createdAt: r.created_at as string,
  };
}
