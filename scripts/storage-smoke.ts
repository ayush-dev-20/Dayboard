// Manual check of the real storage bucket (V2 feature 09 §3.9). Run `pnpm storage:smoke` with the
// real STORAGE_* values in .env.local. It is never run in CI (no secrets there). It must pass before
// the first production deploy and after any change of key, bucket, SDK version or CORS rule.
// `server-only` is satisfied by the `react-server` condition set in the package script.
import { createS3Client, createS3Storage } from "../src/lib/storage/s3";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the real environment.
}

const env = process.env;
const missing = [
  "STORAGE_ENDPOINT",
  "STORAGE_REGION",
  "STORAGE_BUCKET",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
].filter((name) => !env[name]);
if (missing.length > 0) {
  console.error(`Not set: ${missing.join(", ")}. Put the real storage values in .env.local.`);
  process.exit(1);
}

const settings = {
  endpoint: env.STORAGE_ENDPOINT!,
  region: env.STORAGE_REGION!,
  bucket: env.STORAGE_BUCKET!,
  accessKeyId: env.STORAGE_ACCESS_KEY_ID!,
  secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY!,
  forcePathStyle: env.STORAGE_FORCE_PATH_STYLE === "true",
};
const origin = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

let failures = 0;
async function step(name: string, run: () => Promise<string | void>) {
  try {
    const note = await run();
    console.log(`PASS  ${name}${note ? ` (${note})` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const body = new TextEncoder().encode("Dayboard storage smoke test\n");
const key = `smoke/${crypto.randomUUID()}`;
const storage = createS3Storage(settings);
let uploadUrl = "";
let uploadHeaders: Record<string, string> = {};

await step("client sets the checksum options B2 needs", async () => {
  const client = createS3Client(settings);
  const calculation = await client.config.requestChecksumCalculation();
  const validation = await client.config.responseChecksumValidation();
  expect(calculation === "WHEN_REQUIRED", `requestChecksumCalculation is ${calculation}`);
  expect(validation === "WHEN_REQUIRED", `responseChecksumValidation is ${validation}`);
});

await step("upload URL and CORS preflight", async () => {
  const signed = await storage.createUploadUrl(key, {
    mime: "text/plain",
    size: body.length,
    expiresIn: 300,
  });
  uploadUrl = signed.url;
  uploadHeaders = signed.headers;
  const response = await fetch(uploadUrl, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  const allowOrigin = response.headers.get("access-control-allow-origin");
  const allowHeaders = (response.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  expect(response.status < 300, `preflight answered ${response.status}`);
  expect(allowOrigin === origin || allowOrigin === "*", `allow-origin is ${allowOrigin}`);
  expect(allowHeaders.includes("content-type") || allowHeaders === "*", "content-type not allowed");
  return `origin ${origin}`;
});

await step("upload with the returned headers", async () => {
  const response = await fetch(uploadUrl, { method: "PUT", headers: uploadHeaders, body });
  expect(response.ok, `PUT answered ${response.status}: ${await response.text()}`);
});

await step("head: size and type match", async () => {
  const head = await storage.head(key);
  expect(head, "object not found");
  expect(head.size === body.length, `size ${head.size}, expected ${body.length}`);
  expect(head.mime.startsWith("text/plain"), `type ${head.mime}`);
});

await step("readHead: a ranged read returns exactly the bytes asked for", async () => {
  const bytes = await storage.readHead(key, 8);
  expect(bytes.length === 8, `got ${bytes.length} bytes`);
  expect(new TextDecoder().decode(bytes) === "Dayboard", "wrong bytes");
});

await step("download URL sets Content-Disposition and Content-Type", async () => {
  const url = await storage.createDownloadUrl(key, {
    filename: "réport 1.txt",
    disposition: "attachment",
    mime: "text/plain",
    expiresIn: 60,
  });
  const response = await fetch(url);
  expect(response.ok, `GET answered ${response.status}`);
  const disposition = response.headers.get("content-disposition") ?? "";
  expect(disposition.startsWith("attachment"), `disposition is "${disposition}"`);
  expect((response.headers.get("content-type") ?? "").startsWith("text/plain"), "wrong type");
  expect((await response.text()) === new TextDecoder().decode(body), "wrong content");
  return disposition;
});

await step("a wrong Content-Type is rejected by the signature", async () => {
  const wrongKey = `smoke/${crypto.randomUUID()}`;
  const signed = await storage.createUploadUrl(wrongKey, {
    mime: "text/plain",
    size: body.length,
    expiresIn: 300,
  });
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body,
  });
  if (response.ok) {
    await storage.delete(wrongKey);
    throw new Error("a PUT with a different Content-Type was accepted");
  }
});

await step("delete, then head finds nothing", async () => {
  await storage.delete(key);
  const head = await storage.head(key);
  // B2 keeps older versions unless the bucket lifecycle is "keep only the last version".
  expect(head === null, "object still found (check the bucket's lifecycle rule)");
});

console.log(
  `\nSettings that mattered: path style ${settings.forcePathStyle ? "on" : "off"}, region ${settings.region}, endpoint ${settings.endpoint}`,
);
console.log(failures === 0 ? "All steps passed." : `${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
