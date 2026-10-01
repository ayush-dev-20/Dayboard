import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <AuthShell>
      <h1 className="type-headline-lg">We couldn&apos;t find that</h1>
      <p className="mt-2 type-body-md text-muted-foreground">
        The page may have moved, or the link may be wrong.
      </p>
      <Link href="/today" className={cn(buttonVariants({ variant: "secondary" }), "mt-6 w-full")}>
        Go to Today
      </Link>
    </AuthShell>
  );
}
