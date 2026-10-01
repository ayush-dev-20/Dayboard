"use client";

import { useCallback, useEffect, useState } from "react";

/** Counts down once a second from `start` seconds. `restart()` begins again. */
export function useCountdown(start = 0) {
  const [seconds, setSeconds] = useState(start);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = window.setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [seconds]);

  const restart = useCallback((from: number) => setSeconds(from), []);
  return { seconds, restart, active: seconds > 0 };
}
