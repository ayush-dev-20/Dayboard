import { describe, expect, it } from "vitest";
import { pickMimeType, VoiceRecorder, type RecorderDeps } from "@/lib/voice/recorder";
import { VOICE_MAX_BYTES, VOICE_MAX_MS, VOICE_MIN_MS } from "@/lib/voice/types";

// V2 feature 13 §10, unit: the recorder's state machine driven by a fake MediaRecorder, a fake
// microphone and a fake clock. No browser, no microphone.

class FakeTrack {
  stopped = false;
  private ended: (() => void)[] = [];
  stop() {
    this.stopped = true;
  }
  addEventListener(_type: "ended", listener: () => void) {
    this.ended.push(listener);
  }
  end() {
    for (const l of this.ended) l();
  }
}

class FakeRecorder {
  static supported = new Set(["audio/webm;codecs=opus", "audio/mp4"]);
  static last: FakeRecorder | null = null;
  static isTypeSupported(type: string) {
    return FakeRecorder.supported.has(type);
  }
  mimeType: string;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  started: number | undefined;
  constructor(
    public stream: unknown,
    public options?: { mimeType?: string; audioBitsPerSecond?: number },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeRecorder.last = this;
  }
  start(timeslice?: number) {
    this.state = "recording";
    this.started = timeslice;
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
  /** What the browser does after `stop()`: one last chunk, then the stop event. */
  emit(size: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)], { type: this.mimeType }) });
  }
}

function setup(over: Partial<RecorderDeps> = {}) {
  let clock = 1_000_000;
  const track = new FakeTrack();
  const stream = { getTracks: () => [track] };
  let ticker: (() => void) | null = null;
  let meterClosed = false;
  const deps: RecorderDeps = {
    getUserMedia: async () => stream,
    Recorder: FakeRecorder as never,
    now: () => clock,
    setInterval: (fn) => {
      ticker = fn;
      return 1;
    },
    clearInterval: () => {
      ticker = null;
    },
    createMeter: () => ({ read: () => 0.4, close: () => (meterClosed = true) }),
    ...over,
  };
  const recorder = new VoiceRecorder(deps);
  return {
    recorder,
    track,
    meterClosed: () => meterClosed,
    advance(ms: number) {
      clock += ms;
      ticker?.();
    },
    ticking: () => ticker !== null,
  };
}

describe("choosing what to record in", () => {
  it("takes the best supported type, and none when nothing is known", () => {
    expect(pickMimeType(FakeRecorder as never)).toBe("audio/webm;codecs=opus");
    FakeRecorder.supported = new Set(["audio/mp4"]);
    expect(pickMimeType(FakeRecorder as never)).toBe("audio/mp4");
    FakeRecorder.supported = new Set();
    expect(pickMimeType(FakeRecorder as never)).toBeUndefined();
    FakeRecorder.supported = new Set(["audio/webm;codecs=opus", "audio/mp4"]);
    expect(pickMimeType(undefined)).toBeUndefined();
  });
});

describe("when recording is not possible", () => {
  it("is unsupported without MediaRecorder or a microphone API", () => {
    expect(setup({ Recorder: undefined }).recorder.getState().phase).toBe("unsupported");
    expect(setup({ getUserMedia: undefined }).recorder.getState().phase).toBe("unsupported");
  });

  it("explains a refused permission, and a missing microphone", async () => {
    const denied = setup({
      getUserMedia: async () => {
        throw Object.assign(new Error("no"), { name: "NotAllowedError" });
      },
    });
    await denied.recorder.start();
    expect(denied.recorder.getState().phase).toBe("denied");

    const missing = setup({
      getUserMedia: async () => {
        throw Object.assign(new Error("none"), { name: "NotFoundError" });
      },
    });
    await missing.recorder.start();
    expect(missing.recorder.getState()).toMatchObject({ phase: "error", error: "no-microphone" });

    const broken = setup({
      getUserMedia: async () => {
        throw new Error("weird");
      },
    });
    await broken.recorder.start();
    expect(broken.recorder.getState()).toMatchObject({ phase: "error", error: "failed" });
  });

  it("does not ask for the microphone until start is called", () => {
    let asked = 0;
    setup({
      getUserMedia: async () => {
        asked += 1;
        return { getTracks: () => [] };
      },
    });
    expect(asked).toBe(0);
  });
});

