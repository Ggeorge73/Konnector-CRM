/** Data quality (KCRM-78) constants and row shape, shared by the service and the client view. */

/** An open deal with no timeline activity for longer than this many days is "stale". */
export const STALE_DEAL_DAYS = 30;

export const DQ_RULES = [
  "unowned_accounts",
  "overdue_opportunities",
  "incomplete_opportunities",
  "contacts_without_email",
  "stale_deals",
] as const;
export type DqRule = (typeof DQ_RULES)[number];

export interface DqRow {
  id: string;
  /** The record's name. */
  label: string;
  /** Context, e.g. the account. */
  context: string;
  /** What is wrong, in words. */
  issue: string;
  /** Where to fix it. */
  href: string;
}
