/*
 * The service worker.
 *
 * Its whole job is to make an installed FitCheck start instantly and say
 * something honest when there is no network. It is deliberately the most
 * conservative service worker it could be, because of one thing:
 *
 *   A Cache Storage bucket belongs to an origin and a browser profile, not to
 *   an account.
 *
 * So anything cached here outlives signing out, and a second person signing in
 * on the same browser would be served the first person's bytes. That rules out
 * caching API responses and it rules out caching pages, both of which are full
 * of one particular person's wardrobe.
 *
 * What is left is the build output — content-hashed, immutable, identical for
 * everybody — plus the icons and an offline notice. That is enough to make the
 * app open instantly and fail gracefully, and it cannot leak anything, because
 * none of it is anybody's.
 *
 * Bump CACHE when the precache list changes; `activate` deletes every older
 * one.
 */
const CACHE = "fitcheck-static-v1";

/** Shipped with the app, needed before the network is known to work. */
const PRECACHE = ["/offline.html", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload` so an install never adopts a stale copy out of the HTTP cache.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      // A precache miss must not leave the old worker in place forever; the
      // runtime cache below still works without it.
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Content-hashed build output and the icons. Nothing else is ever stored. */
function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  return PRECACHE.includes(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /*
   * Navigations: network first, always, and never stored. A page carries the
   * signed-in person's data and must come from the server every time; the only
   * thing the cache contributes is the notice shown when the network is gone.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/offline.html").then((r) => r ?? new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  if (!isCacheable(url)) return; // Straight to the network, untouched.

  /*
   * Cache first for the build output. Every one of these URLs contains a
   * content hash, so a cached copy can never be the wrong version — a changed
   * file is a different URL.
   */
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          // Only complete, same-origin, successful responses. An opaque or
          // partial one stored here would be served back as if it were whole.
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
