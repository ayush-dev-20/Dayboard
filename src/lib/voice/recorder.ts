import { VOICE_MAX_BYTES, VOICE_MAX_MS, VOICE_MIN_MS } from "./types";

// The recorder's brain (V2 feature 13 §3): a small state machine around `MediaRecorder`, with every
// browser piece passed in, so a test can drive it with a fake and no microphone. The microphone is only
// asked for in `start()` (which the UI calls from a tap, never on load), and the stream is released the
// moment recording ends. Pure TypeScript: no React, no DOM types beyond the ones it is handed.

export type RecorderPhase =
  | "idle"
  | "asking"
  | "recording"
  | "paused"
  | "finishing"
  | "done"
  | "denied"
  | "unsupported"
  | "error";

/** Why recording ended. `interrupted` means the microphone went away (a call, an unplugged headset). */
export type EndedBy = "user" | "time" | "size" | "interrupted";

export type RecordedAudio = {
  blob: Blob;
  /** The type the browser recorded in, for example `audio/webm;codecs=opus`. */
  mimeType: string;
  durationMs: number;
  endedBy: EndedBy;
};

export type RecorderState = {
  phase: RecorderPhase;
  elapsedMs: number;
  /** 0 to 1: how loud it is right now. */
  level: number;
  result: RecordedAudio | null;
  /** Set when the last recording was too short to keep (an accidental tap). */
  tooShort: boolean;
  error: "no-microphone" | "failed" | null;
};

type TrackLike = { stop(): void; addEventListener?(type: "ended", listener: () => void): void };
type StreamLike = { getTracks(): TrackLike[] };

type RecorderLike = {
  readonly mimeType: string;
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
};

type RecorderCtor = {
  new (stream: never, options?: { mimeType?: string; audioBitsPerSecond?: number }): RecorderLike;
  isTypeSupported?(type: string): boolean;
};

export type LevelMeter = { read(): number; close(): void };

export type RecorderDeps = {
  getUserMedia?: ((constraints: { audio: boolean }) => Promise<StreamLike>) | undefined;
  Recorder?: RecorderCtor | undefined;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** Reads loudness from the stream. Optional: without it the level stays 0. */
  createMeter?: (stream: StreamLike) => LevelMeter | null;
};

/** Best type first. Safari only records `audio/mp4`; Chrome and Firefox record WebM or Ogg. */
export const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** A small voice bitrate keeps five minutes far below the 10 MB limit. */
const BITS_PER_SECOND = 32_000;
const TIMESLICE_MS = 1000;
const TICK_MS = 100;
/** Stop a little early so the last chunk cannot push the file past the limit. */
const SIZE_MARGIN = 256 * 1024;

export function pickMimeType(Recorder: RecorderCtor | undefined): string | undefined {
  if (!Recorder?.isTypeSupported) return undefined;
  return PREFERRED_TYPES.find((type) => Recorder.isTypeSupported!(type));
}

const initial = (phase: RecorderPhase = "idle"): RecorderState => ({
  phase,
  elapsedMs: 0,
  level: 0,
  result: null,
  tooShort: false,
  error: null,
});

export function isRecordingSupported(deps: Pick<RecorderDeps, "getUserMedia" | "Recorder">) {
  return Boolean(deps.getUserMedia && deps.Recorder);
}

export class VoiceRecorder {
  private state: RecorderState;
  private listeners = new Set<() => void>();
  private readonly deps: Required<Pick<RecorderDeps, "now" | "setInterval" | "clearInterval">> &
    RecorderDeps;

  private stream: StreamLike | null = null;
  private recorder: RecorderLike | null = null;
  private meter: LevelMeter | null = null;
  private timer: unknown = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private mimeType = "";
  private startedAt = 0;
  private before = 0;
  private endedBy: EndedBy = "user";
  private cancelled = false;
  /** Bumped by every start, so a late answer from an earlier start is ignored. */
  private session = 0;

  constructor(deps: RecorderDeps) {
    this.deps = {
      ...deps,
      now: deps.now ?? (() => Date.now()),
      setInterval: deps.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
      clearInterval: deps.clearInterval ?? ((handle) => clearInterval(handle as never)),
    };
    this.state = initial(isRecordingSupported(deps) ? "idle" : "unsupported");
  }

  getState = (): RecorderState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<RecorderState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private elapsed(): number {
    return this.state.phase === "recording"
      ? this.before + (this.deps.now() - this.startedAt)
      : this.before;
  }

