import "server-only";
import { env } from "@/lib/env";
import type { CalendarProvider } from "../types";
import { createGoogleProvider } from "./google";
import { createMockProvider } from "./mock";

// The one place that picks the provider. Domain code calls `getCalendarProvider()` and never imports a
// provider module directly (V2 feature 12 §4).

let cached: CalendarProvider | null = null;

export function getCalendarProvider(): CalendarProvider {
  if (cached) return cached;
  if (env.calendarProvider === "mock") {
    cached = createMockProvider({
      callbackUrl: `${env.NEXT_PUBLIC_APP_URL}/api/calendar/google/callback`,
    });
  } else if (env.calendarProvider === "google") {
    cached = createGoogleProvider({
      clientId: env.GOOGLE_CALENDAR_CLIENT_ID!,
      clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI!,
    });
  } else {
    throw new Error("Google Calendar is not configured.");
  }
  return cached;
}
