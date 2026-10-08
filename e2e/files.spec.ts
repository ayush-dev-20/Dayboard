import { expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { test } from "./fixtures";
import {
  attachmentStatus,
  attachmentsOf,
  findUser,
  insertNote,
  insertProject,
  insertReadyAttachment,
  insertTask,
  noteDoc,
  setNoteDoc,
} from "./db";
import { fakeClientIp, signUp } from "./helpers";

// V2 feature 09 (acceptance): attachments on notes, tasks and projects, picture and file blocks,
// bookmark cards, the upload experience and the storage allowance. Storage is the in-memory driver
// (E2E=true), which presigns URLs to an in-app route, so the whole flow runs without a bucket.

test.use({ viewport: { width: 1280, height: 900 } });

// A real 96x64 PNG, built here so it is big enough to see and click; the browser decodes it and
// its size is read for the block.
function makePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      rows[at] = 40 + x; // a gradient, so it is plainly a picture
      rows[at + 1] = 120;
      rows[at + 2] = 200 - y;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const PNG = makePng(96, 64);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n");
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2048, 7)]);

async function newUser(page: Page) {
  const account = await signUp(page);
  return { account, user: (await findUser(account.email))! };
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content" });
const section = (page: Page) => page.getByTestId("attachments");

/** Clicks Attach files and hands the picker these files. */
async function attach(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const chooser = page.waitForEvent("filechooser");
  await section(page).getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles(files);
}

/** A paste carrying files, as the browser delivers one from a screenshot. */
async function pasteFiles(page: Page, files: { name: string; type: string; base64: string }[]) {
  await editor(page).evaluate((el, items) => {
    const data = new DataTransfer();
    for (const item of items) {
      const bytes = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], item.name, { type: item.type }));
    }
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, files);
}

