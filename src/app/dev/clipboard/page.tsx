import { notFound } from "next/navigation";
import { ClipboardCapture } from "@/components/dev/clipboard-capture";

export const metadata = { title: "Clipboard capture (development only)" };

// A developer tool for recording what a real tool puts on the clipboard (V2 feature 02 §6). It does
// not exist in a production build.
export default function ClipboardCapturePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ClipboardCapture />;
}