describe("recording", () => {
  it("asks, records, counts time and level, and returns the audio on Done", async () => {
    const t = setup();
    const phases: string[] = [];
    t.recorder.subscribe(() => phases.push(t.recorder.getState().phase));
    await t.recorder.start();
    expect(t.recorder.getState().phase).toBe("recording");
    expect(FakeRecorder.last!.options).toMatchObject({ mimeType: "audio/webm;codecs=opus" });
    expect(FakeRecorder.last!.options!.audioBitsPerSecond).toBeLessThanOrEqual(64_000);

    t.advance(3000);
    expect(t.recorder.getState()).toMatchObject({ elapsedMs: 3000, level: 0.4 });
    FakeRecorder.last!.emit(500);
    FakeRecorder.last!.emit(700);
    t.recorder.finish();

    const state = t.recorder.getState();
    expect(state.phase).toBe("done");
    expect(state.result).toMatchObject({ durationMs: 3000, endedBy: "user" });
    expect(state.result!.blob.size).toBe(1200);
    expect(state.result!.mimeType).toBe("audio/webm;codecs=opus");
    expect(phases).toEqual(["asking", "recording", "recording", "finishing", "done"]);
  });

  it("lets go of the microphone and the meter the moment it ends", async () => {
    const t = setup();
    await t.recorder.start();
    expect(t.track.stopped).toBe(false);
    t.advance(2000);
    FakeRecorder.last!.emit(10);
    t.recorder.finish();
    expect(t.track.stopped).toBe(true);
    expect(t.meterClosed()).toBe(true);
    expect(t.ticking()).toBe(false);
  });

  it("pauses without counting the pause, and carries on", async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(2000);
    t.recorder.pause();
    expect(t.recorder.getState()).toMatchObject({ phase: "paused", elapsedMs: 2000, level: 0 });
    expect(FakeRecorder.last!.state).toBe("paused");
    t.advance(60_000);
    expect(t.recorder.getState().elapsedMs).toBe(2000);
    t.recorder.resume();
    t.advance(1000);
    expect(t.recorder.getState()).toMatchObject({ phase: "recording", elapsedMs: 3000 });
    FakeRecorder.last!.emit(10);
    t.recorder.finish();
    expect(t.recorder.getState().result!.durationMs).toBe(3000);
  });

  it("can be finished while paused", async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(2500);
    t.recorder.pause();
    FakeRecorder.last!.emit(10);
    t.recorder.finish();
    expect(t.recorder.getState().result!.durationMs).toBe(2500);
  });

  it("ignores a second start while recording", async () => {
    const t = setup();
    await t.recorder.start();
    const first = FakeRecorder.last;
    await t.recorder.start();
    expect(FakeRecorder.last).toBe(first);
  });
});

describe("limits", () => {
  it("stops by itself at five minutes", async () => {
    const t = setup();
    await t.recorder.start();
    FakeRecorder.last!.emit(100);
    t.advance(VOICE_MAX_MS - 1);
    expect(t.recorder.getState().phase).toBe("recording");
    t.advance(1);
    const state = t.recorder.getState();
    expect(state.phase).toBe("done");
    expect(state.result).toMatchObject({ endedBy: "time", durationMs: VOICE_MAX_MS });
    expect(t.track.stopped).toBe(true);
  });

  it("never reports more than five minutes, even if the timer was late", async () => {
    const t = setup();
    await t.recorder.start();
    FakeRecorder.last!.emit(100);
    t.advance(VOICE_MAX_MS + 20_000);
    expect(t.recorder.getState().result!.durationMs).toBe(VOICE_MAX_MS);
  });

  it("stops before the file can pass ten megabytes", async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(60_000);
    FakeRecorder.last!.emit(5 * 1024 * 1024);
    expect(t.recorder.getState().phase).toBe("recording");
    FakeRecorder.last!.emit(5 * 1024 * 1024 - 100 * 1024);
    const state = t.recorder.getState();
    expect(state.phase).toBe("done");
    expect(state.result!.endedBy).toBe("size");
    expect(state.result!.blob.size).toBeLessThanOrEqual(VOICE_MAX_BYTES);
  });
});

describe("cancel, accidents and interruptions", () => {
  it("cancel throws everything away and releases the microphone", async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(4000);
    FakeRecorder.last!.emit(100);
    t.recorder.cancel();
    expect(t.recorder.getState()).toMatchObject({ phase: "idle", result: null, elapsedMs: 0 });
    expect(t.track.stopped).toBe(true);
    expect(t.ticking()).toBe(false);
  });

  it("cancelling while the permission prompt is open lets the microphone go when it arrives", async () => {
    const track = new FakeTrack();
    let grant: (stream: { getTracks: () => FakeTrack[] }) => void = () => {};
    const t = setup({
      getUserMedia: () =>
        new Promise((resolve) => {
          grant = resolve as never;
        }),
    });
    const started = t.recorder.start();
    expect(t.recorder.getState().phase).toBe("asking");
    t.recorder.cancel();
    grant({ getTracks: () => [track] });
    await started;
    expect(t.recorder.getState().phase).toBe("idle");
    expect(track.stopped).toBe(true);
  });

  it("throws away a recording shorter than a moment, as an accidental tap", async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(VOICE_MIN_MS - 100);
    FakeRecorder.last!.emit(10);
    t.recorder.finish();
    expect(t.recorder.getState()).toMatchObject({ phase: "idle", tooShort: true, result: null });
  });

  it("keeps what was recorded when the microphone goes away", async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(5000);
    FakeRecorder.last!.emit(300);
    t.track.end();
    const state = t.recorder.getState();
    expect(state.phase).toBe("done");
    expect(state.result).toMatchObject({ endedBy: "interrupted", durationMs: 5000 });
  });

  it("keeps what was recorded when the recorder reports an error", async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(2000);
    FakeRecorder.last!.emit(300);
    FakeRecorder.last!.onerror?.();
    expect(t.recorder.getState().result?.endedBy).toBe("interrupted");
  });

  it("can record again after a result or a cancel", async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(2000);
    FakeRecorder.last!.emit(10);
    t.recorder.finish();
    t.recorder.reset();
    expect(t.recorder.getState().phase).toBe("idle");
    await t.recorder.start();
    expect(t.recorder.getState().phase).toBe("recording");
    expect(t.recorder.getState().elapsedMs).toBe(0);
  });
});
