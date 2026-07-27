import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  experimental: {
    // Uploaded garment photos can be a few MB before the client downscales them.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
