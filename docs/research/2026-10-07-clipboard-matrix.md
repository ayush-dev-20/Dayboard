# Clipboard compatibility matrix (V2 feature 02)

**Date started:** 2026-10-07. **Status: not run on real tools.** Every cell below is "not run". This is the acceptance test of product spec §15.7 and the last open item of `specs/v2/features/02-clipboard-fidelity.md` §10. The code is covered by unit and E2E tests built on reconstructed fixtures (`tests/fixtures/clipboard/README.md`); only a person with these tools can fill this in.

## How to run it

1. In Dayboard, make a note with the content set: a heading, a paragraph with **bold**, _italic_, ~~strikethrough~~ and a link, a bulleted list with a nested list, a numbered list with two nested levels (`1.` `a.` `i.`), a checklist, a quote, a code block, `inline code`, a table, a toggle, a callout.
2. **Out:** select it all, copy, paste into the tool. Use "Copy note" and "Copy as Markdown" too. Look for raw HTML text, stray symbols, lost nesting.
3. **In:** build the same content in the tool, copy, paste into a Dayboard note and a task description. Use `/dev/clipboard` to capture each case as a fixture at the same time.
4. Write pass or fail per cell, and a note for each failure with the tool version.

## Dayboard to other tools

| Case                              | Notion  | Slack (composer) | Google Docs | Gmail   | Apple Notes | Word    | Markdown editor |
| --------------------------------- | ------- | ---------------- | ----------- | ------- | ----------- | ------- | --------------- |
| Heading                           | not run | not run          | not run     | not run | not run     | not run | not run         |
| Bold, italic, strikethrough, link | not run | not run          | not run     | not run | not run     | not run | not run         |
| Bulleted list with nested         | not run | not run          | not run     | not run | not run     | not run | not run         |
| Numbered, two nested levels       | not run | not run          | not run     | not run | not run     | not run | not run         |
| Checklist                         | not run | not run          | not run     | not run | not run     | not run | not run         |
| Quote                             | not run | not run          | not run     | not run | not run     | not run | not run         |
| Code block, inline code           | not run | not run          | not run     | not run | not run     | not run | not run         |
| Table                             | not run | not run          | not run     | not run | not run     | not run | not run         |
| Toggle                            | not run | not run          | not run     | not run | not run     | not run | not run         |
| Callout                           | not run | not run          | not run     | not run | not run     | not run | not run         |

Expected for Slack: lists, quote, code, bold, italic, strikethrough and links arrive; headings as bold lines; tables as rows of text; toggles as a bold line plus content.

## Other tools to Dayboard

| Case                              | Notion  | Slack   | Google Docs | Gmail   | Apple Notes | Word    | Web page | VS Code | GitHub  |
| --------------------------------- | ------- | ------- | ----------- | ------- | ----------- | ------- | -------- | ------- | ------- |
| Headings (above 3 become 3)       | not run | not run | not run     | not run | not run     | not run | not run  | n/a     | not run |
| Bold, italic, strikethrough, link | not run | not run | not run     | not run | not run     | not run | not run  | n/a     | not run |
| Bulleted list with nested         | not run | not run | not run     | not run | not run     | not run | not run  | n/a     | not run |
| Numbered list with nested         | not run | not run | not run     | not run | not run     | not run | not run  | n/a     | not run |
| Checklist                         | not run | n/a     | not run     | n/a     | not run     | n/a     | n/a      | n/a     | not run |
| Quote                             | not run | not run | n/a         | not run | n/a         | n/a     | not run  | n/a     | not run |
| Code block                        | not run | not run | n/a         | n/a     | n/a         | n/a     | not run  | not run | not run |
| Table                             | not run | n/a     | not run     | n/a     | not run     | not run | not run  | n/a     | not run |
| Toggle, callout                   | not run | n/a     | n/a         | n/a     | n/a         | n/a     | n/a      | n/a     | n/a     |

## Round trips

| Path                                | Result  |
| ----------------------------------- | ------- |
| Dayboard to Notion to Dayboard      | not run |
| Dayboard to Google Docs to Dayboard | not run |

## Dayboard to Dayboard

Same note, another note, a task description: covered by `e2e/clipboard.spec.ts` ("a copy pastes into another note and into a task description unchanged"), which uses synthetic paste events carrying a real copy's data, and by the real-keyboard check in "what Copy note writes pastes back into Dayboard as the same note" (Chromium only). Safari and Firefox: not run.

## Failures

None recorded yet.