  /** Asks for the microphone and starts. Call it from a tap. */
  async start(): Promise<void> {
    const { getUserMedia, Recorder } = this.deps;
    if (!getUserMedia || !Recorder) return this.set(initial("unsupported"));
    if (["asking", "recording", "paused", "finishing"].includes(this.state.phase)) return;

    const session = ++this.session;
    this.cancelled = false;
    this.set(initial("asking"));

    let stream: StreamLike;
    try {
      stream = await getUserMedia({ audio: true });
    } catch (error) {
      if (session !== this.session) return;
      const name = (error as { name?: string } | null)?.name ?? "";
      if (
        name === "NotAllowedError" ||
        name === "SecurityError" ||
        name === "PermissionDeniedError"
      ) {
        return this.set(initial("denied"));
      }
      const missing =
        name === "NotFoundError" ||
        name === "OverconstrainedError" ||
        name === "DevicesNotFoundError";
      return this.set({ ...initial("error"), error: missing ? "no-microphone" : "failed" });
    }
    // Cancelled (or started again) while the permission prompt was open: let the microphone go.
    if (session !== this.session || this.cancelled) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    this.stream = stream;
    this.chunks = [];
    this.bytes = 0;
    this.before = 0;
    this.endedBy = "user";
    try {
      const type = pickMimeType(Recorder);
      const recorder = new Recorder(stream as never, {
        ...(type ? { mimeType: type } : {}),
        audioBitsPerSecond: BITS_PER_SECOND,
      });
      this.mimeType = recorder.mimeType || type || "";
      recorder.ondataavailable = (event) => this.onData(event.data);
      recorder.onstop = () => this.onStop();
      recorder.onerror = () => this.finish("interrupted");
      for (const track of stream.getTracks())
        track.addEventListener?.("ended", () => this.finish("interrupted"));
      this.recorder = recorder;
      this.meter = this.deps.createMeter?.(stream) ?? null;
      recorder.start(TIMESLICE_MS);
    } catch {
      this.release();
      return this.set({ ...initial("error"), error: "failed" });
    }
    this.startedAt = this.deps.now();
    this.set({ ...initial("recording") });
    this.timer = this.deps.setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    if (this.state.phase !== "recording" && this.state.phase !== "paused") return;
    const elapsedMs = Math.min(this.elapsed(), VOICE_MAX_MS);
    this.set({
      elapsedMs,
      level: this.state.phase === "recording" ? (this.meter?.read() ?? 0) : 0,
    });
    if (this.state.phase === "recording" && this.elapsed() >= VOICE_MAX_MS) this.finish("time");
  }

  private onData(data: Blob) {
    if (!data || data.size === 0) return;
    this.chunks.push(data);
    this.bytes += data.size;
    if (this.bytes >= VOICE_MAX_BYTES - SIZE_MARGIN) this.finish("size");
  }

  pause(): void {
    if (this.state.phase !== "recording" || !this.recorder) return;
    this.before = this.elapsed();
    this.recorder.pause();
    this.set({ phase: "paused", elapsedMs: Math.min(this.before, VOICE_MAX_MS), level: 0 });
  }

  resume(): void {
    if (this.state.phase !== "paused" || !this.recorder) return;
    this.recorder.resume();
    this.startedAt = this.deps.now();
    this.set({ phase: "recording" });
  }

  /** "Done": stop and keep what was recorded. */
  finish(reason: EndedBy = "user"): void {
    if (this.state.phase !== "recording" && this.state.phase !== "paused") return;
    this.before = Math.min(this.elapsed(), VOICE_MAX_MS);
    this.endedBy = reason;
    this.set({ phase: "finishing", elapsedMs: this.before, level: 0 });
    this.clearTimer();
    try {
      this.recorder?.stop();
    } catch {
      this.onStop();
    }
  }

  private onStop() {
    if (this.cancelled || this.state.phase === "idle") return;
    const durationMs = Math.round(this.before);
    const type = this.mimeType || this.chunks[0]?.type || "audio/webm";
    const blob = new Blob(this.chunks, { type });
    this.release();
    if (durationMs < VOICE_MIN_MS || blob.size === 0) {
      return this.set({ ...initial("idle"), tooShort: true });
    }
    this.set({
      phase: "done",
      elapsedMs: durationMs,
      level: 0,
      result: { blob, mimeType: type, durationMs, endedBy: this.endedBy },
    });
  }

  /** Throws the recording away. Nothing is kept or uploaded. */
  cancel(): void {
    this.cancelled = true;
    this.session += 1;
    this.clearTimer();
    const recorder = this.recorder;
    this.release();
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // Already stopped.
    }
    this.chunks = [];
    this.bytes = 0;
    this.set(initial(isRecordingSupported(this.deps) ? "idle" : "unsupported"));
  }

  /** Back to ready, after a result was taken or an error was read. */
  reset(): void {
    this.cancel();
  }

  private clearTimer() {
    if (this.timer !== null) this.deps.clearInterval(this.timer);
    this.timer = null;
  }

  /** The microphone indicator goes off as soon as this runs. */
  private release() {
    this.clearTimer();
    this.meter?.close();
    this.meter = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.recorder = null;
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }
}
