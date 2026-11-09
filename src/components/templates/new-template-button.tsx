"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createTemplate } from "@/actions/templates";
import { Button } from "@/components/ui/button";

/** "New template": makes an empty one and opens it (the limit of 50 is the refusal a person can reach). */
export function NewTemplateButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const result = await createTemplate({});
    if (!result.ok) {
      setBusy(false);
      toast.error(result.error.message);
      return;
    }
    router.push(`/templates/${result.data.id}`);
  }

  return (
    <Button variant={variant} onClick={() => void create()} disabled={busy}>
      <Plus strokeWidth={1.5} aria-hidden /> New template
    </Button>
  );
}
