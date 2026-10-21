"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createCanvas } from "@/actions/canvases";
import { Button } from "@/components/ui/button";

/**
 * "New canvas": makes an empty drawing and opens it. Not saved until it exists, so a failure leaves nothing behind and
 * says why (the limit of 100 canvases is the one a person can reach).
 */
export function NewCanvasButton({
  variant = "primary",
  className,
}: {
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const result = await createCanvas({});
    if (!result.ok) {
      setBusy(false);
      toast.error(result.error.message);
      return;
    }
    router.push(`/canvases/${result.data.id}`);
  }

  return (
    <Button variant={variant} onClick={() => void create()} disabled={busy} className={className}>
      <Plus strokeWidth={1.5} aria-hidden /> New canvas
    </Button>
  );
}
