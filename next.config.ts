import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway builds a container and runs `next start`, so the standalone output
  // isn't needed — but `pg` must stay external or webpack tries to bundle its
  // optional native dependencies.
  serverExternalPackages: ["pg"],
  experimental: {
    // Uploaded garment photos can be a few MB before the client downscales them.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
