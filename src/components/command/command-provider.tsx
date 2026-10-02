"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CommandMenu } from "./command-menu";
import { CommandContext, type CommandMode } from "./command-context";

/**
 * Owns the command menu's open state and the global shortcuts: Cmd/Ctrl+K opens it (even while
 * typing, because that is the point of the shortcut), and `C` opens it in quick-capture mode when
 * nothing is being typed.
 */
export function CommandProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ mode: CommandMode } | null>(null);

  const open = useCallback((mode: CommandMode = "search") => setState({ mode }), []);
  const controls = useMemo(() => ({ open }), [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setState((s) => (s ? null : { mode: "search" }));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandContext.Provider value={controls}>
      {children}
      {state ? (
        <CommandMenu
          mode={state.mode}
          onModeChange={(mode) => setState({ mode })}
          onClose={() => setState(null)}
        />
      ) : null}
    </CommandContext.Provider>
  );
}
