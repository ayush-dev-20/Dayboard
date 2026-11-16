"use client";

import { cn } from "@/lib/utils";
import { presenceInitials } from "@/lib/collab/presence";
import type { LiveNote } from "./use-live-note";

const MAX_AVATARS = 4;

/**
 * Who else is in this note, and whether the connection is up (V3 feature 05 §6). Initials in a colour from the person's id,
 * their name in the tooltip and the accessible name (colour is never the only signal). A polite live region says
 * "Rahul joined", "Reconnecting…" and "Back online"; typing and cursor moves are never announced.
 */
export function LivePresence({ live, className }: { live: LiveNote; className?: string }) {
  const shown = live.peers.slice(0, MAX_AVATARS);
  const more = live.peers.length - shown.length;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {live.phase === "reconnecting" ? (
        <span className="type-body-sm text-muted-foreground">
          Reconnecting… your changes are kept
        </span>
      ) : live.phase === "denied" ? (
        <span className="type-body-sm text-muted-foreground">Viewing only</span>
      ) : null}
      {shown.length > 0 ? (
        <ul className="flex items-center -space-x-1.5" aria-label="People in this note">
          {shown.map((p) => (
            <li
              key={p.id}
              title={p.name}
              aria-label={p.name}
              className="inline-flex size-7 items-center justify-center rounded-full border-2 border-background type-label-md text-white"
              style={{ backgroundColor: p.color }}
            >
              <span aria-hidden>{presenceInitials(p.name)}</span>
            </li>
          ))}
          {more > 0 ? (
            <li className="inline-flex size-7 items-center justify-center rounded-full border-2 border-background bg-secondary type-label-md text-foreground">
              +{more}
            </li>
          ) : null}
        </ul>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {live.announcement}
      </span>
    </div>
  );
}
