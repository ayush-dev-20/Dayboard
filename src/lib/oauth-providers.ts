import "server-only";
import type { OAuthProvider } from "@/components/auth/oauth-buttons";
import { env } from "@/lib/env";

/** Only providers with both credentials set are offered. Local development works with none. */
export function enabledOAuthProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (env.googleEnabled) providers.push("google");
  if (env.githubEnabled) providers.push("github");
  return providers;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
