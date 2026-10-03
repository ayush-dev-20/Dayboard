import type { MetadataRoute } from "next";

// Only the public pages are indexed: the landing page and the legal pages. Everything behind
// sign-in is disallowed (it would only show the sign-in screen anyway).
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/privacy", "/terms"],
        disallow: [
          "/today",
          "/inbox",
          "/tasks",
          "/notes",
          "/projects",
          "/search",
          "/trash",
          "/settings",
          "/more",
          "/onboarding",
          "/sign-in",
          "/sign-up",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
          "/magic-link-sent",
          "/api/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
