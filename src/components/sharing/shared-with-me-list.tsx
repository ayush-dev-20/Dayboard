"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { acceptInvitation, declineInvitation, leaveShare } from "@/actions/sharing";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, ROLE_LABEL } from "@/lib/sharing/invitations";
import type { SharedWithMe } from "@/modules/sharing/service";

const ROLE_WORDS = {
  EDITOR: "Can edit",
  COMMENTER: "Can comment",
  VIEWER: "Viewing only",
} as const;

export function SharedWithMeList({ data }: { data: SharedWithMe }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, call: () => Promise<{ ok: boolean }>, done: string) {
    setBusy(key);
    const result = await call();
    setBusy(null);
    if (!result.ok) toast.error("Couldn't do that. It may no longer be available.");
    else toast(done);
    router.refresh();
  }

  const byOwner = new Map<string, SharedWithMe["items"]>();
  for (const item of data.items)
    byOwner.set(item.ownerName, [...(byOwner.get(item.ownerName) ?? []), item]);

  return (
    <div className="flex flex-col gap-10">
      {data.invitations.length > 0 ? (
        <section aria-labelledby="shared-invitations">
          <h2 id="shared-invitations" className="pb-2 type-label-caps text-muted-foreground">
            Invitations
          </h2>
          <ul className="border-t border-border">
            {data.invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 border-b border-border py-3">
                <p className="min-w-0 flex-1 type-body-md">
                  {i.ownerName} invited you to a {KIND_LABEL[i.type]} as{" "}
                  {ROLE_LABEL[i.role].toLowerCase()}.
                </p>
                <Button
                  disabled={busy === i.id}
                  onClick={() =>
                    void run(
                      i.id,
                      async () => {
                        const r = await acceptInvitation({ id: i.id });
                        if (r.ok)
                          router.push(
                            r.data.type === "PROJECT"
                              ? `/projects/${r.data.id}`
                              : `/notes/${r.data.id}`,
                          );
                        return r;
                      },
                      "Added to Shared with me.",
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === i.id}
                  onClick={() =>
                    void run(i.id, () => declineInvitation({ id: i.id }), "Invitation declined.")
                  }
                >
                  Decline
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {[...byOwner.entries()].map(([owner, items]) => (
        <section key={owner} aria-label={`Shared by ${owner}`}>
          <h2 className="pb-2 type-label-caps text-muted-foreground">Shared by {owner}</h2>
          <ul className="border-t border-border">
            {items.map((item) => (
              <li
                key={item.grantId}
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
                  {KIND_LABEL[item.type] === "project" ? "Project" : "Note"} ·{" "}
                  {ROLE_WORDS[item.role]}
                </span>
                <Button
                  variant="ghost"
                  disabled={busy === item.grantId}
                  onClick={() =>
                    void run(item.grantId, () => leaveShare({ grantId: item.grantId }), "You left.")
                  }
                >
                  Leave
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
