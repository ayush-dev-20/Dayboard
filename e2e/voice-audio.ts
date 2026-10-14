import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The sound Chromium's fake microphone plays in the voice tests (V2 feature 13 §10): a few seconds of a
// soft two-tone hum as a 16 kHz mono WAV, written once to the temp folder. The mock transcription never
// listens to it; what matters is that the browser has a real stream to record and a level to show.

export function fakeMicrophoneFile(): string {
  const dir = path.join(tmpdir(), "dayboard-e2e");
  const file = path.join(dir, "voice.wav");
  const rate = 16_000;
  const seconds = 8;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.5 * t);
    const value = swell * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 330 * t));
    buffer.writeInt16LE(Math.round(value * 9000), 44 + i * 2);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, buffer);
  return file;
}
