type Level = "debug" | "info" | "warn" | "error";
type Context = Record<string, unknown>;

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|magic|link|url$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function minLevel(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  if (configured && configured in LEVEL_ORDER) return LEVEL_ORDER[configured];
  return process.env.NODE_ENV === "test" ? LEVEL_ORDER.warn : LEVEL_ORDER.debug;
}

function write(level: Level, message: string, context: Context = {}) {
  if (LEVEL_ORDER[level] < minLevel()) return;
  const safe = redact(context) as Context;

  if (process.env.NODE_ENV === "production") {
    // One JSON object per line on stdout/stderr; Docker collects it (DevOps spec §21).
    const line = JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...safe });
    (level === "error" || level === "warn" ? console.error : console.log)(line);
    return;
  }

  const extras = Object.keys(safe).length > 0 ? ` ${JSON.stringify(safe)}` : "";
  const line = `${level.toUpperCase().padEnd(5)} ${message}${extras}`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const logger = {
  debug: (message: string, context?: Context) => write("debug", message, context),
  info: (message: string, context?: Context) => write("info", message, context),
  warn: (message: string, context?: Context) => write("warn", message, context),
  error: (message: string, context?: Context) => write("error", message, context),
};
