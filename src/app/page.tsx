import { redirect } from "next/navigation";

// Signed-out visitors are sent on to /sign-in by the proxy and by `requireUser`.
export default function RootPage() {
  redirect("/today");
}
