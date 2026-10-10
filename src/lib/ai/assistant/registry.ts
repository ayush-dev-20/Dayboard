import { ITEM_CHARS, MAX_ITEMS } from "../context";
import type { SourceReasons } from "../assistant-types";
import type { AskSource } from "../types";

// The labelled items one assistant turn has seen (feature 11 §4, "Grounding"). Every tool registers
// what it returns here, so an item gets one label (S1…S12) for the whole turn, the model can cite it,
// and the server can keep only the labels that were really provided. Pure: no database, no model.

/** Most characters of retrieved content one turn may carry (feature 11 §7). */
export const TOTAL_CHARS = 20_000;
/** Longer text for an item the model asked to read in full (`getItem`). */
export const READ_CHARS = 6_000;

export type RegisteredItem = AskSource & {
  /** The text the model was given (trimmed), used to check quotes. */
  body: string;
  reasons: SourceReasons;
};

export type NewItem = {
  type: AskSource["type"];
  id: string;
  title: string;
  href: string;
  body: string;
  reasons: SourceReasons;
};

export class SourceRegistry {
  private readonly items = new Map<string, RegisteredItem>();
  private used = 0;

  constructor(
    private readonly maxItems = MAX_ITEMS,
    private readonly totalChars = TOTAL_CHARS,
  ) {}

  private key = (type: string, id: string) => `${type}:${id}`;

  has(type: string, id: string): boolean {
    return this.items.has(this.key(type, id));
  }

  /**
   * Adds an item (or returns the one already added, with the new reasons merged in). Returns null
   * when the turn has reached its item or character limit: the tool then tells the model so.
   */
  register(item: NewItem, maxBody = ITEM_CHARS): RegisteredItem | null {
    const existing = this.items.get(this.key(item.type, item.id));
    if (existing) {
      existing.reasons = {
        ...existing.reasons,
        matchedTerms: [
          ...new Set([...existing.reasons.matchedTerms, ...item.reasons.matchedTerms]),
        ],
        passage: existing.reasons.passage ?? item.reasons.passage,
      };
      // Reading an item in full replaces the shorter excerpt a search gave.
      if (maxBody > ITEM_CHARS && item.body.length > existing.body.length) {
        const body = item.body.slice(0, maxBody);
        const room = this.totalChars - this.used + existing.body.length;
        if (body.length <= room) {
          this.used += body.length - existing.body.length;
          existing.body = body;
        }
      }
      return existing;
    }
    if (this.items.size >= this.maxItems) return null;
    const body = item.body.slice(0, maxBody);
    const cost = body.length + item.title.length;
    if (this.items.size > 0 && this.used + cost > this.totalChars) return null;
    this.used += cost;
    const registered: RegisteredItem = {
      label: `S${this.items.size + 1}`,
      type: item.type,
      id: item.id,
      title: item.title,
      href: item.href,
      body,
      reasons: item.reasons,
    };
    this.items.set(this.key(item.type, item.id), registered);
    return registered;
  }

  get all(): RegisteredItem[] {
    return [...this.items.values()];
  }

  /** The sources as the client shows them (no body text). */
  sources(): (AskSource & { reasons: SourceReasons })[] {
    return this.all.map(({ label, type, id, title, href, reasons }) => ({
      label,
      type,
      id,
      title,
      href,
      reasons,
    }));
  }

  bodies(): string[] {
    return this.all.map((i) => i.body);
  }
}
