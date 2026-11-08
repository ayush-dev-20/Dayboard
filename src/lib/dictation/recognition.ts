// The browser's own speech recognition (Chrome, Edge, Safari and Android call it webkitSpeechRecognition). Typed here
// because the DOM library does not include it. Nothing is sent to Dayboard's servers: the browser does the listening
// (Chrome and Edge send the audio to their vendor's speech service, which the settings note says).

export type RecognitionAlternative = { transcript: string };
export type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative; length: number };
export type RecognitionEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
};
export type RecognitionErrorEvent = { error: string };

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

export function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const dictationSupported = () => recognitionConstructor() !== null;

/** What to tell the person for each way recognition can fail. `null` means say nothing. */
export function explainDictationError(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Dictation needs the microphone. Allow it for this site in your browser settings.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Dictation needs an internet connection.";
    case "language-not-supported":
      return "Dictation isn't available for your language in this browser.";
    case "no-speech":
    case "aborted":
      return null;
    default:
      return "Dictation stopped. Try again.";
  }
}

/** Spoken commands such as "comma" are English only. */
export const speaksEnglish = (lang: string) => lang.toLowerCase().startsWith("en");
