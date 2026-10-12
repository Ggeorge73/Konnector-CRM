/**
 * Builds the text Claude sees for each Copilot task — only through the role-scoped services,
 * and only from explicitly picked fields. Cost-side data (unit cost, margins, consultant cost
 * rates, other people's bid scores, vetting) is never read here, so it can't reach a prompt.
 */
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canSeeBench } from "@/lib/auth/permissions";
import { BID_CRITERIA, type RelatedType } from "@/lib/domain/types";
import { dateLabel, humanize, money } from "@/lib/format";
import { getOpportunity } from "@/lib/services/capture";
import type { Ctx } from "@/lib/services/context-types";
import { getAccount, getContact, timelineFor, usersById, visibleOpportunities } from "@/lib/services/core";
import { orgSettings } from "@/lib/services/pulse";

const clip = (s: string | null | undefined, n = 400) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");

async function timelineText(c: Ctx, type: RelatedType, id: string, limit = 25) {
  const [acts, users] = await Promise.all([timelineFor(c, type, id), usersById(c)]);
  return acts
    .slice(0, limit)
    .map(
      (a) =>
        `- ${a.occurred_at.slice(0, 10)} [${a.type}] ${a.subject}${a.actor_id ? ` (${users.get(a.actor_id)?.full_name ?? "?"})` : ""}${a.body ? `: ${clip(a.body, 300)}` : ""}`,
    )
    .join("\n");
}