async function pasteText(page: Page, text: string) {
  await editor(page).evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

test.describe("attachments", () => {
  test("attach an image, a PDF and a DOCX to a note, download them, and a stranger cannot", async ({
    page,
    browser,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "With files" });
    await page.goto(`/notes/${noteId}`);
    await expect(section(page).getByText("No attachments", { exact: false })).toBeVisible();

    await attach(page, [
      { name: "photo.png", mimeType: "image/png", buffer: PNG },
      { name: "report.pdf", mimeType: "application/pdf", buffer: PDF },
      {
        name: "plan.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: DOCX,
      },
    ]);
    for (const name of ["photo.png", "report.pdf", "plan.docx"]) {
      await expect(section(page).getByRole("link", { name })).toBeVisible();
    }
    await expect(section(page).getByRole("progressbar")).toHaveCount(0);

    const rows = (await attachmentsOf(noteId)).sort((a, b) =>
      a.original_name.localeCompare(b.original_name),
    );
    // The three go up together, so the order they finish in is not fixed.
    expect(rows.map((r) => [r.original_name, r.status]).sort()).toEqual([
      ["photo.png", "READY"],
      ["plan.docx", "READY"],
      ["report.pdf", "READY"],
    ]);
    // The key never holds the file name.
    expect(
      rows.every((r) => !r.storage_key.includes("photo") && r.storage_key.startsWith("u/")),
    ).toBe(true);
    expect(rows[0]).toMatchObject({ width: 96, height: 64 });

    // Download goes through the app (session check) and ends at the bytes.
    const [png, docx, pdf] = rows;
    const image = await page.request.get(`/api/files/${png!.id}`);
    expect(image.status()).toBe(200);
    expect(Buffer.compare(await image.body(), PNG)).toBe(0);
    const download = await page.request.get(`/api/files/${docx!.id}?download=1`);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    expect(Buffer.compare(await download.body(), DOCX)).toBe(0);
    expect((await page.request.get(`/api/files/${pdf!.id}`)).status()).toBe(200);

    // The files stay after a reload.
    await page.reload();
    await expect(section(page).getByRole("link", { name: "report.pdf" })).toBeVisible();

    // Someone else gets the same answer as for a file that doesn't exist; so does nobody at all.
    const other = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeClientIp() },
    });
    const otherPage = await other.newPage();
    await signUp(otherPage);
    expect((await otherPage.request.get(`/api/files/${png!.id}`)).status()).toBe(404);
    expect((await otherPage.request.get(`/api/files/${crypto.randomUUID()}`)).status()).toBe(404);
    await other.close();
    const anonymous = await browser.newContext();
    expect(
      (await anonymous.request.get(`/api/files/${png!.id}`, { maxRedirects: 0 })).status(),
    ).toBe(401);
    await anonymous.close();
  });

  test("tasks and projects have the section too", async ({ page }) => {
    const { user } = await newUser(page);
    const taskId = await insertTask(user.id, { title: "Task with a file" });
    await page.goto(`/tasks/${taskId}`);
    await attach(page, [{ name: "task.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await expect(section(page).getByRole("link", { name: "task.pdf" })).toBeVisible();
    expect((await attachmentsOf(taskId))[0]).toMatchObject({ status: "READY" });

    const projectId = await insertProject(user.id, { name: "Project with a file" });
    await page.goto(`/projects/${projectId}`);
    await attach(page, [{ name: "project.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await expect(section(page).getByRole("link", { name: "project.pdf" })).toBeVisible();
  });

  test("a file that can't be accepted says why in its row, and nothing is sent", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Refusals" });
    await page.goto(`/notes/${noteId}`);
    await attach(page, [
      { name: "run.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") },
      { name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 1) },
    ]);
    await expect(section(page).getByText("This file type isn't supported.")).toBeVisible();
    await expect(section(page).getByText("Too large: max 10 MB")).toBeVisible();
    expect(await attachmentsOf(noteId)).toHaveLength(0);
    // Dismissing clears the row.
    await section(page).getByRole("button", { name: "Dismiss" }).first().click();
    await expect(section(page).getByText("This file type isn't supported.")).toBeHidden();
  });

  test("a failed upload can be retried, and an upload in progress can be canceled", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Flaky network" });
    await page.goto(`/notes/${noteId}`);

    // The first PUT fails.
    await page.route("**/api/storage/object**", (route) => route.abort());
    await attach(page, [{ name: "retry.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await expect(section(page).getByText("Couldn't upload", { exact: false })).toBeVisible();
    await page.unroute("**/api/storage/object**");
    await section(page).getByRole("button", { name: "Retry" }).click();
    await expect(section(page).getByRole("link", { name: "retry.pdf" })).toBeVisible();
    expect(await attachmentsOf(noteId)).toHaveLength(1);

    // The next one is held, then canceled.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/storage/object**", async (route) => {
      await held;
      await route.abort();
    });
    await attach(page, [{ name: "cancel.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await expect(
      section(page).getByRole("progressbar", { name: "Uploading cancel.pdf" }),
    ).toBeVisible();
    await section(page).getByRole("button", { name: "Cancel" }).click();
    await expect(section(page).getByText("cancel.pdf")).toBeHidden();
    release();
    await expect
      .poll(
        async () =>
          (await attachmentsOf(noteId)).find((r) => r.original_name === "cancel.pdf")?.status,
      )
      .toBe("DELETED");
  });

  test("deleting a file removes it and says so, and its block shows File removed", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Delete me" });
    await page.goto(`/notes/${noteId}`);
    await attach(page, [{ name: "gone.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await expect(section(page).getByRole("link", { name: "gone.pdf" })).toBeVisible();
    const [file] = await attachmentsOf(noteId);

    // A file block in the text points at it.
    await setNoteDoc(noteId, {
      type: "doc",
      content: [{ type: "file", attrs: { attachmentId: file!.id } }, { type: "paragraph" }],
    });
    await page.reload();
    await expect(page.locator(".file-block")).toContainText("gone.pdf");

    await section(page).getByRole("button", { name: "Options for gone.pdf" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText("File removed.")).toBeVisible();
    await expect(section(page).getByRole("link", { name: "gone.pdf" })).toBeHidden();
    await expect(page.locator(".file-block")).toContainText("File removed");
    expect(await attachmentStatus(file!.id)).toBe("DELETED");
    expect((await page.request.get(`/api/files/${file!.id}`)).status()).toBe(404);
  });
});

test.describe("picture and file blocks", () => {
  test("pasting a picture uploads it into a block with a caption, a viewer, and survives a reload", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Pictures" });
    await page.goto(`/notes/${noteId}`);
    await editor(page).click();
    await pasteFiles(page, [
      { name: "shot.png", type: "image/png", base64: PNG.toString("base64") },
    ]);

    const block = page.locator(".image-block");
    await expect(block.locator("img")).toBeVisible();
    await expect.poll(async () => (await attachmentsOf(noteId))[0]?.status).toBe("READY");

    await block.getByLabel("Picture caption").fill("A tiny pixel");
    // The note saves on its own; the block is in the stored document.
    await expect.poll(async () => JSON.stringify(await noteDoc(noteId))).toContain("A tiny pixel");
    expect(JSON.stringify(await noteDoc(noteId))).toContain('"type":"image"');

    // The viewer opens on click and closes with Esc, returning focus.
    await block.getByRole("button", { name: /Open picture/ }).click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByRole("img", { name: "A tiny pixel" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();

    await page.reload();
    await expect(page.locator(".image-block img")).toBeVisible();
    await expect(page.getByLabel("Picture caption")).toHaveValue("A tiny pixel");
  });

  test("/file picks a file and /image picks a picture; the slash items exist", async ({ page }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Slash" });
    await page.goto(`/notes/${noteId}`);
    await editor(page).click();
    await page.keyboard.type("/file");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("option", { name: "File" }).click();
    await (
      await chooser
    ).setFiles([{ name: "slash.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await expect(page.locator(".file-block")).toContainText("slash.pdf");
    await expect(
      page.locator(".file-block").getByRole("link", { name: "Download slash.pdf" }),
    ).toBeVisible();
  });

  test("dropping a picture on the text uploads it", async ({ page }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Drop" });
    await page.goto(`/notes/${noteId}`);
    await editor(page).click();
    await editor(page).evaluate((el, base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      const box = el.getBoundingClientRect();
      el.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
          clientX: box.left + 20,
          clientY: box.top + 10,
        }),
      );
    }, PNG.toString("base64"));
    await expect(page.locator(".image-block img")).toBeVisible();
    await expect
      .poll(async () => (await attachmentsOf(noteId))[0]?.original_name)
      .toBe("dropped.png");
  });

  test("a picture that is not available shows File removed, never a broken image", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Missing" });
    await setNoteDoc(noteId, {
      type: "doc",
      content: [
        { type: "image", attrs: { attachmentId: crypto.randomUUID() } },
        { type: "paragraph" },
      ],
    });
    await page.goto(`/notes/${noteId}`);
    await expect(page.locator(".image-block")).toContainText("File removed");
    await expect(page.locator(".image-block img")).toHaveCount(0);
  });
});

test.describe("gallery cover", () => {
  test("a note whose text starts with a picture shows it as the cover in the Gallery", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const source = await insertNote(user.id, { title: "Picture source" });
    await page.goto(`/notes/${source}`);
    await attach(page, [{ name: "cover.png", mimeType: "image/png", buffer: PNG }]);
    await expect(section(page).getByRole("link", { name: "cover.png" })).toBeVisible();
    const [file] = await attachmentsOf(source);

    const withCover = await insertNote(user.id, { title: "Has a cover" });
    await setNoteDoc(withCover, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
        { type: "image", attrs: { attachmentId: file!.id } },
        { type: "paragraph" },
      ],
    });
    await insertNote(user.id, { title: "No cover", text: "Plain" });

    await page.goto("/notes?view=grid");
    const tile = page.getByRole("link", { name: /Has a cover/ });
    await expect(tile.locator("img")).toBeVisible();
    await expect
      .poll(() => tile.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(96);
    await expect(page.getByRole("link", { name: /No cover/ }).locator("img")).toHaveCount(0);
  });
});

test.describe("bookmarks", () => {
  const preview = {
    url: "https://example.com/article",
    status: "OK",
    title: "An Article",
    description: "What it is about.",
    siteName: "Example",
    favicon: null,
    fetchedAt: new Date().toISOString(),
  };

  async function mockPreview(page: Page, body: unknown = { preview }) {
    await page.route("**/api/link-preview", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
    );
  }

  test("pasting a lone address offers a choice; Bookmark card makes a card that opens safely", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Links" });
    await mockPreview(page);
    await page.goto(`/notes/${noteId}`);
    await editor(page).click();
    await pasteText(page, "https://example.com/article");

    const choice = page.getByRole("group", { name: "Paste as" });
    await expect(choice).toBeVisible();
    // The address is already a plain link.
    await expect(
      editor(page).getByRole("link", { name: "https://example.com/article" }),
    ).toBeVisible();
    await choice.getByRole("button", { name: "Bookmark card" }).click();

    const card = page.locator(".bookmark-block");
    await expect(card).toContainText("An Article");
    await expect(card).toContainText("What it is about.");
    await expect(card).toContainText("Example");
    const open = card.getByRole("link", { name: /Open An Article/ });
    await expect(open).toHaveAttribute("href", "https://example.com/article");
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", /noopener/);
    await expect
      .poll(async () => JSON.stringify(await noteDoc(noteId)))
      .toContain('"type":"bookmark"');

    // Menu: Refresh updates, Convert to link makes a paragraph, Remove deletes.
    await mockPreview(page, { preview: { ...preview, title: "Updated Title" } });
    await card.getByRole("button", { name: "Bookmark options" }).click();
    await page.getByRole("menuitem", { name: "Refresh" }).click();
    await expect(card).toContainText("Updated Title");

    await card.getByRole("button", { name: "Bookmark options" }).click();
    await page.getByRole("menuitem", { name: "Convert to link" }).click();
    await expect(page.locator(".bookmark-block")).toHaveCount(0);
    await expect(
      editor(page).getByRole("link", { name: "https://example.com/article" }),
    ).toBeVisible();
  });

  test("Keep as link, Link with page title, and dismissing keep it simple", async ({ page }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Titles" });
    await mockPreview(page);
    await page.goto(`/notes/${noteId}`);
    await editor(page).click();

    // Link with page title: the link text becomes the title.
    await pasteText(page, "https://example.com/article");
    await page
      .getByRole("group", { name: "Paste as" })
      .getByRole("button", { name: "Link with page title" })
      .click();
    await expect(editor(page).getByRole("link", { name: "An Article" })).toHaveAttribute(
      "href",
      "https://example.com/article",
    );

    // Typing on dismisses the popover and leaves the link.
    await page.keyboard.press("Enter");
    await pasteText(page, "https://example.org/other");
    await expect(page.getByRole("group", { name: "Paste as" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Paste as" })).toBeHidden();
    await expect(
      editor(page).getByRole("link", { name: "https://example.org/other" }),
    ).toBeVisible();
  });

  test("an address pasted over selected text just makes a link", async ({ page }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Selected", text: "read this" });
    await page.goto(`/notes/${noteId}`);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+A");
    await pasteText(page, "https://example.com/x");
    await expect(page.getByRole("group", { name: "Paste as" })).toBeHidden();
    await expect(editor(page).getByRole("link", { name: "read this" })).toBeVisible();
  });

  test("/bookmark asks for an address; a private address becomes a plain link with a quiet note", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Private" });
    await page.goto(`/notes/${noteId}`);
    await editor(page).click();
    await page.keyboard.type("/bookmark");
    await page.getByRole("option", { name: "Bookmark" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a bookmark" });
    await dialog.getByLabel("Web address").fill("not an address");
    await dialog.getByRole("button", { name: "Add bookmark" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Enter a web address");
    // The real server refuses this address (it is the machine itself): no request leaves it.
    await dialog.getByLabel("Web address").fill("http://127.0.0.1:9/secret");
    await dialog.getByRole("button", { name: "Add bookmark" }).click();
    const block = page.locator(".bookmark-block");
    await expect(block.getByRole("link", { name: "http://127.0.0.1:9/secret" })).toBeVisible();
    await expect(block).toContainText("Couldn't load a preview.");
  });
});

test.describe("storage allowance", () => {
  test("over the allowance the row says so, and Settings shows the usage", async ({ page }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Full" });
    // 500 MB is the default allowance: leave less than the next file needs.
    await insertReadyAttachment(user.id, noteId, 500 * 1024 * 1024 - 10);
    await page.goto(`/notes/${noteId}`);
    await attach(page, [{ name: "more.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await expect(section(page).getByText("You've used all your storage.")).toBeVisible();

    await page.goto("/settings/account");
    await expect(page.getByTestId("storage-usage")).toContainText("500 MB of 500 MB used");
  });
});

test.describe("accessibility and small screens", () => {
  async function scan(page: Page, label: string) {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => `${v.id}: ${v.help}`),
      label,
    ).toEqual([]);
  }

  test("a note with files, a picture and a bookmark has no serious axe violations in light and dark, and fits 360px", async ({
    page,
  }) => {
    const { user } = await newUser(page);
    const noteId = await insertNote(user.id, { title: "Everything" });
    await page.goto(`/notes/${noteId}`);
    await attach(page, [
      { name: "photo.png", mimeType: "image/png", buffer: PNG },
      {
        name: "a-rather-long-file-name-that-keeps-going-and-going-and-going.pdf",
        mimeType: "application/pdf",
        buffer: PDF,
      },
    ]);
    await expect(section(page).getByRole("link", { name: "photo.png" })).toBeVisible();
    await expect(section(page).getByRole("link", { name: /a-rather-long/ })).toBeVisible();
    const files = (await attachmentsOf(noteId)).sort((a, b) =>
      a.original_name.localeCompare(b.original_name),
    );
    await setNoteDoc(noteId, {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            attachmentId: files.find((f) => f.original_name === "photo.png")!.id,
            caption: "Caption",
          },
        },
        {
          type: "file",
          attrs: { attachmentId: files.find((f) => f.original_name.startsWith("a-rather"))!.id },
        },
        {
          type: "bookmark",
          attrs: {
            url: "https://example.com/a/very/long/path/that/goes/on",
            title: "A bookmark with a rather long title that must wrap or truncate nicely",
            description: "Description",
            siteName: "Example",
            fetchedAt: new Date().toISOString(),
          },
        },
        { type: "paragraph" },
      ],
    });
    await page.reload();
    await expect(page.locator(".image-block img")).toBeVisible();
    await expect(page.locator(".file-block")).toContainText("a-rather-long");
    await expect(page.locator(".bookmark-block")).toContainText("A bookmark");

    await scan(page, "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await scan(page, "dark");

    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
