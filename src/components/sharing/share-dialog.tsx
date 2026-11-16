"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  changeShareRole,
  inviteToShare,
  listShares,
  removeShare,
  revokeInvitation,
  stopSharing,
} from "@/actions/sharing";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ROLE_HELP, ROLE_LABEL } from "@/lib/sharing/invitations";
import type { ShareList } from "@/modules/sharing/service";

type Role = "EDITOR" | "COMMENTER" | "VIEWER";
const ROLES: Role[] = ["EDITOR", "COMMENTER", "VIEWER"];

type Props = {
  type: "PROJECT" | "NOTE";
  id: string;
  /** The item's name, for the dialog's heading. */
  name: string;
  ownerName: string;
  /** The in-app address of the item (never a public link). */
  path: string;
};

/**
 * Who can see this project or note (V3 feature 04 §7): people with their role, an email field to invite more, open
 * invitations, and a copy of the in-app address. The owner's tool only; a collaborator never gets the button.
 */
export function ShareButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Users strokeWidth={1.5} aria-hidden /> Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>{open ? <ShareBody {...props} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}

function ShareBody({ type, id, name, ownerName, path }: Props) {
  const kind = type === "PROJECT" ? "project" : "note";
  const [data, setData] = useState<ShareList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("EDITOR");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const load = useCallback(async () => {
    const result = await listShares({ type, id });
    if (result.ok) setData(result.data);
    else setError(result.error.message);
  }, [type, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list when the dialog opens
    void load();
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setEmailError(undefined);
    const result = await inviteToShare({ type, id, email, role });
    setPending(false);
    if (!result.ok) {
      setEmailError(result.error.fieldErrors?.email ?? result.error.message);
      return;
    }
    setEmail("");
    toast("Invitation sent.");
    await load();
  }

  async function act(run: () => Promise<{ ok: boolean }>, done: string) {
    const result = await run();
    if (!result.ok) toast.error("Couldn't do that. Try again.");
    else toast(done);
    await load();
  }

  async function stopAll() {
    setConfirmStop(false);
    await act(() => stopSharing({ type, id }), "Sharing stopped.");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      toast("Address copied.");
    } catch {
      toast.error("Couldn't copy. Select the address in the bar instead.");
    }
  }

  return (
    <>
      <DialogTitle>Share “{name}”</DialogTitle>
      <DialogDescription>
        Invite people by email. They need a Dayboard account to open it; there is no public link.
      </DialogDescription>
      {error ? <Alert className="mt-4">{error}</Alert> : null}

      <ul
        className="mt-4 divide-y divide-border border-y border-border"
        aria-label="People with access"
      >
        <li className="flex items-center justify-between gap-3 py-2.5">
          <span className="min-w-0 truncate type-body-md">{ownerName}</span>
          <span className="type-body-sm text-muted-foreground">Owner</span>
        </li>
        {data?.grants.map((g) => (
          <li key={g.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate type-body-md">{g.name}</span>
              <span className="block truncate type-body-sm text-muted-foreground">{g.email}</span>
            </span>
            <NativeSelect
              aria-label={`Role for ${g.name}`}
              value={g.role}
              onChange={(e) =>
                void act(
                  () => changeShareRole({ grantId: g.id, role: e.target.value }),
                  "Role changed.",
                )
              }
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
            <button
              type="button"
              aria-label={`Remove ${g.name}`}
              onClick={() => void act(() => removeShare({ grantId: g.id }), "Access removed.")}
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          </li>
        ))}
        {data?.invitations.map((i) => (
          <li key={i.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate type-body-md">{i.email}</span>
              <span className="block type-body-sm text-muted-foreground">
                Invited as {ROLE_LABEL[i.role].toLowerCase()}, not accepted yet
              </span>
            </span>
            <Button
              variant="ghost"
              onClick={() => void act(() => revokeInvitation({ id: i.id }), "Invitation revoked.")}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>

      {data && (data.grants.length > 0 || data.invitations.length > 0) ? (
        <div className="mt-3 flex items-center gap-3">
          {confirmStop ? (
            <>
              <p className="min-w-0 flex-1 type-body-sm">
                Everyone loses access and open invitations are withdrawn.
              </p>
              <Button variant="destructive" onClick={() => void stopAll()}>
                Stop sharing
              </Button>
              <Button variant="ghost" onClick={() => setConfirmStop(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmStop(true)}>
              Stop sharing with everyone
            </Button>
          )}
        </div>
      ) : null}

      <form onSubmit={invite} className="mt-4 flex flex-col gap-3">
        <Field id="share-email" label="Invite by email" error={emailError}>
          {(props) => (
            <Input
              {...props}
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          )}
        </Field>
        <Field id="share-role" label="They can" hint={ROLE_HELP[role]}>
          {(props) => (
            <NativeSelect {...props} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button type="submit" disabled={pending || !email.trim()}>
          Invite
        </Button>
      </form>

      <DialogFooter className="mt-4">
        <Button variant="ghost" onClick={() => void copyLink()}>
          <Copy strokeWidth={1.5} aria-hidden /> Copy link
        </Button>
        <p className="mr-auto self-center type-body-sm text-muted-foreground">
          The address only opens for people you invited, once they sign in.
        </p>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </DialogFooter>
      <span className="sr-only">This {kind} is shared only with the people listed.</span>
    </>
  );
}
