// Real screenshots for the landing page and the sign-in panel (feature 07 §10.4), taken from the
// seeded demo workspace in light and dark. Never mockups. Run after `pnpm db:seed`, against a
// running build that uses the mock AI provider:
//
//   pnpm capture:marketing -- --base http://localhost:3200
//
// Writes PNGs to public/marketing/ (served as AVIF/WebP by next/image). Regenerate whenever the
// UI changes. It signs in and looks; it changes nothing except asking the mock AI one question.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const base = arg("base", "http://localhost:3200");
const out = path.resolve(arg("out", "public/marketing"));
const email = arg("email", "demo@dayboard.local");
const password = arg("password", "demo-password-1234");

function clientIp(): string {
  const n = Math.floor(Math.random() * 0xffffff);
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function shoot(target: Page | Locator, name: string, theme: string) {
  await target.screenshot({ path: path.join(out, `${name}-${theme}.png`), animations: "disabled" });
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });

try {
  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
      timezoneId: "Asia/Kolkata",
      reducedMotion: "reduce",
      extraHTTPHeaders: { "x-forwarded-for": clientIp() },
    });
    const page = await context.newPage();
    await page.goto(`${base}/sign-in`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/today/, { timeout: 20_000 });
    // The demo account's theme is "System", so the emulated color scheme decides light or dark.

    // Hero and sign-in panel: the whole Today page.
    await page.goto(`${base}/today`);
    await settle(page);
    await shoot(page, "today", theme);

    // The loop: four small real crops.
    await shoot(page.getByLabel("Capture to Inbox").locator(".."), "loop-capture", theme);
    await shoot(page.getByRole("region", { name: "Focus" }), "loop-execute", theme);
    await page.goto(`${base}/tasks`);
    await settle(page);
    await shoot(page.locator("[data-task-list] section").first(), "loop-organize", theme);
    await page.goto(`${base}/projects`);
    await settle(page);
    await shoot(page.locator("[data-project-id]").first(), "loop-review", theme);

    // Feature rows: whole screens.
    await shoot(page, "projects", theme);
    await page.goto(`${base}/tasks`);
    await settle(page);
    await shoot(page, "tasks", theme);
    await page.goto(`${base}/notes?view=grid`);
    await settle(page);
    await shoot(page, "notes", theme);

    // "AI that asks first": a real preview dialog. Opened, photographed, cancelled; nothing written.
    await page.goto(`${base}/inbox`);
    await settle(page);
    await page
      .locator("[data-inbox-id]")
      .first()
      .getByRole("button", { name: "Turn into tasks" })
      .click();
    const preview = page.getByRole("dialog", { name: "Turn into tasks" });
    await preview.getByRole("textbox").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await shoot(preview, "ai-preview", theme);
    await preview.getByRole("button", { name: "Cancel" }).click();

    // ⌘K Ask, with a real (mock-provider) answer and its sources.
    await page.goto(`${base}/today`);
    await settle(page);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("tab", { name: "Ask" }).click();
    const input = page.getByPlaceholder("Ask about your workspace");
    await input.fill("What did we decide about the budget?");
    await input.press("Enter");
    await page.getByText("Sources").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await shoot(page, "ask", theme);

    await context.close();
  }
} finally {
  await browser.close();
}
// next/image needs each file's real size. Read it from the PNG header (width and height are the
// first two fields of IHDR) and write them for the components, at CSS pixels (the shots are 2x).
const sizes: Record<string, { width: number; height: number }> = {};
for (const file of (await readdir(out)).filter((f) => f.endsWith("-light.png")).sort()) {
  const header = await readFile(path.join(out, file));
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  sizes[file.replace("-light.png", "")] = {
    width: Math.round(width / 2),
    height: Math.round(height / 2),
  };
}
await writeFile(
  "src/components/marketing/image-sizes.ts",
  `// Generated by pnpm capture:marketing. Do not edit.\nexport const MARKETING_IMAGES = ${JSON.stringify(sizes, null, 2)} as const;\n\nexport type MarketingImage = keyof typeof MARKETING_IMAGES;\n`,
);
console.log(`Marketing screenshots written to ${out}`);
