import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Separate build dirs let parallel builds/e2e runs coexist (NEXT_DIST_DIR=.next-xyz).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  // CSV imports (KCRM-75/76) send the file (≤ 5 MB) to a server action; the default limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // Static security headers on every path (static assets included). The nonce-based CSP is set
  // per request in src/middleware.ts. See docs/SECURITY.md.
  async headers() {
    return [{ source: "/:path*", headers: staticSecurityHeaders(process.env.NODE_ENV === "production") }];
  },
};

export default nextConfig;
