# Clipboard fixtures

One JSON file per case: `tests/fixtures/clipboard/<tool>/<case>.json`.

```json
{
  "tool": "slack",
  "version": "",
  "captured": "2026-10-07",
  "types": [],
  "html": "",
  "text": "",
  "extras": {},
  "expected": { "type": "doc", "content": [] }
}
```

`expected` is the document the editor should make of it, **written by hand** and reviewed (never copied from the parser's own output). `extras` holds other flavours (VS Code's `vscode-editor-data`).

## Status: reconstructed, not captured

Every file currently says `"captured": "reconstructed"`. They were written from the markup these tools are known to produce, without the tools in front of the author. Replace each one with a real capture:

1. Run `pnpm dev` and open `/dev/clipboard` (it is a 404 in production builds).
2. Copy the case in the real tool, paste into the box, fill in Tool and Case, press "Copy as fixture".
3. Save the JSON here, set `captured` to the date and `version` to the tool's version, and write `expected` by hand from the "Dayboard reads it as" preview once it looks right.
4. Run `pnpm test`. A failure is either a parser gap (fix `src/lib/editor/clipboard/parse-html.ts` or a producer) or a wrong `expected`.

Slack's list copying is the one to capture first (product spec §15.6).
