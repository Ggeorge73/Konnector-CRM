import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/security/headers";

const PUBLIC = [
  "/login",
  "/auth",
  "/api/health",
  "/api/integrations",
  "/api/mock-konnect-hub",
  "/api/dev",
  "/api/cron",
  "/api/public-files",
  "/api/v1",
];

/**
 * Per-request CSP nonce + cheap session presence check; full role checks happen server-side in
 * requireUser(). Next.js reads the nonce from the request's CSP header and applies it to its scripts.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const csp = contentSecurityPolicy({
    nonce: createNonce(),
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const withCsp = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  // Expose the path so the (app) layout can apply role route guards in one place.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  headers.set("content-security-policy", csp);

  if (PUBLIC.some((p) => pathname.startsWith(p))) return withCsp(NextResponse.next({ request: { headers } }));
  const demo = req.cookies.get("kcrm_uid");
  const supa = req.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!demo && !supa) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return withCsp(NextResponse.redirect(url));
  }
  return withCsp(NextResponse.next({ request: { headers } }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|webp)$).*)"],
};
