import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { isMailProvider, mailClient, pkceVerifier, verifyState } from "@/lib/mail";
import { getStore } from "@/lib/server/store";
import { saveConnection } from "@/lib/services/mail";

/**
 * OAuth redirect target. Not public: middleware requires the CRM session cookie, and the signed
 * state must name the same signed-in user, so a code can only ever attach to its initiator.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const q = req.nextUrl.searchParams;
  const back = (p: Record<string, string>) => NextResponse.redirect(new URL(`/connections?${new URLSearchParams(p)}`, req.url));
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!isMailProvider(provider)) return back({ error: "Unknown provider." });
  if (q.get("error")) return back({ error: q.get("error_description") ?? q.get("error") ?? "Access was not granted." });
  const state = q.get("state") ?? "";
  const code = q.get("code") ?? "";
  if (!code || !verifyState(state, { uid: user.id, provider })) {
    return back({ error: "That sign-in link expired or belongs to another session. Try connecting again." });
  }
  try {
    const tokens = await mailClient(provider, req.nextUrl.origin).exchangeCode(code, pkceVerifier(state));
    await saveConnection({ user, store: await getStore(), now: new Date() }, provider, tokens);
  } catch (e) {
    console.error("mail oauth callback", e instanceof Error ? e.message : e);
    return back({ error: "We couldn't finish connecting your mailbox. Please try again." });
  }
  return back({ connected: provider });
}
