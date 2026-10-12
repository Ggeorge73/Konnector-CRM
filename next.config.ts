import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dirs let parallel builds/e2e runs coexist (NEXT_DIST_DIR=.next-xyz).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
