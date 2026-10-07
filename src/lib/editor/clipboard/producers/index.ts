import { apple } from "./apple";
import { generic } from "./generic";
import { github } from "./github";
import { gmail } from "./gmail";
import { googleDocs } from "./google-docs";
import { notion } from "./notion";
import { slack } from "./slack";
import type { Producer } from "./types";
import { vscode } from "./vscode";
import { word } from "./word";

export type { Producer, ProducerApi, ProducerName } from "./types";

// The first match wins, so the more specific markers come first.
const PRODUCERS: Producer[] = [
  vscode,
  googleDocs,
  word,
  notion,
  slack,
  apple,
  gmail,
  github,
  generic,
];

export function detectProducer(doc: Document, html: string): Producer {
  return PRODUCERS.find((producer) => producer.detect(doc, html)) ?? generic;
}
