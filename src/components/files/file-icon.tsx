import { File as FileIcon, FileImage, FileSpreadsheet, FileText, Presentation } from "lucide-react";
import type { FileCategory } from "@/lib/storage/policy";
import { cn } from "@/lib/utils";

const SHEET = /sheet|csv|excel/;
const SLIDES = /presentation|powerpoint/;

/** An icon for a file by its category (and, for documents, by kind). */
export function FileKindIcon({
  category,
  mime,
  className,
}: {
  category: FileCategory;
  mime?: string;
  className?: string;
}) {
  const props = {
    className: cn("size-4 shrink-0 text-muted-foreground", className),
    strokeWidth: 1.5,
    "aria-hidden": true,
  } as const;
  if (category === "image") return <FileImage {...props} />;
  if (mime && SHEET.test(mime)) return <FileSpreadsheet {...props} />;
  if (mime && SLIDES.test(mime)) return <Presentation {...props} />;
  if (category === "pdf" || category === "text" || category === "document") {
    return <FileText {...props} />;
  }
  return <FileIcon {...props} />;
}
