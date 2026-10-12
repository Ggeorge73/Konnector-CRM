import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/auth", "/api/integrations", "/api/mock-konnect-hub", "/api/dev", "/api/cron", "/api/public-files", "/api/v1"];

/** Cheap session presence check; full role checks happen server-side in requireUser(). */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const demo = req.cookies.get("kcrm_uid");
  const supa = req.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!demo && !supa) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Expose the path so the (app) layout can apply role route guards in one place.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|webp)$).*)"],
};
