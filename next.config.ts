import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway builds a container and runs `next start`, so the standalone output
  // isn't needed — but `pg` must stay external or webpack tries to bundle its
  // optional native dependencies.
  serverExternalPackages: ["pg", "sharp"],
  experimental: {
    // Uploaded garment photos can be a few MB before the client downscales them.
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [
      {
        /*
         * A stale service worker is the one caching bug you cannot fix with a
         * deploy, because the stale copy is what decides whether to fetch the
         * new one. Browsers already bypass the HTTP cache for this file, but
         * only up to 24 hours, and the intermediaries between here and the
         * phone make no such promise.
         */
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
