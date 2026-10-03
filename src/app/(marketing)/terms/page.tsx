import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Terms" };
export const dynamic = "force-static";

// A plain-language draft for the owner to review (feature 07 §15, Q4).
export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="October 2, 2026">
      <p>These terms describe how you may use Dayboard.</p>
      <h2>Your account</h2>
      <p>
        Keep your sign-in details to yourself. You are responsible for what happens in your account.
        One account is for one person.
      </p>
      <h2>Your content</h2>
      <p>
        What you write in Dayboard is yours. We store it so the app can show it back to you, and for
        nothing else.
      </p>
      <h2>AI suggestions</h2>
      <p>
        AI features make suggestions that can be wrong. Nothing is changed until you confirm it, so
        check a suggestion before you accept it.
      </p>
      <h2>Using the service</h2>
      <p>
        Don&apos;t use Dayboard to break the law, to harm others, or to interfere with the service.
        We may limit or close accounts that do.
      </p>
      <h2>Ending your account</h2>
      <p>You can delete your account at any time from Settings → Account.</p>
    </LegalPage>
  );
}
