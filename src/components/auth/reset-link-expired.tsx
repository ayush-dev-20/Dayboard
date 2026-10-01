import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AuthHeading, AuthLink } from "./auth-shell";

export function ResetLinkExpired() {
  return (
    <>
      <AuthHeading
        title="This link has expired"
        description="Reset links can only be used once. Request a new one to continue."
      />
      <Link
        href="/forgot-password"
        className={cn(buttonVariants({ variant: "secondary" }), "w-full")}
      >
        Request a new link
      </Link>
      <p className="mt-6 type-body-md">
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </p>
    </>
  );
}
