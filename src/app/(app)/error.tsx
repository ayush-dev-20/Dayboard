"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/layout/error-state";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server already logged the details; the digest ties them to this screen.
    console.error("Page error", error.digest);
  }, [error]);

  return <ErrorState onRetry={reset} digest={error.digest} />;
}
