/**
 * Password hashing and session tokens.
 *
 * Both are built on `node:crypto` rather than a dependency. The app already
 * asks for nothing but a database, and an auth library would be a large amount
 * of surface area for what is, at this size, two well-understood primitives:
 * a memory-hard password hash, and a random bearer token that is stored hashed.
 */
import {
  randomBytes,
  scrypt as scryptCb,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/*
 * N=16384, r=8, p=1 is the classic interactive-login parameter set: roughly
 * 100ms and 16MB per hash. Enough to make offline cracking expensive without
 * making a login feel slow. The parameters are stored alongside each hash so
 * they can be raised later without invalidating existing passwords.
 */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 64;
// Default maxmem is 32MB; 128 * N * r is 16MB, so give it headroom.
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { ...PARAMS, maxmem: MAXMEM });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  if (!salt.length || !expected.length) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* --------------------------------------------------------------- tokens -- */

export const SESSION_COOKIE = "fitcheck_session";
export const SESSION_DAYS = 30;

/**
 * The cookie value is the only copy of the token that exists in plaintext.
 * Only its SHA-256 is stored, so a leaked database still doesn't let anyone
 * impersonate a signed-in user. SHA-256 is right here where scrypt is not:
 * the input is already 256 bits of entropy, so there is nothing to brute-force
 * and stretching would only slow every request down.
 */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry(from = new Date()): string {
  return new Date(from.getTime() + SESSION_DAYS * 86400000).toISOString();
}

/* ------------------------------------------------------------ validation -- */

/** Deliberately permissive — the only real test of an address is delivery. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailProblem(email: string): string | null {
  if (!EMAIL.test(email)) return "That doesn't look like an email address.";
  if (email.length > 254) return "That email address is too long.";
  return null;
}

/**
 * Length is the property that actually matters, so the floor is high enough to
 * be worth something and there are no composition rules — they push people
 * toward `Password1!` and buy nothing.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}
