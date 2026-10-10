import { StreamCaret } from "@/components/ai/ai-ui";
import { answerBlocks, parseInline, type AnswerPart } from "@/lib/ai/answer";

// How an answer reads in the Ask menu and the assistant: paragraphs, lists, bold and code, and
// verified quotes. Built from React elements only (never raw HTML), so an answer can't inject markup.

function Inlined({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <>
      {parseInline(text, streaming).map((run, i) =>
        run.kind === "bold" ? (
          <strong key={i} className="font-semibold">
            {run.text}
          </strong>
        ) : run.kind === "italic" ? (
          <em key={i}>{run.text}</em>
        ) : run.kind === "code" ? (
          <code key={i} className="rounded-sm bg-accent px-1 py-0.5 font-mono text-[0.9em]">
            {run.text}
          </code>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

export function AnswerBody({ parts, streaming }: { parts: AnswerPart[]; streaming: boolean }) {
  const blocks = answerBlocks(parts);
  const lastIndex = blocks.length - 1;

  return (
    <>
      {blocks.map((block, i) => {
        const live = streaming && i === lastIndex;
        switch (block.kind) {
          case "p":
            return (
              <p key={i} className="type-body-md">
                <Inlined text={block.text} streaming={live} />
                {live ? <StreamCaret /> : null}
              </p>
            );
          case "h":
            return (
              <p key={i} className="type-body-md font-semibold">
                <Inlined text={block.text} streaming={live} />
                {live ? <StreamCaret /> : null}
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.kind === "ul" ? "ul" : "ol";
            return (
              <List
                key={i}
                {...(block.kind === "ol" ? { start: block.start } : {})}
                className={
                  block.kind === "ul"
                    ? "ml-5 flex list-disc flex-col gap-1 type-body-md marker:text-muted-foreground"
                    : "ml-5 flex list-decimal flex-col gap-1 type-body-md marker:text-muted-foreground"
                }
              >
                {block.items.map((item, j) => (
                  <li key={j} className="pl-1">
                    <Inlined text={item} streaming={live && j === block.items.length - 1} />
                    {live && j === block.items.length - 1 ? <StreamCaret /> : null}
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border pl-3">
                <p className="type-label-caps text-muted-foreground">From your workspace</p>
                <p className="mt-1 font-serif text-[15px] leading-6">“{block.text}”</p>
              </blockquote>
            );
        }
      })}
    </>
  );
}
