"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-errors";
import { AuthLink } from "./auth-shell";
import { OAuthButtons, type OAuthProvider } from "./oauth-buttons";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = { name?: string; email?: string; password?: string };

export function validateSignUp(values: {
  name: string;
  email: string;
  password: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  if (name.length < 1) errors.name = "Enter your name.";
  else if (name.length > 80) errors.name = "Use 80 characters or fewer.";
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = "Enter a valid email address.";
  if (values.password.length < 10) errors.password = "Use at least 10 characters.";
  else if (values.password.length > 128) errors.password = "Use 128 characters or fewer.";
  return errors;
}

export function SignUpForm({ next, providers }: { next: string; providers: OAuthProvider[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const nextQuery = next === "/today" ? "" : `?next=${encodeURIComponent(next)}`;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors = validateSignUp({ name, email, password });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPending(true);
    const { data, error } = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
      callbackURL: next,
    });

    if (error) {
      setPending(false);
      setFormError(describeAuthError(error).message);
      return;
    }

    // A session means mail isn't required (local development). Otherwise ask them to verify.
    if (data?.token) {
      router.replace(next);
      router.refresh();
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
  }

  return (
    <>
      {formError ? <Alert className="mb-6">{formError}</Alert> : null}

      <OAuthButtons providers={providers} callbackURL={next} onError={setFormError} />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field id="signup-name" label="Name" error={fieldErrors.name}>
          {(a11y) => (
            <Input
              {...a11y}
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field id="signup-email" label="Email" error={fieldErrors.email}>
          {(a11y) => (
            <Input
              {...a11y}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field
          id="signup-password"
          label="Password"
          hint="At least 10 characters. No other rules."
          error={fieldErrors.password}
        >
          {(a11y) => (
            <PasswordInput
              {...a11y}
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <Button type="submit" className="mt-2 w-full" disabled={pending}>
          <UserPlus strokeWidth={1.5} aria-hidden />
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 type-body-md text-muted-foreground">
        Already have an account? <AuthLink href={`/sign-in${nextQuery}`}>Sign in</AuthLink>
      </p>
    </>
  );
}
