export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

/** The greeting for the hour it is in the person's time zone, not the server's. */
export function greetingFor(now: Date, timeZone: string): Greeting {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
  );
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Friday, September 18" in the person's time zone. */
export function formatLongDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(now);
}
