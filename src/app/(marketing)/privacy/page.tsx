import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Privacy" };
export const dynamic = "force-static";

// A plain-language draft for the owner to review (feature 07 §15, Q4). Every statement here is
// true of the code today; keep it that way when the product changes.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="October 2, 2026">
      <p>
        Dayboard is a personal workspace. This page explains what we keep, why, and what you can do
        about it.
      </p>
      <h2>What we keep</h2>
      <ul>
        <li>
          Your account: name, email address, and how you sign in (password, Google or GitHub).
        </li>
        <li>What you write: tasks, todos, notes, projects, tags and inbox items.</li>
        <li>Your preferences, such as theme, time zone and whether AI is on.</li>
        <li>Your sessions, so you can see and sign out devices from Settings.</li>
      </ul>
      <h2>Who can see it</h2>
      <p>
        Only you. Every record belongs to one account and is never shown to anyone else. There is no
        sharing and no public page of your content.
      </p>
      <h2>AI features</h2>
      <p>
        AI runs only when you ask for it. Each action sends the minimum content it needs (for
        example, the one note you asked to summarize) to the AI provider. Prompts and answers are
        not stored, except the AI suggestion on an inbox item and the daily suggestion on Today. You
        can turn AI off in Settings at any time.
      </p>
      <h2>Email</h2>
      <p>
        We send email only for your account: confirming your address, sign-in links and password
        resets. Emails contain no tracking pixels.
      </p>
      <h2>Deleting your data</h2>
      <p>
        You can delete your account from Settings → Account. Your account and everything in it are
        deleted. Backups may keep a copy until they rotate out.
      </p>
    </LegalPage>
  );
}
