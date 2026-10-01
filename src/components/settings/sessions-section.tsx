"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { revokeOtherSessions, revokeSession } from "@/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "./settings-ui";

export type SessionRow = {
  id: string;
  device: string;
  /** Preformatted on the server: "Safari · 2 hours ago". */
  detail: string;
  current: boolean;
};

export function SessionsSection({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | "all" | null>(null);
  const [, startTransition] = useTransition();
  const hasOthers = sessions.some((s) => !s.current);

  function run(
    id: string | "all",
    action: () => ReturnType<typeof revokeSession>,
    success: string,
  ) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await action();
      setPendingId(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast(success);
      router.refresh();
    });
  }

  return (
    <>
      {error ? <Alert className="my-3">{error}</Alert> : null}
      {sessions.map((session) => (
        <SettingsRow
          key={session.id}
          title={session.current ? "This device" : session.device}
          description={session.current ? `${session.device} · ${session.detail}` : session.detail}
        >
          {session.current ? null : (
            <Button
              variant="ghost"
              disabled={pendingId !== null}
              onClick={() =>
                run(session.id, () => revokeSession({ sessionId: session.id }), "Signed out")
              }
            >
              Sign out
            </Button>
          )}
        </SettingsRow>
      ))}
      {hasOthers ? (
        <Button
          variant="secondary"
          className="mt-4"
          disabled={pendingId !== null}
          onClick={() => run("all", () => revokeOtherSessions(), "Signed out of other devices")}
        >
          Sign out other devices
        </Button>
      ) : null}
    </>
  );
}
