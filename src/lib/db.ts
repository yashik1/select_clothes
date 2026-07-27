/**
 * Storage.
 *
 * Postgres via `pg`. Structured columns are used for anything we filter or
 * sort on; everything else rides along in a `jsonb` column, which keeps the
 * schema stable as the garment model grows.
 *
 * Image bytes live in the database too, rather than on disk. That costs a
 * little storage but means the app holds no local state at all, so it can be
 * deployed to any container platform without a persistent volume attached and
 * survives a redeploy with the wardrobe intact.
 *
 * Timestamps are stored as TEXT, not `timestamptz`. Every one of them is
 * produced by `toISOString()`, and UTC ISO-8601 strings sort lexicographically
 * in the same order as the instants they name — so range queries and ORDER BY
 * behave correctly while the domain model stays free of Date round-tripping.
 */
import { Pool, type PoolConfig } from "pg";
import type {
  BrandCalibration,
  FitFeedback,
  Garment,
  Outfit,
  Profile,
  WearLog,
} from "./types";

/* ------------------------------------------------------------ connection -- */

function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at a Postgres instance — on Railway, " +
        "add a Postgres service and reference ${{Postgres.DATABASE_URL}}.",
    );
  }
  return url;
}

/**
 * Managed Postgres behind a public proxy generally presents a certificate that
 * doesn't chain to a public root, so verification has to be relaxed for the
 * connection to open at all. That encrypts the link without authenticating the
 * server, which is why the private network URL is the one to prefer in
 * production — it needs no TLS because it never leaves the platform's network.
 */
function sslFor(url: string): PoolConfig["ssl"] {
  const override = process.env.DATABASE_SSL;
  if (override === "disable") return undefined;
  if (override === "require") return { rejectUnauthorized: false };
  if (override === "verify") return { rejectUnauthorized: true };

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  const isPrivate =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".railway.internal") ||
    host.endsWith(".internal");

  return isPrivate ? undefined : { rejectUnauthorized: false };
}

const g = globalThis as unknown as {
  __fitcheckPool?: Pool;
  __fitcheckReady?: Promise<void>;
};

