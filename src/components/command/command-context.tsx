"use client";

import { createContext, useContext } from "react";

export type CommandMode = "search" | "ask" | "create" | "capture";

export type CommandControls = {
  /** Opens the menu. `capture` goes straight to the quick-capture box. */
  open: (mode?: CommandMode) => void;
};

export const CommandContext = createContext<CommandControls>({ open: () => {} });

export function useCommandMenu(): CommandControls {
  return useContext(CommandContext);
}
