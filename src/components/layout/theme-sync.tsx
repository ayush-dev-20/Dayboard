"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/** The saved theme follows the account across devices; the browser copy keeps it flash-free. */
export function ThemeSync({ theme }: { theme: "light" | "dark" | "system" }) {
  const { theme: current, setTheme } = useTheme();

  useEffect(() => {
    if (current !== undefined && current !== theme) setTheme(theme);
    // Only react to the saved value changing, not to the local copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return null;
}