export function pool(): Pool {
  if (!g.__fitcheckPool) {
    const url = connectionString();
    g.__fitcheckPool = new Pool({
      connectionString: url,
      ssl: sslFor(url),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // A managed Postgres will drop idle connections. Without a listener that
    // arrives as an unhandled 'error' event and takes the process down.
    g.__fitcheckPool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return g.__fitcheckPool;
}

/* ---------------------------------------------------------------- schema -- */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS profile (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    unit        TEXT NOT NULL DEFAULT 'cm',
    data        JSONB NOT NULL,
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
    formality    DOUBLE PRECISION NOT NULL DEFAULT 2,
    wear_count   INTEGER NOT NULL DEFAULT 0,
    last_worn_at TEXT,
    archived_at  TEXT,
    data         JSONB NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS garment_category ON garment(category);
  CREATE INDEX IF NOT EXISTS garment_archived ON garment(archived_at);

  CREATE TABLE IF NOT EXISTS outfit (
    id          TEXT PRIMARY KEY,
    name        TEXT,
    occasion    TEXT,
    pinned      BOOLEAN NOT NULL DEFAULT FALSE,
    score       DOUBLE PRECISION,
    data        JSONB NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wear_log (
    id          TEXT PRIMARY KEY,
    date        TEXT NOT NULL,
    outfit_id   TEXT,
    occasion    TEXT,
    data        JSONB NOT NULL,
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
    ease_bias_cm DOUBLE PRECISION NOT NULL,
    sample_count INTEGER NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (brand, category)
  );

  CREATE TABLE IF NOT EXISTS image (
    id          TEXT PRIMARY KEY,
    mime        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'garment',
    bytes       BYTEA NOT NULL,
    created_at  TEXT NOT NULL
  );
`;

/** Arbitrary but fixed — just has to be the same number in every instance. */
const MIGRATION_LOCK = 0x71c8ec1;

async function migrate(): Promise<void> {
  const client = await pool().connect();
  try {
    // Two containers booting at once would otherwise race on CREATE TABLE.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      await client.query(SCHEMA);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
  } finally {
    client.release();
  }
}

/** Runs the schema once per process; every query awaits it first. */
export function ready(): Promise<void> {
  if (!g.__fitcheckReady) {
    g.__fitcheckReady = migrate().catch((err) => {
      // Don't cache a failed migration — the next request should retry rather
      // than inherit a permanently rejected promise.
      g.__fitcheckReady = undefined;
      throw err;
    });
  }
  return g.__fitcheckReady;
}

type Row = Record<string, unknown>;

async function q<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  const res = await pool().query(text, params);
  return res.rows as T[];
}

async function one<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export const nowIso = () => new Date().toISOString();
export const newId = () => globalThis.crypto.randomUUID();

/* --------------------------------------------------------------- profile -- */

const DEFAULT_PROFILE_ID = "me";

export async function getProfile(id = DEFAULT_PROFILE_ID): Promise<Profile | null> {
  const row = await one("SELECT * FROM profile WHERE id = $1", [id]);
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    unit: row.unit as Profile["unit"],
    ...(row.data as object),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
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

export async function saveProfile(profile: Profile): Promise<Profile> {
  const { id, name, unit, createdAt, ...rest } = profile;
  const now = nowIso();
  await q(
    `INSERT INTO profile (id, name, unit, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, unit = EXCLUDED.unit,
       data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [id, name, unit, JSON.stringify(rest), createdAt ?? now, now],
  );
  return { ...profile, updatedAt: now };
}

/** Always returns something, so pages never have to null-check the profile. */
export async function getOrCreateProfile(): Promise<Profile> {
  return (await getProfile()) ?? (await saveProfile(emptyProfile()));
}

/* -------------------------------------------------------------- garments -- */

function rowToGarment(row: Row): Garment {
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
    ...(row.data as object),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  } as Garment;
}

export async function listGarments(
  opts: { includeArchived?: boolean } = {},
): Promise<Garment[]> {
  const rows = await q(
    opts.includeArchived
      ? "SELECT * FROM garment ORDER BY created_at DESC"
      : "SELECT * FROM garment WHERE archived_at IS NULL ORDER BY created_at DESC",
  );
  return rows.map(rowToGarment);
}

export async function getGarment(id: string): Promise<Garment | null> {
  const row = await one("SELECT * FROM garment WHERE id = $1", [id]);
  return row ? rowToGarment(row) : null;
}

export async function getGarments(ids: string[]): Promise<Garment[]> {
  if (!ids.length) return [];
  const rows = await q("SELECT * FROM garment WHERE id = ANY($1::text[])", [ids]);
  const byId = new Map(rows.map((r) => [r.id as string, rowToGarment(r)]));
  // Preserve the caller's ordering — outfit slot order is meaningful.
  return ids.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
}

export async function saveGarment(garment: Garment): Promise<Garment> {
  const {
    id, name, category, subcategory, brand, careState, formality,
    wearCount, lastWornAt, archivedAt, createdAt, ...rest
  } = garment;
  const now = nowIso();
  await q(
    `INSERT INTO garment (id, name, category, subcategory, brand, care_state, formality,
                          wear_count, last_worn_at, archived_at, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, subcategory = EXCLUDED.subcategory,
       brand = EXCLUDED.brand, care_state = EXCLUDED.care_state, formality = EXCLUDED.formality,
       wear_count = EXCLUDED.wear_count, last_worn_at = EXCLUDED.last_worn_at,
       archived_at = EXCLUDED.archived_at, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [
      id, name, category, subcategory, brand ?? null, careState, formality,
      wearCount, lastWornAt ?? null, archivedAt ?? null,
      JSON.stringify(rest), createdAt ?? now, now,
    ],
  );
  return { ...garment, updatedAt: now };
}

/**
 * Deleting a garment takes its fit feedback and its photos with it. Now that
 * image bytes are rows rather than files, leaving them behind would quietly
 * grow the database forever.
 */
export async function deleteGarment(id: string): Promise<void> {
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT data FROM garment WHERE id = $1", [id]);
    const imageIds: string[] = (rows[0]?.data?.imageIds as string[]) ?? [];
    await client.query("DELETE FROM garment WHERE id = $1", [id]);
    await client.query("DELETE FROM fit_feedback WHERE garment_id = $1", [id]);
    if (imageIds.length) {
      await client.query("DELETE FROM image WHERE id = ANY($1::text[])", [imageIds]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* --------------------------------------------------------------- outfits -- */

function rowToOutfit(row: Row): Outfit {
  return {
    id: row.id as string,
    name: (row.name as string) ?? undefined,
    occasion: (row.occasion as Outfit["occasion"]) ?? undefined,
    pinned: Boolean(row.pinned),
    scoreSnapshot: (row.score as number) ?? undefined,
    ...(row.data as object),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  } as Outfit;
}

export async function listOutfits(): Promise<Outfit[]> {
  const rows = await q("SELECT * FROM outfit ORDER BY pinned DESC, updated_at DESC");
  return rows.map(rowToOutfit);
}

export async function getOutfit(id: string): Promise<Outfit | null> {
  const row = await one("SELECT * FROM outfit WHERE id = $1", [id]);
  return row ? rowToOutfit(row) : null;
}

export async function saveOutfit(outfit: Outfit): Promise<Outfit> {
  const { id, name, occasion, pinned, scoreSnapshot, createdAt, ...rest } = outfit;
  const now = nowIso();
  await q(
    `INSERT INTO outfit (id, name, occasion, pinned, score, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, occasion = EXCLUDED.occasion, pinned = EXCLUDED.pinned,
       score = EXCLUDED.score, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [
      id, name ?? null, occasion ?? null, Boolean(pinned), scoreSnapshot ?? null,
      JSON.stringify(rest), createdAt ?? now, now,
    ],
  );
  return { ...outfit, updatedAt: now };
}

export async function deleteOutfit(id: string): Promise<void> {
  await q("DELETE FROM outfit WHERE id = $1", [id]);
}

/* -------------------------------------------------------------- wear log -- */

export async function listWearLogs(sinceDays = 120): Promise<WearLog[]> {
  const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const rows = await q("SELECT * FROM wear_log WHERE date >= $1 ORDER BY date DESC", [cutoff]);
  return rows.map((row) => ({
    id: row.id as string,
    date: row.date as string,
    outfitId: (row.outfit_id as string) ?? null,
    occasion: (row.occasion as WearLog["occasion"]) ?? undefined,
    ...(row.data as object),
    createdAt: row.created_at as string,
  })) as WearLog[];
}

/**
 * Records the wear and rolls the derived counters on each garment, in one
 * transaction — a half-applied wear would leave the rotation scores wrong.
 */
export async function logWear(log: WearLog): Promise<WearLog> {
  const { id, date, outfitId, occasion, createdAt, ...rest } = log;
  const now = nowIso();
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO wear_log (id, date, outfit_id, occasion, data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [id, date, outfitId ?? null, occasion ?? null, JSON.stringify(rest), createdAt ?? now],
    );
    await client.query(
      `UPDATE garment
          SET wear_count = wear_count + 1,
              last_worn_at = CASE
                WHEN last_worn_at IS NULL OR last_worn_at < $1 THEN $1 ELSE last_worn_at END,
              updated_at = $2
        WHERE id = ANY($3::text[])`,
      [date, now, log.garmentIds],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ...log, createdAt: createdAt ?? now };
}

export async function deleteWearLog(id: string): Promise<void> {
  await q("DELETE FROM wear_log WHERE id = $1", [id]);
}

/* ----------------------------------------------------------- calibration -- */

export async function listCalibrations(): Promise<BrandCalibration[]> {
  const rows = await q("SELECT * FROM brand_calibration");
  return rows.map((r) => ({
    brand: r.brand as string,
    category: r.category as BrandCalibration["category"],
    easeBiasCm: r.ease_bias_cm as number,
    sampleCount: r.sample_count as number,
    updatedAt: r.updated_at as string,
  }));
}

export async function saveCalibration(c: BrandCalibration): Promise<void> {
  await q(
    `INSERT INTO brand_calibration (brand, category, ease_bias_cm, sample_count, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (brand, category) DO UPDATE SET
       ease_bias_cm = EXCLUDED.ease_bias_cm,
       sample_count = EXCLUDED.sample_count,
       updated_at = EXCLUDED.updated_at`,
    [c.brand.trim().toLowerCase(), c.category, c.easeBiasCm, c.sampleCount, c.updatedAt],
  );
}

export async function listFitFeedback(garmentId?: string): Promise<FitFeedback[]> {
  const rows = garmentId
    ? await q("SELECT * FROM fit_feedback WHERE garment_id = $1", [garmentId])
    : await q("SELECT * FROM fit_feedback");
  return rows.map((r) => ({
    id: r.id as string,
    garmentId: r.garment_id as string,
    landmark: r.landmark as FitFeedback["landmark"],
    verdict: r.verdict as FitFeedback["verdict"],
    createdAt: r.created_at as string,
  }));
}

export async function saveFitFeedback(f: FitFeedback): Promise<void> {
  await q(
    "INSERT INTO fit_feedback (id, garment_id, landmark, verdict, created_at) VALUES ($1, $2, $3, $4, $5)",
    [f.id, f.garmentId, f.landmark, f.verdict, f.createdAt],
  );
}

/* ---------------------------------------------------------------- images -- */

export interface ImageRecord {
  id: string;
  mime: string;
  kind: string;
  createdAt: string;
}

export async function saveImage(rec: ImageRecord, bytes: Buffer): Promise<void> {
  await q(
    "INSERT INTO image (id, mime, kind, bytes, created_at) VALUES ($1, $2, $3, $4, $5)",
    [rec.id, rec.mime, rec.kind, bytes, rec.createdAt],
  );
}

export async function getImageRecord(id: string): Promise<ImageRecord | null> {
  const r = await one("SELECT id, mime, kind, created_at FROM image WHERE id = $1", [id]);
  if (!r) return null;
  return {
    id: r.id as string,
    mime: r.mime as string,
    kind: r.kind as string,
    createdAt: r.created_at as string,
  };
}

/** Metadata and bytes together, for serving and for inlining into try-on calls. */
export async function getImage(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await one("SELECT mime, bytes FROM image WHERE id = $1", [id]);
  if (!r) return null;
  return { mime: r.mime as string, bytes: r.bytes as Buffer };
}