export async function accountContext(c: Ctx, accountId: string) {
  const a = await getAccount(c, accountId);
  const [contacts, opps, health, items, users] = await Promise.all([
    c.store.list("contacts", { where: { account_id: a.id } }),
    visibleOpportunities(c).then((o) => o.filter((x) => x.account_id === a.id)),
    c.store.list("project_health", { where: { account_id: a.id } }),
    c.store.list("client_items", { where: { account_id: a.id } }),
    usersById(c),
  ]);
  return [
    `# Account: ${a.name}`,
    `Type: ${humanize(a.type)} · Sector: ${a.sector} · ${[a.city, a.state_region, a.country].filter(Boolean).join(", ")} · Tier ${a.tier} · Status: ${humanize(a.status)} · Owner: ${users.get(a.owner_id)?.full_name ?? "?"}`,
    a.description ? `About: ${clip(a.description)}` : "",
    a.survey_score !== null ? `Latest client satisfaction survey: ${a.survey_score}/10` : "",
    `\n## Contacts`,
    contacts.map((x) => `- ${x.first_name} ${x.last_name}, ${x.title ?? "?"} (${humanize(x.role_in_buying)})`).join("\n") || "- none",
    `\n## Opportunities (visible to the requesting user)`,
    opps
      .map(
        (o) =>
          `- ${o.name}: ${humanize(o.stage)}, ${money(o.value, o.currency)}, ${humanize(o.kind)}${o.proposal_due ? `, proposal due ${o.proposal_due}` : ""}${o.next_step ? `, next step: ${o.next_step}` : ""}${o.lost_reason ? `, lost: ${o.lost_reason}` : ""}`,
      )
      .join("\n") || "- none",
    `\n## Delivery health from Konnect Hub`,
    health
      .map(
        (h) =>
          `- ${h.project_name}: schedule ${h.health_schedule}, budget ${h.health_budget}, acceptance ${h.health_acceptance}, ${h.percent_complete}% complete`,
      )
      .join("\n") || "- no live projects",
    `\n## Items shared with the client`,
    items
      .filter((i) => i.status !== "superseded")
      .map(
        (i) =>
          `- ${i.title} (${humanize(i.type)}): ${humanize(i.status)}${i.decision_note ? ` — client said: ${clip(i.decision_note, 200)}` : ""}`,
      )
      .join("\n") || "- none",
    `\n## Recent timeline`,
    (await timelineText(c, "account", a.id, 30)) || "- empty",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Context for a follow-up email from an opportunity or contact record. */
export async function followupContext(c: Ctx, type: RelatedType, id: string) {
  if (type === "opportunity") {
    const o = await getOpportunity(c, id);
    const a = await getAccount(c, o.account_id);
    const contacts = await c.store.list("contacts", { where: { account_id: a.id } });
    return {
      recipients: contacts
        .filter((x) => x.email)
        .map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}`, email: x.email!, title: x.title })),
      accountId: a.id,
      text: [
        `# Opportunity: ${o.name} at ${a.name}`,
        `Stage ${humanize(o.stage)} · ${money(o.value, o.currency)} · next step: ${o.next_step ?? "none"}${o.next_step_due ? ` (due ${o.next_step_due})` : ""}`,
        `Client contacts: ${contacts.map((x) => `${x.first_name} ${x.last_name} (${x.title ?? "?"})`).join("; ") || "none"}`,
        `\n## Timeline (newest first)`,
        await timelineText(c, "opportunity", id),
      ].join("\n"),
    };
  }
  if (type === "contact") {
    const { contact, account } = await getContact(c, id);
    return {
      recipients: contact.email
        ? [{ id: contact.id, name: `${contact.first_name} ${contact.last_name}`, email: contact.email, title: contact.title }]
        : [],
      accountId: account.id,
      text: [
        `# Contact: ${contact.first_name} ${contact.last_name}, ${contact.title ?? "?"} at ${account.name}`,
        `\n## Timeline with this contact (newest first)`,
        await timelineText(c, "contact", id),
        `\n## Recent account activity`,
        await timelineText(c, "account", account.id, 10),
      ].join("\n"),
    };
  }
  if (type === "account") {
    const a = await getAccount(c, id);
    const contacts = await c.store.list("contacts", { where: { account_id: a.id } });
    return {
      recipients: contacts
        .filter((x) => x.email)
        .map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}`, email: x.email!, title: x.title })),
      accountId: a.id,
      text: await accountContext(c, id),
    };
  }
  throw new ValidationError("Follow-up drafts work on accounts, contacts and opportunities.");
}

/** Context for a Bid/No-Bid suggestion. Only for people allowed to score the deal. */
export async function bidContext(c: Ctx, opportunityId: string) {
  const o = await getOpportunity(c, opportunityId);
  const a = await getAccount(c, o.account_id);
  const settings = await orgSettings(c);
  const [won, lost, regs] = await Promise.all([
    c.store.list("opportunities", { where: { account_id: a.id, stage: "won" } }),
    c.store.list("opportunities", { where: { account_id: a.id, stage: "lost" } }),
    c.store.list("registrations"),
  ]);
  let bench = "Bench availability: not visible to this user.";
  if (canSeeBench(c.user)) {
    const cons = await c.store.list("consultants");
    const free = cons.filter((x) => x.status === "available" || x.status === "partial");
    bench = `Bench: ${free.length} of ${cons.length} consultants available or partially available. Skills on the bench: ${[...new Set(free.flatMap((x) => x.skills))].slice(0, 30).join(", ")}.`;
  }
  const expiring = regs
    .filter((r) => r.expires_on && r.expires_on <= (o.proposal_due ?? "9999"))
    .map((r) => `${r.name} (expires ${r.expires_on})`);
  return [
    `# Opportunity: ${o.name}`,
    `Account: ${a.name} (${humanize(a.type)}, tier ${a.tier}, ${humanize(a.status)}). Won here before: ${won.length}. Lost here before: ${lost.length}${lost[0]?.lost_reason ? ` (e.g. "${lost[0].lost_reason}")` : ""}.`,
    `Kind: ${humanize(o.kind)} · Value: ${money(o.value, o.currency)} · Service lines: ${o.service_lines.map(humanize).join(", ")} · Source: ${o.source}`,
    o.kind === "public_bid"
      ? `Solicitation ${o.solicitation_no ?? "?"} via ${o.procurement_vehicle ?? "?"}, NAICS ${o.naics ?? "?"}, set-aside ${o.set_aside ?? "none"}, incumbent ${o.incumbent ?? "unknown"}, questions due ${dateLabel(o.questions_due)}, proposal due ${dateLabel(o.proposal_due)}.`
      : "",
    `Next step: ${o.next_step ?? "none"}`,
    bench,
    expiring.length
      ? `Registrations expiring before the proposal is due: ${expiring.join("; ")}`
      : "All registrations current through the proposal date.",
    `\n## Scoring criteria (1 = poor, 5 = excellent) and weights`,
    BID_CRITERIA.map((k) => `- ${k}: weight ${settings.bid_weights[k]}%`).join("\n"),
    `Verdict thresholds: ≥70 bid, 55–69 conditional, <55 no-bid (weighted score out of 100).`,
    `\n## Timeline (newest first)`,
    await timelineText(c, "opportunity", o.id),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function assertCanUseOn(c: Ctx, type: RelatedType | null, id: string | null) {
  if (!type || !id) return;
  if (type === "account") await getAccount(c, id);
  else if (type === "opportunity") await getOpportunity(c, id);
  else if (type === "contact") await getContact(c, id);
  else throw new ForbiddenError("Copilot isn't available on this record type.");
}
