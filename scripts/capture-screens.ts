// Captures the key screens of a running Dayboard, signed in as the seeded demo user.
// One script for three jobs (feature 07 §11.1): "before"/"after" sets, marketing images, and a
// quick look at every screen in both themes.
//
//   pnpm capture:screens -- --base http://localhost:3200 --out ../shots/before
//   pnpm capture:screens -- --only today,tasks --widths 1440 --themes light
//
// It never starts or stops a server, and it only reads: it signs in and looks.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

type Screen = {
  name: string;
  path: string;
  signedIn: boolean;
  ready?: (page: Page) => Promise<void>;
};

const SCREENS: Screen[] = [
  { name: "landing", path: "/", signedIn: false },
  { name: "sign-in", path: "/sign-in", signedIn: false },
  { name: "sign-up", path: "/sign-up", signedIn: false },
  { name: "today", path: "/today", signedIn: true },
  { name: "tasks", path: "/tasks", signedIn: true },
  { name: "todos", path: "/tasks?view=todos", signedIn: true },
  { name: "projects", path: "/projects", signedIn: true },
  { name: "notes", path: "/notes", signedIn: true },
  { name: "notes-grid", path: "/notes?view=grid", signedIn: true },
  { name: "inbox", path: "/inbox", signedIn: true },
  { name: "search", path: "/search?q=client", signedIn: true },
  { name: "trash", path: "/trash", signedIn: true },
  { name: "settings", path: "/settings/appearance", signedIn: true },
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const base = arg("base", "http://localhost:3200");
const out = path.resolve(arg("out", "shots"));
const email = arg("email", "demo@dayboard.local");
const password = arg("password", "demo-password-1234");
const only = arg("only", "").split(",").filter(Boolean);
const widths = arg("widths", "1440,390").split(",").map(Number);
const themes = arg("themes", "light,dark").split(",") as ("light" | "dark")[];

async function signIn(page: Page) {
  await page.goto(`${base}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(today|onboarding)/, { timeout: 20_000 });
}

// A fresh private address per browser context, like the E2E fixtures, so repeated sign-ins never
// trip the sign-in rate limit (it is keyed by client address).
function clientIp(): string {
  const n = Math.floor(Math.random() * 0xffffff);
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });
let count = 0;

try {
  for (const theme of themes) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: width < 768 ? 844 : 900 },
        deviceScaleFactor: width < 768 ? 2 : 1,
        colorScheme: theme,
        timezoneId: "Asia/Kolkata",
        reducedMotion: "reduce",
        extraHTTPHeaders: { "x-forwarded-for": clientIp() },
      });
      const page = await context.newPage();
      const signedOut = await browser.newContext({
        viewport: { width, height: width < 768 ? 844 : 900 },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      const visitor = await signedOut.newPage();
      await signIn(page);

      for (const screen of SCREENS) {
        if (only.length && !only.includes(screen.name)) continue;
        const target = screen.signedIn ? page : visitor;
        await target.goto(`${base}${screen.path}`, { waitUntil: "networkidle" });
        await screen.ready?.(target);
        // Let fonts, lazy AI cards and route fades settle.
        await target.waitForTimeout(400);
        const file = path.join(out, `${screen.name}-${width}-${theme}.png`);
        await target.screenshot({ path: file, fullPage: true });
        count += 1;
      }
      await context.close();
      await signedOut.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Captured ${count} screenshots into ${out}`);
