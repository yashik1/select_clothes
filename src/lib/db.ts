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
  CREATE TABLE IF NOT EXISTS app_user (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  -- Citext would be tidier, but it needs an extension the database user may
  -- not be allowed to create. Emails are lowercased before they ever get here.
  CREATE UNIQUE INDEX IF NOT EXISTS app_user_email ON app_user(email);

  CREATE TABLE IF NOT EXISTS session (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  -- Not "session_user": that is a reserved function name in Postgres, and an
  -- index cannot be created with it.
  CREATE INDEX IF NOT EXISTS session_user_id ON session(user_id);
  CREATE INDEX IF NOT EXISTS session_expiry ON session(expires_at);

  -- Rate limiting. Timestamps here are real timestamptz rather than the ISO
  -- strings the rest of the schema uses, because the whole counter has to be
  -- updated and expired inside one statement, and that needs the database's
  -- own clock rather than the application's.
  CREATE TABLE IF NOT EXISTS rate_limit (
    key      TEXT PRIMARY KEY,
    count    INTEGER NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rate_limit_reset ON rate_limit(reset_at);

  -- Single-use password reset tokens. Only the hash is stored, for the same
  -- reason session tokens are: a leaked database must not hand out live
  -- credentials.
  CREATE TABLE IF NOT EXISTS password_reset (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_reset_user ON password_reset(user_id);

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

/**
 * Everything a single-user database needs to become a multi-user one. Each
 * statement is a no-op on a database created from SCHEMA above, so both paths
 * converge and this can run unconditionally on every boot.
 *
 * user_id is deliberately nullable. Rows that predate accounts are invisible to
 * every query — all of which filter on it — until the first account is created
 * and adopts them, so upgrading an instance that already holds a wardrobe
 * doesn't lose it. See `adoptOrphanedData`.
 */
const OWNERSHIP_MIGRATIONS = [
  `ALTER TABLE profile           ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE garment           ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE outfit            ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE wear_log          ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE fit_feedback      ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE brand_calibration ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE image             ADD COLUMN IF NOT EXISTS user_id TEXT`,

  `CREATE INDEX IF NOT EXISTS profile_user      ON profile(user_id)`,
  `CREATE INDEX IF NOT EXISTS garment_user      ON garment(user_id)`,
  `CREATE INDEX IF NOT EXISTS outfit_user       ON outfit(user_id)`,
  `CREATE INDEX IF NOT EXISTS wear_log_user     ON wear_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS fit_feedback_user ON fit_feedback(user_id)`,
  `CREATE INDEX IF NOT EXISTS image_user        ON image(user_id)`,

  // A brand's bias is learned per person, so the key it upserts on has to
  // include the owner. A unique index rather than a primary key, because it
  // can be created idempotently and dropped without touching the old one.
  `ALTER TABLE brand_calibration DROP CONSTRAINT IF EXISTS brand_calibration_pkey`,
  `CREATE UNIQUE INDEX IF NOT EXISTS brand_calibration_key
     ON brand_calibration(user_id, brand, category)`,
];

/** Arbitrary but fixed — just has to be the same number in every instance. */
const MIGRATION_LOCK = 0x71c8ec1;

async function migrate(): Promise<void> {
  const client = await pool().connect();
  try {
    // Two containers booting at once would otherwise race on CREATE TABLE.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      await client.query(SCHEMA);
      for (const statement of OWNERSHIP_MIGRATIONS) await client.query(statement);
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

/* ------------------------------------------------------------- ceilings -- */

/**
 * What one account is allowed to occupy.
 *
 * Every one of these is far above what a person with a wardrobe will ever
 * reach — the largest wardrobe anyone has actually catalogued in this app is
 * two orders of magnitude below the garment cap. They exist for the other
 * case: a script with a valid session, looping. Without them a single account
 * can fill the disk the whole instance shares, and the failure lands on
 * everybody else.
 */
export const QUOTA = {
  garments: 2_000,
  outfits: 2_000,
  /** Bytes of stored photos. Roughly 250 full-resolution phone photos. */
  imageBytes: 256 * 1024 * 1024,
} as const;

/**
 * The ceiling on any single SELECT, independent of the quotas above.
 *
 * A quota bounds what an account can create from here on; it says nothing
 * about a table that is already large, and `SELECT *` with no LIMIT reads the
 * whole result into memory before the caller sees a row. This is the backstop
 * that keeps one enormous account from taking the process down with it.
 */
const MAX_ROWS = 5_000;

/* ----------------------------------------------------------- accounts -- */

export interface AccountRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export async function countUsers(): Promise<number> {
  const row = await one("SELECT count(*)::int AS n FROM app_user");
  return (row?.n as number) ?? 0;
}

export async function getUserByEmail(email: string): Promise<AccountRow | null> {
  const r = await one("SELECT * FROM app_user WHERE email = $1", [email]);
  return r
    ? {
        id: r.id as string,
        email: r.email as string,
        passwordHash: r.password_hash as string,
        createdAt: r.created_at as string,
      }
    : null;
}

export async function getUserById(id: string): Promise<AccountRow | null> {
  const r = await one("SELECT * FROM app_user WHERE id = $1", [id]);
  return r
    ? {
        id: r.id as string,
        email: r.email as string,
        passwordHash: r.password_hash as string,
        createdAt: r.created_at as string,
      }
    : null;
}

/** Returns null when the address is already taken, rather than throwing. */
export async function createUser(
  email: string,
  passwordHash: string,
): Promise<AccountRow | null> {
  const id = newId();
  const createdAt = nowIso();
  const rows = await q(
    `INSERT INTO app_user (id, email, password_hash, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [id, email, passwordHash, createdAt],
  );
  if (!rows.length) return null;
  return { id, email, passwordHash, createdAt };
}

/**
 * Hands data that predates accounts to its new owner. An instance upgraded from
 * the single-user version has rows with no user_id, invisible to every query
 * until this runs; the first account to be created takes them.
 */
export async function adoptOrphanedData(userId: string): Promise<number> {
  await ready();
  const client = await pool().connect();
  let adopted = 0;
  try {
    await client.query("BEGIN");
    for (const table of [
      "profile", "garment", "outfit", "wear_log", "fit_feedback", "brand_calibration", "image",
    ]) {
      const res = await client.query(
        `UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`,
        [userId],
      );
      adopted += res.rowCount ?? 0;
    }
    // The old single-user profile was keyed on the literal id 'me'; the profile
    // is now keyed on its owner.
    await client.query(
      `UPDATE profile SET id = $1 WHERE user_id = $1 AND id <> $1`,
      [userId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return adopted;
}

/* ----------------------------------------------------------- sessions -- */

/* ---------------------------------------------------------- rate limits -- */

/**
 * Counts one attempt against `key` and returns the running total.
 *
 * One statement, deliberately. Read-then-write would let two requests racing
 * on the last slot both see room and both take it — `ON CONFLICT` makes the
 * upsert atomic, and folding the window reset into the same `DO UPDATE` keeps
 * it that way instead of reintroducing the gap the constraint exists to close.
 */
export async function bumpRateLimit(
  key: string,
  windowSeconds: number,
): Promise<{ count: number; resetAt: Date }> {
  const rows = await q(
    `INSERT INTO rate_limit (key, count, reset_at)
       VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE
       SET count    = CASE WHEN rate_limit.reset_at <= now() THEN 1
                           ELSE rate_limit.count + 1 END,
           reset_at = CASE WHEN rate_limit.reset_at <= now()
                           THEN now() + make_interval(secs => $2)
                           ELSE rate_limit.reset_at END
     RETURNING count, reset_at`,
    [key, windowSeconds],
  );
  return { count: rows[0].count as number, resetAt: rows[0].reset_at as Date };
}

/** Hands one attempt back, for when it turns out not to have been a guess. */
export async function refundRateLimit(key: string): Promise<void> {
  await q("UPDATE rate_limit SET count = greatest(0, count - 1) WHERE key = $1", [key]);
}

/**
 * Drops counters whose window closed long ago.
 *
 * Without this the table only ever grows, and it grows on unauthenticated
 * input: every distinct email address and every distinct `x-forwarded-for`
 * value mints a permanent row, so anyone can add one row per request forever.
 * That is a slower version of the attack the limiter exists to stop.
 *
 * The hour of grace is not correctness — an expired row is reset by the next
 * bump regardless — it just stops the common keys being deleted and reinserted
 * all day.
 */
export async function purgeExpiredRateLimits(): Promise<void> {
  await q("DELETE FROM rate_limit WHERE reset_at < now() - interval '1 hour'");
}

/* ------------------------------------------------------- password reset -- */

/**
 * Only the hash is stored, exactly as for session tokens: a leaked database
 * must not contain anything that can be replayed to take over an account.
 */
export async function createPasswordReset(
  tokenHash: string,
  userId: string,
  expiresAt: string,
): Promise<void> {
  await q(
    `INSERT INTO password_reset (token_hash, user_id, expires_at, created_at)
     VALUES ($1, $2, $3, $4)`,
    [tokenHash, userId, expiresAt, nowIso()],
  );
}

/**
 * Claims a reset token, if it is live, and marks it spent in the same
 * statement.
 *
 * Single-use has to be enforced by the write, not by reading and then writing:
 * two requests arriving together would both see an unused token and both be
 * allowed to set a password. The `used_at IS NULL` in the WHERE clause means
 * exactly one of them updates a row.
 *
 * Claiming one token spends every other live token for the same account, in
 * the same statement. Asking for a second link because the first didn't arrive
 * is the ordinary case, and leaving the first one working for another
 * three-quarters of an hour means an old message — sitting in an inbox, in a
 * mail provider's logs, or in a forwarded thread — can still take the account
 * over after its owner believes they have secured it.
 */
export async function claimPasswordReset(tokenHash: string): Promise<string | null> {
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // Which account this token belongs to, before taking any lock — an
    // unknown token does no work at all.
    const found = await client.query("SELECT user_id FROM password_reset WHERE token_hash = $1", [
      tokenHash,
    ]);
    if (!found.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const userId = found.rows[0].user_id as string;

    /*
     * Everything below touches two rows in an order set by which token was
     * presented, and two claims on two different tokens of the same account
     * therefore reach for each other's rows in opposite order. That is a
     * deadlock, and it is not theoretical: as a single statement it fired 154
     * times in 720 concurrent claims. The exclusive claim was never lost — the
     * database refused one side rather than letting both through — but the
     * refusal surfaced as a 500 where the caller should have been told the
     * link was already used.
     *
     * One lock per account, taken first and released with the transaction,
     * removes the cycle: claims for one account queue, claims for different
     * accounts never meet.
     */
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);

    const now = nowIso();
    const claimed = await client.query(
      `UPDATE password_reset SET used_at = $2
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
        RETURNING user_id`,
      [tokenHash, now],
    );
    if (!claimed.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    // Every other live link for this account goes with it.
    await client.query(
      `UPDATE password_reset SET used_at = $2
        WHERE user_id = $1 AND token_hash <> $3 AND used_at IS NULL`,
      [userId, now, tokenHash],
    );

    await client.query("COMMIT");
    return userId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await q("UPDATE app_user SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
}

/**
 * Signs every device out.
 *
 * Run after a password change, because the reason someone resets a password is
 * usually that they think somebody else has it — and leaving that person's
 * session alive makes the reset theatre.
 */
export async function deleteSessionsFor(userId: string): Promise<void> {
  await q("DELETE FROM session WHERE user_id = $1", [userId]);
}

/** Old and spent tokens, cleared opportunistically like expired sessions. */
export async function purgeExpiredResets(): Promise<void> {
  await q("DELETE FROM password_reset WHERE expires_at <= $1", [nowIso()]);
}

export async function createSession(
  tokenHash: string,
  userId: string,
  expiresAt: string,
): Promise<void> {
  await q(
    `INSERT INTO session (token_hash, user_id, expires_at, created_at)
     VALUES ($1, $2, $3, $4)`,
    [tokenHash, userId, expiresAt, nowIso()],
  );
}

/** The account behind a session token, or null if it's unknown or expired. */
export async function userForSession(tokenHash: string): Promise<AccountRow | null> {
  const r = await one(
    `SELECT u.* FROM session s
       JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [tokenHash, nowIso()],
  );
  return r
    ? {
        id: r.id as string,
        email: r.email as string,
        passwordHash: r.password_hash as string,
        createdAt: r.created_at as string,
      }
    : null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await q("DELETE FROM session WHERE token_hash = $1", [tokenHash]);
}

/** Housekeeping: expired rows are dead weight and nothing else reads them. */
export async function purgeExpiredSessions(): Promise<void> {
  await q("DELETE FROM session WHERE expires_at <= $1", [nowIso()]);
}

/* --------------------------------------------------------------- profile -- */

function rowToProfile(row: Row): Profile {
  return {
    id: row.id as string,
    name: row.name as string,
    unit: row.unit as Profile["unit"],
    ...(row.data as object),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  } as Profile;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const row = await one("SELECT * FROM profile WHERE user_id = $1", [userId]);
  return row ? rowToProfile(row) : null;
}

export function emptyProfile(id: string): Profile {
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

export async function saveProfile(userId: string, profile: Profile): Promise<Profile> {
  const { name, unit, createdAt, ...rest } = profile;
  delete (rest as { id?: string }).id;
  const now = nowIso();
  await q(
    `INSERT INTO profile (id, user_id, name, unit, data, created_at, updated_at)
     VALUES ($1, $1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, unit = EXCLUDED.unit,
       data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [userId, name, unit, JSON.stringify(rest), createdAt ?? now, now],
  );
  return { ...profile, id: userId, updatedAt: now };
}

/** Always returns something, so pages never have to null-check the profile. */
export async function getOrCreateProfile(userId: string): Promise<Profile> {
  return (await getProfile(userId)) ?? (await saveProfile(userId, emptyProfile(userId)));
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
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<Garment[]> {
  const rows = await q(
    opts.includeArchived
      ? `SELECT * FROM garment WHERE user_id = $1
           ORDER BY created_at DESC LIMIT ${MAX_ROWS}`
      : `SELECT * FROM garment WHERE user_id = $1 AND archived_at IS NULL
           ORDER BY created_at DESC LIMIT ${MAX_ROWS}`,
    [userId],
  );
  return rows.map(rowToGarment);
}

export async function getGarment(userId: string, id: string): Promise<Garment | null> {
  const row = await one("SELECT * FROM garment WHERE id = $1 AND user_id = $2", [id, userId]);
  return row ? rowToGarment(row) : null;
}

export async function getGarments(userId: string, ids: string[]): Promise<Garment[]> {
  if (!ids.length) return [];
  const rows = await q(
    `SELECT * FROM garment WHERE user_id = $1 AND id = ANY($2::text[]) LIMIT ${MAX_ROWS}`,
    [userId, ids],
  );
  const byId = new Map(rows.map((r) => [r.id as string, rowToGarment(r)]));
  // Preserve the caller's ordering — outfit slot order is meaningful.
  return ids.map((id) => byId.get(id)).filter((x): x is Garment => Boolean(x));
}

export async function saveGarment(userId: string, garment: Garment): Promise<Garment> {
  const {
    id, name, category, subcategory, brand, careState, formality,
    wearCount, lastWornAt, archivedAt, createdAt, ...rest
  } = garment;
  const now = nowIso();
  await q(
    `INSERT INTO garment (id, user_id, name, category, subcategory, brand, care_state, formality,
                          wear_count, last_worn_at, archived_at, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, subcategory = EXCLUDED.subcategory,
       brand = EXCLUDED.brand, care_state = EXCLUDED.care_state, formality = EXCLUDED.formality,
       wear_count = EXCLUDED.wear_count, last_worn_at = EXCLUDED.last_worn_at,
       archived_at = EXCLUDED.archived_at, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
     WHERE garment.user_id = EXCLUDED.user_id`,
    [
      id, userId, name, category, subcategory, brand ?? null, careState, formality,
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
export async function deleteGarment(userId: string, id: string): Promise<boolean> {
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT data FROM garment WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return false;
    }
    const imageIds: string[] = (rows[0]?.data?.imageIds as string[]) ?? [];
    await client.query("DELETE FROM garment WHERE id = $1 AND user_id = $2", [id, userId]);
    await client.query("DELETE FROM fit_feedback WHERE garment_id = $1 AND user_id = $2", [id, userId]);
    if (imageIds.length) {
      await client.query(
        "DELETE FROM image WHERE id = ANY($1::text[]) AND user_id = $2",
        [imageIds, userId],
      );
    }
    await client.query("COMMIT");
    return true;
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

export async function listOutfits(userId: string): Promise<Outfit[]> {
  const rows = await q(
    `SELECT * FROM outfit WHERE user_id = $1
       ORDER BY pinned DESC, updated_at DESC LIMIT ${MAX_ROWS}`,
    [userId],
  );
  return rows.map(rowToOutfit);
}

export async function getOutfit(userId: string, id: string): Promise<Outfit | null> {
  const row = await one("SELECT * FROM outfit WHERE id = $1 AND user_id = $2", [id, userId]);
  return row ? rowToOutfit(row) : null;
}

export async function saveOutfit(userId: string, outfit: Outfit): Promise<Outfit> {
  const { id, name, occasion, pinned, scoreSnapshot, createdAt, ...rest } = outfit;
  const now = nowIso();
  await q(
    `INSERT INTO outfit (id, user_id, name, occasion, pinned, score, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, occasion = EXCLUDED.occasion, pinned = EXCLUDED.pinned,
       score = EXCLUDED.score, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
     WHERE outfit.user_id = EXCLUDED.user_id`,
    [
      id, userId, name ?? null, occasion ?? null, Boolean(pinned), scoreSnapshot ?? null,
      JSON.stringify(rest), createdAt ?? now, now,
    ],
  );
  return { ...outfit, updatedAt: now };
}

export async function deleteOutfit(userId: string, id: string): Promise<void> {
  await q("DELETE FROM outfit WHERE id = $1 AND user_id = $2", [id, userId]);
}

/* -------------------------------------------------------------- wear log -- */

function rowToWearLog(row: Row): WearLog {
  return {
    id: row.id as string,
    date: row.date as string,
    outfitId: (row.outfit_id as string) ?? null,
    occasion: (row.occasion as WearLog["occasion"]) ?? undefined,
    ...(row.data as object),
    createdAt: row.created_at as string,
  } as WearLog;
}

export async function listWearLogs(userId: string, sinceDays = 120): Promise<WearLog[]> {
  const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const rows = await q(
    `SELECT * FROM wear_log WHERE user_id = $1 AND date >= $2
       ORDER BY date DESC LIMIT ${MAX_ROWS}`,
    [userId, cutoff],
  );
  return rows.map(rowToWearLog);
}

/**
 * Records the wear and rolls the derived counters on each garment, in one
 * transaction — a half-applied wear would leave the rotation scores wrong.
 */
export async function logWear(userId: string, log: WearLog): Promise<WearLog> {
  const { id, date, outfitId, occasion, createdAt, ...rest } = log;
  const now = nowIso();
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO wear_log (id, user_id, date, outfit_id, occasion, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [id, userId, date, outfitId ?? null, occasion ?? null, JSON.stringify(rest), createdAt ?? now],
    );
    await client.query(
      `UPDATE garment
          SET wear_count = wear_count + 1,
              last_worn_at = CASE
                WHEN last_worn_at IS NULL OR last_worn_at < $1 THEN $1 ELSE last_worn_at END,
              updated_at = $2
        WHERE user_id = $3 AND id = ANY($4::text[])`,
      [date, now, userId, log.garmentIds],
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

export async function deleteWearLog(userId: string, id: string): Promise<void> {
  await q("DELETE FROM wear_log WHERE id = $1 AND user_id = $2", [id, userId]);
}

/* ----------------------------------------------------------- calibration -- */

export async function listCalibrations(userId: string): Promise<BrandCalibration[]> {
  const rows = await q(`SELECT * FROM brand_calibration WHERE user_id = $1 LIMIT ${MAX_ROWS}`, [
    userId,
  ]);
  return rows.map((r) => ({
    brand: r.brand as string,
    category: r.category as BrandCalibration["category"],
    easeBiasCm: r.ease_bias_cm as number,
    sampleCount: r.sample_count as number,
    updatedAt: r.updated_at as string,
  }));
}

export async function saveCalibration(userId: string, c: BrandCalibration): Promise<void> {
  await q(
    `INSERT INTO brand_calibration (user_id, brand, category, ease_bias_cm, sample_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, brand, category) DO UPDATE SET
       ease_bias_cm = EXCLUDED.ease_bias_cm,
       sample_count = EXCLUDED.sample_count,
       updated_at = EXCLUDED.updated_at`,
    [userId, c.brand.trim().toLowerCase(), c.category, c.easeBiasCm, c.sampleCount, c.updatedAt],
  );
}

export async function listFitFeedback(userId: string, garmentId?: string): Promise<FitFeedback[]> {
  const rows = garmentId
    ? await q(
        `SELECT * FROM fit_feedback WHERE user_id = $1 AND garment_id = $2 LIMIT ${MAX_ROWS}`,
        [userId, garmentId],
      )
    : await q(`SELECT * FROM fit_feedback WHERE user_id = $1 LIMIT ${MAX_ROWS}`, [userId]);
  return rows.map((r) => ({
    id: r.id as string,
    garmentId: r.garment_id as string,
    landmark: r.landmark as FitFeedback["landmark"],
    verdict: r.verdict as FitFeedback["verdict"],
    createdAt: r.created_at as string,
  }));
}

export async function saveFitFeedback(userId: string, f: FitFeedback): Promise<void> {
  await q(
    `INSERT INTO fit_feedback (id, user_id, garment_id, landmark, verdict, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [f.id, userId, f.garmentId, f.landmark, f.verdict, f.createdAt],
  );
}

/* ---------------------------------------------------------------- images -- */

export interface ImageRecord {
  id: string;
  mime: string;
  kind: string;
  createdAt: string;
}

export async function saveImage(userId: string, rec: ImageRecord, bytes: Buffer): Promise<void> {
  await q(
    "INSERT INTO image (id, user_id, mime, kind, bytes, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [rec.id, userId, rec.mime, rec.kind, bytes, rec.createdAt],
  );
}

export async function getImageRecord(userId: string, id: string): Promise<ImageRecord | null> {
  const r = await one(
    "SELECT id, mime, kind, created_at FROM image WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!r) return null;
  return {
    id: r.id as string,
    mime: r.mime as string,
    kind: r.kind as string,
    createdAt: r.created_at as string,
  };
}

/**
 * How much of the photo budget an account has spent.
 *
 * `octet_length` on a bytea is the stored length, so this is the real cost
 * rather than a running total kept alongside it — a counter would drift the
 * first time a delete failed halfway.
 */
export async function imageBytesUsed(userId: string): Promise<number> {
  const r = await one(
    "SELECT coalesce(sum(octet_length(bytes)), 0)::bigint AS used FROM image WHERE user_id = $1",
    [userId],
  );
  // bigint arrives as a string from pg, since it can exceed Number precision.
  return Number(r?.used ?? 0);
}

/**
 * Rows an account owns, for the two caps that are counted rather than sized.
 *
 * Archived garments do not count. They are hidden rather than deleted, and a
 * cap that counted them would refuse a new item while telling the person to
 * archive something — which would have changed nothing.
 *
 * `table` is interpolated because a table name cannot be a bind parameter.
 * Both call sites pass a literal from the union above, so nothing from a
 * request reaches this string.
 */
export async function countOwned(
  userId: string,
  table: "garment" | "outfit",
): Promise<number> {
  const r = await one(
    table === "garment"
      ? "SELECT count(*)::int AS n FROM garment WHERE user_id = $1 AND archived_at IS NULL"
      : "SELECT count(*)::int AS n FROM outfit WHERE user_id = $1",
    [userId],
  );
  return (r?.n as number) ?? 0;
}

/** Metadata and bytes together, for serving and for inlining into try-on calls. */
export async function getImage(
  userId: string,
  id: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await one("SELECT mime, bytes FROM image WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!r) return null;
  return { mime: r.mime as string, bytes: r.bytes as Buffer };
}

/* --------------------------------------------------------- the whole lot -- */

/**
 * Every table this account owns, in one object.
 *
 * Deliberately not built from the list functions above: those carry defaults
 * that are right for a screen and wrong for an export — `listWearLogs` shows
 * the last 120 days, `listGarments` hides archived items. An export that
 * quietly drops four fifths of someone's history is worse than no export,
 * because they will believe they have a copy.
 *
 * Photo bytes are not inlined. Base64 of a full image budget is a third of a
 * gigabyte of JSON, which no browser will hold and no editor will open, so
 * each photo is listed with its size and the URL that serves it.
 */
export async function exportAccount(userId: string) {
  const account = await getUserById(userId);
  if (!account) return null;

  const [profileRows, garments, outfits, wearLogs, feedback, calibrations, images] =
    await Promise.all([
      q("SELECT * FROM profile WHERE user_id = $1", [userId]),
      q("SELECT * FROM garment  WHERE user_id = $1 ORDER BY created_at", [userId]),
      q("SELECT * FROM outfit   WHERE user_id = $1 ORDER BY created_at", [userId]),
      q("SELECT * FROM wear_log WHERE user_id = $1 ORDER BY date", [userId]),
      q("SELECT * FROM fit_feedback WHERE user_id = $1 ORDER BY created_at", [userId]),
      q("SELECT * FROM brand_calibration WHERE user_id = $1 ORDER BY brand", [userId]),
      q(
        `SELECT id, mime, kind, created_at, octet_length(bytes) AS size_bytes
           FROM image WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      ),
    ]);

  return {
    exportedAt: nowIso(),
    account: { id: account.id, email: account.email, createdAt: account.createdAt },
    profile: profileRows[0] ? rowToProfile(profileRows[0]) : null,
    garments: garments.map(rowToGarment),
    outfits: outfits.map(rowToOutfit),
    wearLogs: wearLogs.map(rowToWearLog),
    fitFeedback: feedback.map((r) => ({
      id: r.id as string,
      garmentId: r.garment_id as string,
      landmark: r.landmark as string,
      verdict: r.verdict as string,
      createdAt: r.created_at as string,
    })),
    brandCalibrations: calibrations.map((r) => ({
      brand: r.brand as string,
      category: r.category as string,
      easeBiasCm: r.ease_bias_cm as number,
      sampleCount: r.sample_count as number,
      updatedAt: r.updated_at as string,
    })),
    photos: images.map((r) => ({
      id: r.id as string,
      mime: r.mime as string,
      kind: r.kind as string,
      sizeBytes: Number(r.size_bytes ?? 0),
      url: `/api/images/${r.id as string}`,
      createdAt: r.created_at as string,
    })),
  };
}

/**
 * Removes an account and everything it owns.
 *
 * `user_id` on the data tables is a bare TEXT column with no foreign key —
 * it has to be, because rows predating accounts carry NULL and a NOT VALID
 * constraint would have blocked the migration. So `DELETE FROM app_user`
 * cascades to sessions and reset tokens and *nothing else*: the wardrobe,
 * the photos and the wear history would all survive, pointing at a user that
 * no longer exists, invisible to every query and impossible to remove through
 * the app. Each table is therefore named explicitly here.
 *
 * One transaction, so a failure halfway leaves the account intact and
 * retryable rather than half-erased.
 */
export async function deleteAccount(userId: string): Promise<boolean> {
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    for (const table of [
      "image", "fit_feedback", "brand_calibration", "wear_log", "outfit", "garment", "profile",
    ]) {
      await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
    // Sessions and reset tokens go with this one, by cascade.
    const res = await client.query("DELETE FROM app_user WHERE id = $1", [userId]);
    await client.query("COMMIT");
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
