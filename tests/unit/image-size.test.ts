import { describe, expect, it } from "vitest";
import {
  clampWidth,
  dragWidth,
  keyboardWidth,
  maxWidthFor,
  minWidthFor,
} from "@/lib/editor/image-size";

// V2 feature 09 §6, "Resizing": the sizes a picture may have and how a drag or a key changes them.

const COLUMN = 700;

describe("the minimum and maximum", () => {
  it("is 64 px wide and 64 px tall, so a wide picture's minimum width keeps its height at 64", () => {
    expect(minWidthFor(1, COLUMN)).toBe(64); // square
    expect(minWidthFor(0.25, COLUMN)).toBe(64); // tall: 64 wide is already 256 tall
    expect(minWidthFor(2, COLUMN)).toBe(128); // 2:1 → 128 x 64
    expect(minWidthFor(8, COLUMN)).toBe(512); // panorama → 512 x 64
  });
  it("lets the column win when it is narrower than the minimum", () => {
    expect(minWidthFor(8, 300)).toBe(300);
    expect(minWidthFor(1, 40)).toBe(40);
  });
  it("copes with an unknown proportion", () => {
    expect(minWidthFor(0, COLUMN)).toBe(64);
    expect(minWidthFor(NaN, COLUMN)).toBe(64);
  });
  it("is never wider than the column or the stored limit", () => {
    expect(maxWidthFor(COLUMN)).toBe(700);
    expect(maxWidthFor(10_000)).toBe(4000);
    expect(maxWidthFor(0)).toBe(4000); // column not measured yet
  });
});

describe("clampWidth", () => {
  it("keeps a width inside the limits, as a whole number", () => {
    expect(clampWidth(300.6, 1.5, COLUMN)).toBe(301);
    expect(clampWidth(10, 1.5, COLUMN)).toBe(96); // 64 tall at 3:2
    expect(clampWidth(9000, 1.5, COLUMN)).toBe(700);
    expect(clampWidth(NaN, 1.5, COLUMN)).toBe(700);
  });
});

describe("dragging a handle", () => {
  it("makes the picture larger by twice the pointer's distance, so the edge follows the pointer", () => {
    expect(dragWidth(300, 50, "right", 1.5, COLUMN)).toBe(400);
    expect(dragWidth(300, -50, "left", 1.5, COLUMN)).toBe(400);
  });
  it("makes it smaller the other way", () => {
    expect(dragWidth(300, -50, "right", 1.5, COLUMN)).toBe(200);
    expect(dragWidth(300, 50, "left", 1.5, COLUMN)).toBe(200);
  });
  it("stops at the minimum and at the column", () => {
    expect(dragWidth(300, -5000, "right", 1.5, COLUMN)).toBe(96);
    expect(dragWidth(300, 5000, "right", 1.5, COLUMN)).toBe(700);
    expect(dragWidth(300, 0, "left", 1.5, COLUMN)).toBe(300);
  });
});

describe("keys on the handle", () => {
  it("steps by 16 px, or 64 with Shift, within the limits", () => {
    expect(keyboardWidth("ArrowRight", false, 300, 1.5, COLUMN)).toBe(316);
    expect(keyboardWidth("ArrowLeft", false, 300, 1.5, COLUMN)).toBe(284);
    expect(keyboardWidth("ArrowUp", true, 300, 1.5, COLUMN)).toBe(364);
    expect(keyboardWidth("ArrowDown", true, 300, 1.5, COLUMN)).toBe(236);
    expect(keyboardWidth("ArrowRight", true, 680, 1.5, COLUMN)).toBe(700);
    expect(keyboardWidth("ArrowLeft", false, 100, 1.5, COLUMN)).toBe(96);
  });
  it("Home is the minimum and End the column's width", () => {
    expect(keyboardWidth("Home", false, 300, 2, COLUMN)).toBe(128);
    expect(keyboardWidth("End", false, 300, 2, COLUMN)).toBe(700);
  });
  it("ignores every other key", () => {
    for (const key of ["a", "Enter", "Tab", "Escape", " "]) {
      expect(keyboardWidth(key, false, 300, 1.5, COLUMN)).toBeNull();
    }
  });
});
