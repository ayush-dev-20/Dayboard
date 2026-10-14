// Names and sizes for meaning-based search (V2 feature 10 §3). Safe to import anywhere: no secrets.

/** Every stored vector has this many numbers. Changing it means re-embedding everything (ADR 0011). */
export const EMBED_DIMENSIONS = 768;

/** Texts sent to the provider in one call. */
export const EMBED_BATCH = 50;

/** The Gemini embedding model used unless `AI_EMBEDDING_MODEL` names another. */
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";

/** What is stored next to each vector, so a model or size change makes old rows visible. */
export function embeddingLabel(model: string): string {
  return `${model}@${EMBED_DIMENSIONS}`;
}

export type EmbedTask = "document" | "query";
