/**
 * Daily email digest per internal user: unread notifications, follow-ups due, bids due this week,
 * items awaiting a client. Sent via Resend when RESEND_API_KEY is set; otherwise returned (demo).
 */
import { APP_NAME } from "@/config/app";
import { canSeeOpportunity, hasRole } from "@/lib/auth/permissions";
import type { ActiveUser } from "@/lib/domain/types";
import { dateLabel } from "@/lib/format";
import type { Ctx } from "./context-types";

export interface Digest {
  to: string;
  subject: string;
  text: string;
  html: string;
  counts: { notifications: number; tasks: number; bids: number; awaiting: number };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export async function buildDigest(c: Ctx, user: ActiveUser): Promise<Digest | null> {
  const today = c.now.toISOString().slice(0, 10);
  const week = new Date(c.now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [notes, tasks, opps, items] = await Promise.all([
    c.store.list("notifications", { where: { user_id: user.id } }),
    c.store.list("tasks", { where: { assignee_id: user.id, status: "open" } }),
    c.store.list("opportunities"),
    c.store.list("client_items", { where: { owner_id: user.id, status: ["published", "viewed"] } }),
  ]);
  const unread = notes.filter((n) => !n.read_at);
  const due = tasks.filter((t) => t.due_at && t.due_at.slice(0, 10) <= today);
  const bids = opps.filter(
    (o) =>
      canSeeOpportunity(user, o) &&
      o.proposal_due &&
      o.proposal_due >= today &&
      o.proposal_due <= week &&
      !["won", "lost", "no_bid"].includes(o.stage),
  );
  if (!unread.length && !due.length && !bids.length && !items.length) return null;
  const sections: Array<[string, string[]]> = [
    ["Follow-ups due", due.map((t) => `${t.title} (due ${dateLabel(t.due_at)})`)],
    ["Bids due this week", bids.map((o) => `${o.name} — proposal due ${dateLabel(o.proposal_due)}`)],
    ["Awaiting client decision", items.map((i) => `${i.title}${i.respond_by ? ` — respond by ${dateLabel(i.respond_by)}` : ""}`)],
    ["Unread notifications", unread.slice(0, 10).map((n) => n.title)],
  ];
  const filled = sections.filter(([, l]) => l.length);
  return {
    to: user.email,
    subject: `${APP_NAME} daily digest — ${due.length} due, ${bids.length} bids this week`,
    text: filled.map(([h, l]) => `${h}\n${l.map((x) => `• ${x}`).join("\n")}`).join("\n\n"),
    html: filled.map(([h, l]) => `<h3>${esc(h)}</h3><ul>${l.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join(""),
    counts: { notifications: unread.length, tasks: due.length, bids: bids.length, awaiting: items.length },
  };
}

export async function sendDigests(c: Ctx) {
  const users = (await c.store.list("users")).filter(hasRole); // pending people get no digest
  const out: Digest[] = [];
  for (const u of users) {
    const d = await buildDigest(c, u);
    if (!d) continue;
    out.push(d);
    if (process.env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.DIGEST_FROM ?? "Konnector CRM <crm@konnectorllc.com>",
          to: d.to,
          subject: d.subject,
          html: d.html,
          text: d.text,
        }),
      });
    }
  }
  return { sent: process.env.RESEND_API_KEY ? out.length : 0, built: out.length };
}
