import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { MotionProvider } from "@/components/motion/motion-provider";
import { Toaster } from "@/components/ui/sonner";
import "@/styles/globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "Dayboard", template: "%s · Dayboard" },
  description: "A calm personal workspace for tasks, todos, notes and projects.",
  applicationName: "Dayboard",
  openGraph: {
    type: "website",
    siteName: "Dayboard",
    title: "Dayboard: capture anything, act on what matters",
    description:
      "A calm personal workspace for tasks, todos, notes and projects, with AI that asks first.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f2" },
    { media: "(prefers-color-scheme: dark)", color: "#15120e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MotionProvider>
            {children}
            <Toaster />
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
