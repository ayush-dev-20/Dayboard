"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { stopSharing } from "@/actions/sharing";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { SharedByMeItem } from "@/modules/sharing/service";

/** What the person shares with others, with a way to see who has access and to stop it (owner controls). */
export function SharedByMeList({ items }: { items: SharedByMeItem[] }) {
  const router = useRouter();
  const [stopping, setStopping] = useState<SharedByMeItem | null>(null);
  const [pending, setPending] = useState(false);

  async function stop() {
    if (!stopping) return;
    setPending(true);
    const result = await stopSharing({ type: stopping.type, id: stopping.id });
    setPending(false);
    setStopping(null);
    if (!result.ok) toast.error("Couldn't stop sharing. Try again.");
    else toast("Sharing stopped.");
    router.refresh();
  }

  return (
    <section aria-labelledby="shared-by-me">
      <h2 id="shared-by-me" className="pb-2 type-label-caps text-muted-foreground">
        Shared by me
      </h2>
      <ul className="border-t border-border">
        {items.map((item) => (
          <li
            key={`${item.type}:${item.id}`}
            className="flex items-center gap-3 border-b border-border py-3"
          >
            <Link
              href={item.type === "PROJECT" ? `/projects/${item.id}` : `/notes/${item.id}`}
              className="min-w-0 flex-1 truncate type-body-md hover:underline"
            >
              {item.emoji ? <span aria-hidden>{item.emoji} </span> : null}
              {item.title.trim() || "Untitled"}
            </Link>
            <span className="type-body-sm text-muted-foreground">
              {item.type === "PROJECT" ? "Project" : "Note"} · {item.people}{" "}
              {item.people === 1 ? "person" : "people"}
              {item.invitations > 0 ? `, ${item.invitations} invited` : ""}
            </span>
            <Button variant="ghost" onClick={() => setStopping(item)}>
              Stop sharing
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={stopping !== null}
        onOpenChange={(open) => {
          if (!open) setStopping(null);
        }}
        title="Stop sharing?"
        description="Everyone loses access at once and open invitations are withdrawn. Nothing is deleted, and you can share it again."
        confirmLabel="Stop sharing"
        destructive
        pending={pending}
        onConfirm={stop}
      />
    </section>
  );
}
