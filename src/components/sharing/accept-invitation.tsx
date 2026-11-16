"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvitation, declineInvitation } from "@/actions/sharing";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Accept or decline from the email link. The same message for a wrong, expired or already-used link. */
export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    const result = await acceptInvitation({ token });
    if (!result.ok) {
      setPending(false);
      setError(
        "This invitation isn't available. It may have expired, been withdrawn, or been sent to a different email address.",
      );
      return;
    }
    router.push(
      result.data.type === "PROJECT" ? `/projects/${result.data.id}` : `/notes/${result.data.id}`,
    );
  }

  async function decline() {
    setPending(true);
    const result = await declineInvitation({ token });
    setPending(false);
    if (!result.ok) {
      setError("This invitation isn't available.");
      return;
    }
    router.push("/shared");
  }

  return (
    <section aria-labelledby="invite-heading" className="mx-auto mt-12 max-w-md">
      <h1 id="invite-heading" className="type-headline-md text-foreground">
        You&apos;ve been invited
      </h1>
      <p className="mt-2 type-body-md text-muted-foreground">
        Accept to add it to Shared with me. You can leave at any time.
      </p>
      {error ? <Alert className="mt-4">{error}</Alert> : null}
      <div className="mt-6 flex gap-3">
        <Button onClick={() => void accept()} disabled={pending}>
          Accept
        </Button>
        <Button variant="secondary" onClick={() => void decline()} disabled={pending}>
          Decline
        </Button>
      </div>
    </section>
  );
}
