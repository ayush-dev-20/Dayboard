import { AuthShell } from "@/components/auth/auth-shell";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
