import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { isMailProvider, mailClient, pkceChallenge, pkceVerifier, signState } from "@/lib/mail";

/** Begin connecting the signed-in user's own mailbox: signed state (user + nonce, 10 min) and PKCE S256. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = (q: Record<string, string>) => NextResponse.redirect(new URL(`/connections?${new URLSearchParams(q)}`, req.url));
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!isMailProvider(provider)) return back({ error: "Unknown provider." });
  let url: string;
  try {
    const client = mailClient(provider, req.nextUrl.origin);
    const state = signState(user.id, provider);
    url = client.authUrl(state, { codeChallenge: pkceChallenge(pkceVerifier(state)), loginHint: user.email });
  } catch (e) {
    return back({ error: e instanceof Error ? e.message : "Provider is not configured." });
  }
  return NextResponse.redirect(url);
}
