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
  /**
   * Per account. The wear log is the one table with no row cap — a wear is a
   * fact about a day and refusing a real one would be wrong — so this is what
   * stops a loop filling it. Sixty an hour is far more than anyone dresses.
   */
  wear: { max: 60, windowSeconds: 3600 },
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

export interface Caller {
  /** The key component to count against. */
  id: string;
  /**
   * Whether `id` names one caller, rather than standing in for everybody.
   *
   * This is the difference between a counter that bounds an attacker and a
   * counter that bounds the whole instance, and every caller-keyed limit has
   * to check it before it is allowed to refuse anyone.
   */
  identified: boolean;
}

let warned = false;

/**
 * Who to count against, when there is no account yet.
 *
 * Behind Railway, Vercel and every other proxy the socket address is the
 * proxy's, so the client is the first entry in `x-forwarded-for`.
 *
 * In practice something is nearly always there: `next start` fills the header
 * in from the socket address when the client sends none, so a deployment with
 * no proxy at all still gets one identity per host rather than one for
 * everybody. The `identified: false` path is the case that arises if that ever
 * stops being true — a different adapter, a custom server, a future release.
 *
 * It matters enough to guard because a route that treats a shared constant as
 * an identity is a disaster rather than a degradation: every visitor on one
 * counter means eight junk requests lock out the account they name and forty
 * lock out the instance. Callers check `identified` and downgrade a gate to a
 * tiebreak rather than assume.
 *
 * None of this makes the value *trustworthy*. A client talking straight to the
 * origin can put whatever it likes in the header, and Next passes that through
 * in preference to the socket address — so per-caller limits are evadable by
 * anyone who bothers. That is why nothing important rests on them alone: the
 * limits that must hold are keyed on the email address, which no header can
 * change.
 */
export function caller(req: Request): Caller {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  const id = first || req.headers.get("x-real-ip")?.trim();
  if (id) return { id, identified: true };

  if (!warned) {
    warned = true;
    console.warn(
      "[ratelimit] No X-Forwarded-For or X-Real-IP on an unauthenticated request. " +
        "Callers cannot be told apart, so per-caller limits are advisory only. " +
        "Run this behind a proxy that sets one of those headers.",
    );
  }
  return { id: "unidentified", identified: false };
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
