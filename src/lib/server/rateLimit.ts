import "server-only";
import { bumpRateLimit, ready, refundRateLimit } from "@/lib/db";

/**
 * Fixed-window rate limiting, in Postgres.
 *
 * In-memory counters are a lie the moment a second instance starts — and this
 * app is deliberately stateless so it can scale past one, so the limiter has to
 * live where the shared state already does. One round trip per attempt against
 * a database the request was going to touch anyway.
 *
 * Fixed windows over sliding ones on purpose: a sliding window needs a row per
 * attempt and a periodic sweep, and the extra precision buys nothing here. The
 * worst case is someone getting two windows' worth of attempts across a window
 * boundary, which for a login limit of eight is a burst of sixteen. That is
 * still nowhere near enough attempts to guess a password.
 */

export interface Verdict {
  ok: boolean;
  /** Seconds until the window resets. Only meaningful when `ok` is false. */
  retryAfter: number;
}

export interface Limit {
  /** Attempts allowed inside one window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/*
 * Login is the expensive one: every attempt runs scrypt at N=16384, which is
 * ~100ms of CPU by design. Unlimited attempts are a denial-of-service against
 * the server long before they are a threat to any password, so this protects
 * the instance as much as the account.
 *
 * Note which key each limit is meant for. A limit keyed on something the
 * caller supplies about *somebody else* — an email address, most of all — is
 * a different kind of object from one keyed on the caller, and mixing them up
 * is how a rate limiter becomes a way to lock a stranger out of their own
 * account. See the comment on the login route.
 */
export const LIMITS = {
  /** Per caller *and* address together: one source guessing at one account. */
  login: { max: 8, windowSeconds: 300 },
  /** Per caller, across every account: one source spraying many accounts. */
  loginSource: { max: 40, windowSeconds: 300 },
  /**
   * Per address, across every caller. Deliberately loose, and deliberately
   * never allowed to refuse a correct password — it exists to stop a
   * distributed attack grinding on one account, not to lock its owner out.
   */
  loginAddress: { max: 60, windowSeconds: 900 },
  signup: { max: 5, windowSeconds: 3600 },
  /** Per caller. A hard refusal, because it is the caller's own budget. */
  passwordReset: { max: 5, windowSeconds: 3600 },
  /**
   * Per recipient address, across every caller. Short, because anyone can fill
   * it and nobody should be shut out of recovering their account for long.
   */
  resetInbox: { max: 4, windowSeconds: 900 },
  /** Each one makes the server fetch a URL a stranger chose. */
  import: { max: 20, windowSeconds: 600 },
} satisfies Record<string, Limit>;

/** Counts one attempt against `key` and says whether it is allowed. */
export async function consume(key: string, limit: Limit): Promise<Verdict> {
  await ready();
  const { count, resetAt } = await bumpRateLimit(key, limit.windowSeconds);
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  return { ok: count <= limit.max, retryAfter };
}

/**
 * Undoes one attempt.
 *
 * A successful login shouldn't leave someone a step closer to being locked
 * out — the limit is there to slow down guessing, and a correct password is
 * not a guess.
 */
export async function refund(key: string): Promise<void> {
  await ready().catch(() => {});
  await refundRateLimit(key).catch(() => {});
}

/**
 * Who to count against, when there is no account yet.
 *
 * Behind Railway, Vercel and every other proxy the socket address is the
 * proxy's, so the client is the first entry in `x-forwarded-for`. That header
 * is trivially spoofable by anyone talking to the origin directly, which is
 * why it is only ever *one* of the keys a request is counted against and never
 * the only one — the login limiter also counts per address, which no header
 * can forge.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

/** The 429 every limited route returns, with the header a client can act on. */
export function tooMany(retryAfter: number, what: string) {
  return Response.json(
    {
      error: `Too many ${what}. Try again in ${
        retryAfter < 90 ? `${retryAfter} seconds` : `${Math.ceil(retryAfter / 60)} minutes`
      }.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
