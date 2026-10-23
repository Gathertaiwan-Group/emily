import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WordPress served permalinks without a trailing slash and 301-redirected "/x/" -> "/x".
  // The proxy reproduces that 301 itself, so Next's own 308 trailing-slash redirect is disabled.
  skipTrailingSlashRedirect: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
