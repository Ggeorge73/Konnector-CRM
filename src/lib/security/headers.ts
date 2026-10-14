/**
 * Security headers. Static ones are set for every path in next.config.ts; the Content-Security-Policy
 * carries a per-request script nonce, so middleware.ts builds it (see docs/SECURITY.md for the rationale
 * behind each source). Pure and runtime-agnostic: used by next.config, the edge middleware and tests.
 */

export interface CspOptions {
  nonce: string;
  /** `next dev` needs eval for React's dev tooling and Fast Refresh. */
  dev?: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL: the browser talks to Supabase Auth (REST) and Realtime (WebSocket). */
  supabaseUrl?: string;
}

function supabaseOrigins(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return [];
    const ws = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`;
    return [u.origin, ws];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy({ nonce, dev = false, supabaseUrl }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js tags its framework/RSC scripts with the request nonce; 'strict-dynamic' lets those
    // load the route chunks. 'self' is the fallback for browsers without CSP3.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // MUI/emotion inject <style> tags at runtime and React renders style="" attributes. A nonce here
    // would disable 'unsafe-inline' and break style attributes, so styles stay 'unsafe-inline'.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Fonts come from next/font (self-hosted under /_next/static at build time), not Google's CDN.
    "font-src": ["'self'"],
    // Avatars are initials; images are same-origin files. data:/blob: cover MUI icons, the globe's
    // canvas-generated textures and file previews.
    "img-src": ["'self'", "data:", "blob:"],
    "connect-src": ["'self'", ...supabaseOrigins(supabaseUrl)],
    // react-globe.gl (three.js) may spin up workers from blob: URLs for geometry.
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
  "browsing-topics=()",
].join(", ");

/** Headers that don't vary per request. HSTS only in production (it would pin localhost to https). */
export function staticSecurityHeaders(production: boolean): { key: string; value: string }[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
}

/** Random base64 nonce (Web Crypto, so it works in the edge runtime). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
