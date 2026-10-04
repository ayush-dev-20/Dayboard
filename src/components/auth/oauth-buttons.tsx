"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export type OAuthProvider = "google" | "github";

const LABELS: Record<OAuthProvider, string> = { google: "Google", github: "GitHub" };

// Official marks. Google's "G" keeps its four brand colors (Google's sign-in guidelines ask for it);
// GitHub's mark is Simple Icons 16.33.0 (CC0), drawn in the button's own text color.
const GOOGLE_PATHS = [
  {
    fill: "#4285F4",
    d: "M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z",
  },
  {
    fill: "#34A853",
    d: "M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z",
  },
  {
    fill: "#FBBC05",
    d: "M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z",
  },
  {
    fill: "#EA4335",
    d: "M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z",
  },
];
const GITHUB_PATH =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

function ProviderMark({ provider }: { provider: OAuthProvider }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5 shrink-0 fill-current">
      {provider === "google" ? (
        GOOGLE_PATHS.map((p) => <path key={p.fill} fill={p.fill} d={p.d} />)
      ) : (
        <path d={GITHUB_PATH} />
      )}
    </svg>
  );
}

type Props = {
  providers: OAuthProvider[];
  /** Where to land after signing in. Already validated by the caller. */
  callbackURL: string;
  onError: (message: string) => void;
};

/** Full-width secondary buttons above an "or" divider. Renders nothing when no provider is configured. */
export function OAuthButtons({ providers, callbackURL, onError }: Props) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  if (providers.length === 0) return null;

  async function start(provider: OAuthProvider) {
    setPending(provider);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL,
      newUserCallbackURL: "/onboarding",
      errorCallbackURL: "/sign-in",
    });
    if (error) {
      setPending(null);
      onError("We couldn't start that sign-in. Try again or use another method.");
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            variant="secondary"
            className="h-12 w-full gap-3 border border-border px-5 type-body-md font-semibold md:h-12 [&_svg]:size-5"
            disabled={pending !== null}
            aria-busy={pending === provider}
            onClick={() => start(provider)}
          >
            {pending === provider ? (
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
              />
            ) : (
              <ProviderMark provider={provider} />
            )}
            {pending === provider ? "Redirecting…" : `Continue with ${LABELS[provider]}`}
          </Button>
        ))}
      </div>
      <div className="my-6 flex items-center gap-4" role="separator" aria-label="or">
        <span className="h-px flex-1 bg-border" />
        <span className="type-label-caps text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}
