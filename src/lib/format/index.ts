import { differenceInCalendarDays, formatDistanceToNowStrict } from "date-fns";

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", NGN: "₦" };

/** Deterministic compact money ($2.4M) — identical on server and browser, so no hydration drift. */
function compactMoney(value: number, currency: string) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const n = abs / div;
  const text = suffix ? (n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString()) : Math.round(abs).toString();
  const sym = SYMBOL[currency];
  return sym ? `${sign}${sym}${text}${suffix}` : `${sign}${text}${suffix} ${currency}`;
}

export function money(value: number | null | undefined, currency = "USD", opts: { compact?: boolean } = {}) {
  if (value === null || value === undefined) return "—";
  if (opts.compact) return compactMoney(value, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function pct(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function dateLabel(value: string | null | undefined, timeZone = "America/New_York") {
  if (!value) return "—";
  const d = value.length === 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(d);
}

export function dateTimeLabel(value: string | null | undefined, timeZone = "America/New_York") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

export function relative(value: string | null | undefined) {
  if (!value) return "—";
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

/** Whole days from today until a date (negative when past). */
export function daysUntil(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const d = value.length === 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return differenceInCalendarDays(d, now);
}

export function humanize(value: string | null | undefined) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
