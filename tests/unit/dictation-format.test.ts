import { describe, expect, it } from "vitest";
import { formatDictation, opsToText } from "@/lib/dictation/format";

const speak = (raw: string, before = "", commands = true) =>
  formatDictation(raw, { before, commands });
const text = (raw: string, before = "", commands = true) => opsToText(speak(raw, before, commands));

describe("formatDictation", () => {
  it("starts a sentence with a capital letter at the start of a block", () => {
    expect(text("buy milk and eggs")).toBe("Buy milk and eggs");
  });

  it("puts one space between what is there and what is said, and none at the start", () => {
    expect(text("world", "Hello")).toBe(" world");
    expect(text("world", "Hello ")).toBe("world");
    expect(text("world", "")).toBe("World");
    expect(text("  spaced   out  words ")).toBe("Spaced out words");
  });

  it("capitalises after a sentence end, but not in the middle of one", () => {
    expect(text("next thing", "It is done.")).toBe(" Next thing");
    expect(text("what now", "Done? ")).toBe("What now");
    expect(text("and then", "We left")).toBe(" and then");
  });

  it("turns spoken punctuation into marks, attached to the word before", () => {
    expect(text("buy milk comma eggs comma and bread period")).toBe("Buy milk, eggs, and bread.");
    expect(text("are you sure question mark")).toBe("Are you sure?");
    expect(text("stop exclamation mark")).toBe("Stop!");
    expect(text("stop exclamation point")).toBe("Stop!");
    expect(text("note colon call back")).toBe("Note: call back");
    expect(text("first semicolon second")).toBe("First; second");
    expect(text("that is all full stop")).toBe("That is all.");
  });

  it("capitalises the word after a spoken full stop, question mark or exclamation mark", () => {
    expect(text("it works period now we ship")).toBe("It works. Now we ship");
    expect(text("really question mark yes")).toBe("Really? Yes");
  });

  it("makes a new paragraph or a new line, and starts the next one with a capital", () => {
    expect(speak("first thought new paragraph second thought")).toEqual([
      { type: "text", text: "First thought" },
      { type: "paragraph" },
      { type: "text", text: "Second thought" },
    ]);
    expect(speak("one new line two")).toEqual([
      { type: "text", text: "One" },
      { type: "line" },
      { type: "text", text: "Two" },
    ]);
  });

  it("puts punctuation straight after the text already there", () => {
    expect(text("comma and more", "Hello")).toBe(", and more");
    expect(text("period", "Done")).toBe(".");
  });

  it("writes the pronoun I with a capital letter", () => {
    expect(text("i think i'm ready and i'll go")).toBe("I think I'm ready and I'll go");
    expect(text("hi there", "")).toBe("Hi there");
  });

  it("leaves text a phone has already punctuated alone", () => {
    expect(text("Hello, world. How are you?")).toBe("Hello, world. How are you?");
  });

  it("does not turn the words into marks when commands are off (another language)", () => {
    expect(text("the trial period ends", "", false)).toBe("The trial period ends");
  });

  it("says nothing for silence or empty text", () => {
    expect(speak("")).toEqual([]);
    expect(speak("   ")).toEqual([]);
  });

  it("starts a new line after a command with a fresh capital and no leading space", () => {
    expect(text("new paragraph next thing", "Last one.")).toBe("\n\nNext thing");
  });
});

describe("opsToText", () => {
  it("writes a paragraph as a blank line and a line break as a newline", () => {
    expect(
      opsToText([{ type: "text", text: "a" }, { type: "paragraph" }, { type: "text", text: "b" }]),
    ).toBe("a\n\nb");
    expect(
      opsToText([{ type: "text", text: "a" }, { type: "line" }, { type: "text", text: "b" }]),
    ).toBe("a\nb");
  });
});
