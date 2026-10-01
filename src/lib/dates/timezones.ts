export type TimeZoneOption = { value: string; label: string };

// ICU still reports some zones by their pre-rename IANA names (Chrome says "Asia/Calcutta"). Both
// names behave the same, so show and store the modern one people expect.
const LEGACY_ZONE_NAMES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
};

export function modernTimeZoneName(value: string): string {
  return LEGACY_ZONE_NAMES[value] ?? value;
}

/** "GMT+05:30" -> "UTC+05:30", "GMT" -> "UTC+00:00". */
function offsetLabel(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;

  if (!part || part === "GMT") return "UTC+00:00";
  return part.replace("GMT", "UTC");
}

export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * IANA zones for a picker, labelled like "Asia/Kolkata (UTC+05:30)". Always contains `UTC` and
 * `ensure` (the browser's detected zone), since some engines omit aliases from the list.
 */
export function listTimeZones(ensure?: string, at: Date = new Date()): TimeZoneOption[] {
  const names = new Set<string>(Intl.supportedValuesOf("timeZone").map(modernTimeZoneName));
  names.add("UTC");
  if (ensure && isValidTimeZone(ensure)) names.add(modernTimeZoneName(ensure));

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: `${value} (${offsetLabel(value, at)})` }));
}

export function timeZoneLabel(value: string, at: Date = new Date()): string {
  return isValidTimeZone(value) ? `${value} (${offsetLabel(value, at)})` : value;
}
