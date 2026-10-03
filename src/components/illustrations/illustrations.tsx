// In-house spot illustrations for empty states (feature 07 §9.7). Single-weight line art in
// `currentColor` with one detail in the accent; each well under 3 KB. Paths marked `data-draw`
// draw themselves in once on mount (600ms) when motion is allowed, and are static otherwise.
// Decorative: always aria-hidden, the empty state's words carry the meaning.

type Props = { className?: string };

function Frame({ className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 96"
      width="112"
      height="90"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["illustration", className].filter(Boolean).join(" ")}
    >
      {children}
    </svg>
  );
}

const ink = { stroke: "var(--primary)" };

/** Today, nothing left: a sun rising over a ruled line. */
export function TodayClear({ className }: Props) {
  return (
    <Frame className={className}>
      <path data-draw pathLength={1} d="M38 62a22 22 0 0 1 44 0" style={ink} />
      <path data-draw pathLength={1} d="M60 26v8M38 34l5 5M82 34l-5 5M28 52h6M86 52h6" />
      <path data-draw pathLength={1} d="M16 62h88" />
      <path data-draw pathLength={1} d="M32 72h56M44 81h32" opacity="0.5" />
    </Frame>
  );
}

/** Tasks, none yet: a list with one square box ticked. */
export function TasksEmpty({ className }: Props) {
  return (
    <Frame className={className}>
      <rect data-draw pathLength={1} x="30" y="14" width="60" height="70" rx="6" />
      <rect data-draw pathLength={1} x="40" y="28" width="9" height="9" rx="2" style={ink} />
      <path data-draw pathLength={1} d="m42 32.5 2 2 3.5-4" style={ink} />
      <path data-draw pathLength={1} d="M56 32.5h24" />
      <rect data-draw pathLength={1} x="40" y="45" width="9" height="9" rx="2" />
      <path data-draw pathLength={1} d="M56 49.5h18" />
      <rect data-draw pathLength={1} x="40" y="62" width="9" height="9" rx="2" />
      <path data-draw pathLength={1} d="M56 66.5h21" />
    </Frame>
  );
}

/** Notes, none yet: a page with a folded corner and a pen. */
export function NotesEmpty({ className }: Props) {
  return (
    <Frame className={className}>
      <path
        data-draw
        pathLength={1}
        d="M34 14h38l14 14v54a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z"
      />
      <path data-draw pathLength={1} d="M72 14v14h14" />
      <path data-draw pathLength={1} d="M40 42h30M40 51h36M40 60h22" opacity="0.6" />
      <path data-draw pathLength={1} d="m70 74 20-20 6 6-20 20h-6Z" style={ink} />
      <path data-draw pathLength={1} d="m86 58 6 6" style={ink} />
    </Frame>
  );
}

/** Projects, none yet: three cards, the front one with a color strip. */
export function ProjectsEmpty({ className }: Props) {
  return (
    <Frame className={className}>
      <rect data-draw pathLength={1} x="40" y="12" width="52" height="40" rx="6" opacity="0.4" />
      <rect data-draw pathLength={1} x="34" y="22" width="52" height="40" rx="6" opacity="0.7" />
      <rect data-draw pathLength={1} x="26" y="34" width="56" height="48" rx="6" />
      <path data-draw pathLength={1} d="M26 41h56" style={ink} />
      <path data-draw pathLength={1} d="M34 54h26M34 62h18" />
      <path data-draw pathLength={1} d="M34 72h40" opacity="0.5" />
    </Frame>
  );
}

/** Inbox zero: an empty tray, with a tick above it. */
export function InboxZero({ className }: Props) {
  return (
    <Frame className={className}>
      <path
        data-draw
        pathLength={1}
        d="M22 56 32 34h56l10 22v22a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V56Z"
      />
      <path data-draw pathLength={1} d="M22 56h22l4 8h24l4-8h22" />
      <path data-draw pathLength={1} d="m50 18 7 7 13-14" style={ink} />
    </Frame>
  );
}

/** Trash, empty: a bin with its lid on. */
export function TrashEmpty({ className }: Props) {
  return (
    <Frame className={className}>
      <path data-draw pathLength={1} d="M38 30h44l-4 50a4 4 0 0 1-4 4H46a4 4 0 0 1-4-4L38 30Z" />
      <path
        data-draw
        pathLength={1}
        d="M32 30h56M52 30v-6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6"
        style={ink}
      />
      <path data-draw pathLength={1} d="M52 42v30M60 42v30M68 42v30" opacity="0.5" />
    </Frame>
  );
}

/** Search, no results: a magnifier over ruled lines. */
export function SearchEmpty({ className }: Props) {
  return (
    <Frame className={className}>
      <path data-draw pathLength={1} d="M20 30h34M20 42h24M20 54h30M20 66h20" opacity="0.5" />
      <circle data-draw pathLength={1} cx="72" cy="46" r="18" style={ink} />
      <path data-draw pathLength={1} d="m85 59 13 13" />
      <path data-draw pathLength={1} d="M64 46h16" />
    </Frame>
  );
}

export const ILLUSTRATIONS = {
  "today-clear": TodayClear,
  "tasks-empty": TasksEmpty,
  "notes-empty": NotesEmpty,
  "projects-empty": ProjectsEmpty,
  "inbox-zero": InboxZero,
  "trash-empty": TrashEmpty,
  "search-empty": SearchEmpty,
} as const;

export type IllustrationName = keyof typeof ILLUSTRATIONS;
