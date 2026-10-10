import { excerptAround } from "../context";
import type { SourceReasons } from "../assistant-types";

// "Why this result?" (feature 11 §4): the facts the server knows about how an item was found. The
// model may phrase them but never writes them. Pure.

const PASSAGE_CHARS = 180;

/** Which of the question's words the item contains, and the passage around the first one. */
export function reasonsFor(
  terms: string[],
  title: string,
  body: string,
  via: SourceReasons["via"],
): SourceReasons {
  const haystackTitle = title.toLocaleLowerCase();
  const haystackBody = body.toLocaleLowerCase();
  const matchedTerms = terms.filter((t) => haystackTitle.includes(t) || haystackBody.includes(t));
  const passage =
    matchedTerms.length > 0 && body.trim()
      ? excerptAround(body, matchedTerms, PASSAGE_CHARS)
      : null;
  return { via, matchedTerms, passage };
}

/** One plain sentence for the "Why" disclosure, built from the recorded reasons only. */
export function explainReasons(reasons: SourceReasons): string {
  switch (reasons.via) {
    case "opened":
      return "You pointed the assistant at this item.";
    case "scope":
      return "It belongs to an item you pointed the assistant at.";
    case "listed":
      return "It matched the task filter used (for example overdue or due today).";
    case "related":
      return reasons.matchedTerms.length
        ? `It shares the words ${list(reasons.matchedTerms)} with the item.`
        : "It sits close to the item.";
    default:
      return reasons.matchedTerms.length
        ? `It contains ${list(reasons.matchedTerms)} from your question.`
        : "It was returned by the search for your question.";
  }
}

function list(words: string[]): string {
  const quoted = words.slice(0, 5).map((w) => `“${w}”`);
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}` : quoted[0]!;
}
