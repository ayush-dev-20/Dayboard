import { describe, expect, it } from "vitest";
import { cleanText, defaultIconUrl, parsePreview } from "@/lib/net/preview-parse";
import { normalizeUrl, urlHash } from "@/lib/net/url";

// V2 feature 09 §7: reading a preview out of a page with a bounded, non-executing scan.

const page = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const URL_ = "https://news.example/story/1";

describe("reading a preview", () => {
  it("takes the title, the Open Graph fields and the icon", () => {
    const html = page(`
      <title>Fallback title</title>
      <meta property="og:title" content="The real title">
      <meta property="og:description" content="A short summary of the story.">
      <meta property="og:site_name" content="News Example">
      <link rel="icon" href="/static/icon.png">`);
    expect(parsePreview(html, URL_)).toEqual({
      title: "The real title",
      description: "A short summary of the story.",
      siteName: "News Example",
      iconUrl: "https://news.example/static/icon.png",
    });
  });

  it("falls back to <title> and the description meta", () => {
    const parsed = parsePreview(
      page(`<title>  Just   a title </title><meta name="description" content="Plain description">`),
      URL_,
    );
    expect(parsed).toMatchObject({
      title: "Just a title",
      description: "Plain description",
      siteName: null,
    });
  });

  it("copes with attribute styles: single quotes, no quotes, odd spacing and case", () => {
    const parsed = parsePreview(
      page(`<META PROPERTY='og:title' CONTENT='Single quoted'><meta name=description content=unquoted>
            <link REL="Shortcut Icon" HREF='fav.ico'>`),
      "https://x.example/dir/page",
    );
    expect(parsed.title).toBe("Single quoted");
    expect(parsed.description).toBe("unquoted");
    expect(parsed.iconUrl).toBe("https://x.example/dir/fav.ico");
  });

  it("decodes entities and strips markup and control characters", () => {
    const parsed = parsePreview(
      page(`<title>Tom &amp; Jerry &#8212; &#x1F600; &lt;b&gt;bold&lt;/b&gt;</title>
            <meta property="og:description" content="line one&#10;line two&nbsp;&hellip; \u202Eevil">`),
      URL_,
    );
    expect(parsed.title).toBe("Tom & Jerry — 😀 <b>bold</b>");
    expect(parsed.description).toBe("line one line two … evil");
    // A NUL or an out-of-range reference is dropped, not turned into a character.
    expect(cleanText("a&#0;b&#x110000;c", 50)).toBe("abc");
    expect(cleanText("<script>x</script>plain", 50)).toBe("x plain");
  });

  it("ignores tags inside comments, scripts, styles and noscript", () => {
    const parsed = parsePreview(
      page(`<!-- <meta property="og:title" content="from a comment"> -->
            <script>var s = '<meta property="og:title" content="from a script">';</script>
            <style>/* <title>from a style</title> */</style>
            <noscript><title>from noscript</title></noscript>
            <title>The visible one</title>`),
      URL_,
    );
    expect(parsed.title).toBe("The visible one");
  });

  it("reads only the head: a title in the body is not a title", () => {
    expect(parsePreview(page("", "<title>in the body</title>"), URL_).title).toBeNull();
    expect(
      parsePreview(
        "<head><title>Head</title></head><body><meta property='og:title' content='Body'>",
        URL_,
      ).title,
    ).toBe("Head");
  });

  it("cuts long values to the caps", () => {
    const parsed = parsePreview(
      page(`<title>${"t".repeat(500)}</title><meta property="og:description" content="${"d".repeat(900)}">
            <meta property="og:site_name" content="${"s".repeat(300)}">`),
      URL_,
    );
    expect(parsed.title!.length).toBe(200);
    expect(parsed.description!.length).toBe(400);
    expect(parsed.siteName!.length).toBe(100);
    expect(parsed.title!.endsWith("…")).toBe(true);
  });

  it("survives malformed and hostile HTML without throwing", () => {
    for (const html of [
      "",
      "<",
      "<title>unterminated",
      "<meta property=og:title content=",
      "<<<<>>>><title></title",
      `<link rel="icon" href="http://[::1">`,
      `<meta ${"a=1 ".repeat(5000)}>`,
      `<!--${"-".repeat(5000)}`,
      "<script>".repeat(2000),
    ]) {
      expect(() => parsePreview(html, URL_), html.slice(0, 30)).not.toThrow();
    }
  });

  it("reads only a bounded part of a huge page", () => {
    const filler = "x".repeat(600 * 1024);
    // A title past the first 512 KB is never reached.
    expect(parsePreview(`<head>${filler}<title>too late</title></head>`, URL_).title).toBeNull();
    expect(parsePreview(`<head><title>early</title>${filler}</head>`, URL_).title).toBe("early");
  });

  it("only takes an http(s) icon, and offers the usual one when a page names none", () => {
    expect(
      parsePreview(page(`<link rel="icon" href="javascript:alert(1)">`), URL_).iconUrl,
    ).toBeNull();
    expect(
      parsePreview(page(`<link rel="icon" href="data:image/png;base64,AAAA">`), URL_).iconUrl,
    ).toBeNull();
    expect(parsePreview(page(`<link rel="stylesheet" href="/a.css">`), URL_).iconUrl).toBeNull();
    expect(defaultIconUrl("https://a.example/some/page?q=1")).toBe("https://a.example/favicon.ico");
  });
});

describe("the form a web address is kept in", () => {
  it("lower-cases the host, drops the fragment and the default port, keeps the query", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/Path?utm_source=x#section")).toBe(
      "https://example.com/Path?utm_source=x",
    );
    expect(normalizeUrl("  http://example.com  ")).toBe("http://example.com/");
  });
  it("refuses other schemes, credentials and nonsense", () => {
    for (const u of [
      "ftp://a.example/",
      "javascript:alert(1)",
      "file:///x",
      "https://u:p@a.example/",
      "",
      "not a url",
      "https://" + "a".repeat(2100),
    ]) {
      expect(normalizeUrl(u), u.slice(0, 30)).toBeNull();
    }
  });
  it("hashes the normalised form, so the same page is one entry", () => {
    expect(urlHash(normalizeUrl("https://Example.com/a#x")!)).toBe(
      urlHash(normalizeUrl("https://example.com/a")!),
    );
    expect(urlHash("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});
