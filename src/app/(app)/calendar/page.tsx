import { CalendarView } from "@/components/calendar/CalendarView";
import { bidDeadlines, monthKey, parseMonth } from "@/lib/services/compliance";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Bid calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const c = await ctx("/calendar");
  const { month } = await searchParams;
  // "Today" in the viewer's time zone, not the server's.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: c.user.time_zone || "America/New_York" }).format(c.now);
  const { year, month: m } = parseMonth(month, new Date(`${today}T12:00:00Z`));
  return (
    <CalendarView
      entries={await bidDeadlines(c)}
      month={monthKey(year, m)}
      prev={monthKey(year, m - 1)}
      next={monthKey(year, m + 1)}
      thisMonth={today.slice(0, 7)}
      today={today}
    />
  );
}
