import "server-only";

/**
 * Whether a stranger who finds the URL can create an account.
 *
 * Open by default, because the common case is someone deploying this for
 * themselves and their household, and a closed instance with no way in is a
 * worse first experience than an open one. Set FITCHECK_SIGNUP=closed once
 * the accounts that should exist do — the first account is always permitted
 * regardless, or a closed instance could never be set up at all.
 */
export function signupsClosed(): boolean {
  return (process.env.FITCHECK_SIGNUP ?? "open").toLowerCase() === "closed";
}
