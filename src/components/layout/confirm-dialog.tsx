"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  /** When set, the person must type this exact text before the confirm button works (e.g. DELETE). */
  requireText?: string;
  pending?: boolean;
  error?: string | null;
};

/** The one confirm dialog. Destructive buttons live here or in overflow menus, never beside Complete. */
export function ConfirmDialog({ open, onOpenChange, title, description, ...body }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {/* Mounted only while open, so the typed text starts empty every time. */}
        <ConfirmBody {...body} />
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({
  confirmLabel,
  onConfirm,
  destructive = false,
  requireText,
  pending = false,
  error,
}: Omit<Props, "open" | "onOpenChange" | "title" | "description">) {
  const [typed, setTyped] = useState("");
  const blocked = requireText !== undefined && typed !== requireText;

  return (
    <>
      {error ? <Alert className="mt-4">{error}</Alert> : null}

      {requireText !== undefined ? (
        <Field id="confirm-text" label={`Type ${requireText} to confirm`} className="mt-4">
          {(a11y) => (
            <Input
              {...a11y}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          )}
        </Field>
      ) : null}

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button
          variant={destructive ? "destructive" : "primary"}
          disabled={blocked || pending}
          onClick={() => void onConfirm()}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
