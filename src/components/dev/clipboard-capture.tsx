"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { planPaste } from "@/lib/editor/clipboard/paste";
import { decodeInternal, INTERNAL_MIME } from "@/lib/editor/clipboard/slice";

type Captured = {
  types: string[];
  html: string;
  text: string;
  extras: Record<string, string>;
};

/**
 * Paste into the box to see every flavour the source tool wrote, then copy the result as a test
 * fixture (`tests/fixtures/clipboard/<tool>/<case>.json`). Fill `expected` by hand from the
 * "Dayboard reads it as" preview once it looks right.
 */
export function ClipboardCapture() {
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [tool, setTool] = useState("");
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);

  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const data = event.clipboardData;
    const types = Array.from(data.types);
    const extras: Record<string, string> = {};
    for (const type of types) {
      if (type !== "text/html" && type !== "text/plain" && type !== "Files") {
        extras[type] = data.getData(type);
      }
    }
    setCaptured({
      types,
      html: data.getData("text/html"),
      text: data.getData("text/plain"),
      extras,
    });
    setCopied(false);
  }

  const plan = captured
    ? planPaste({
        types: captured.types,
        html: captured.html,
        text: captured.text,
        files: [],
        internal: decodeInternal(captured.extras[INTERNAL_MIME]),
        vscodeMode: (() => {
          try {
            return JSON.parse(captured.extras["vscode-editor-data"] ?? "{}").mode as
              string | undefined;
          } catch {
            return undefined;
          }
        })(),
      })
    : null;

  async function copyFixture() {
    if (!captured) return;
    const fixture = {
      tool,
      version: "",
      captured: new Date().toISOString().slice(0, 10),
      case: name,
      types: captured.types,
      html: captured.html,
      text: captured.text,
      extras: captured.extras,
      expected: plan && plan.kind === "doc" ? plan.doc : null,
    };
    await navigator.clipboard.writeText(`${JSON.stringify(fixture, null, 2)}\n`);
    setCopied(true);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="type-headline-lg">Clipboard capture</h1>
      <p className="type-body-md text-muted-foreground">
        Development only. Copy something in another tool, click the box and paste. Nothing is sent
        anywhere.
      </p>

      <div
        role="textbox"
        aria-label="Paste here"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onPaste={onPaste}
        className="min-h-24 rounded-lg border border-border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {captured ? (
        <>
          <section className="space-y-1">
            <h2 className="type-label-caps text-muted-foreground">Types</h2>
            <p className="type-body-md">{captured.types.join(", ") || "none"}</p>
          </section>
          {(
            [
              ["text/html", captured.html],
              ["text/plain", captured.text],
              ...Object.entries(captured.extras),
            ] as [string, string][]
          ).map(([type, value]) => (
            <section key={type} className="space-y-1">
              <h2 className="type-label-caps text-muted-foreground">{type}</h2>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                {value || "(empty)"}
              </pre>
            </section>
          ))}
          <section className="space-y-1">
            <h2 className="type-label-caps text-muted-foreground">Dayboard reads it as</h2>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {plan?.kind === "doc"
                ? JSON.stringify(plan.doc, null, 2)
                : plan?.kind === "internal"
                  ? "Dayboard's own flavour (a lossless paste)"
                  : "nothing"}
            </pre>
          </section>
          <section className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 type-body-sm">
              Tool
              <input
                value={tool}
                onChange={(e) => setTool(e.target.value)}
                placeholder="slack"
                className="block rounded-md border border-border bg-background px-2 py-1"
              />
            </label>
            <label className="space-y-1 type-body-sm">
              Case
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="bulleted-list-nested"
                className="block rounded-md border border-border bg-background px-2 py-1"
              />
            </label>
            <Button onClick={() => void copyFixture()}>Copy as fixture</Button>
            {copied ? <span className="type-body-sm text-muted-foreground">Copied</span> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
