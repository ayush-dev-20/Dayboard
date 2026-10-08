"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, MoreHorizontal, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { pickFiles } from "@/components/editor/blocks/file-insert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { formatShortDate } from "@/lib/dates/relative";
import { fileUrl, type AttachmentDTO } from "@/lib/storage/dto";
import { ACCEPT, formatBytes, validateDeclared } from "@/lib/storage/policy";
import type { OwnerType } from "@/lib/storage/types";
import { cn } from "@/lib/utils";
import { deleteFile, listFiles } from "./api";
import { markAttachmentRemoved, primeAttachments } from "./attachment-meta-store";
import { FileKindIcon } from "./file-icon";
import { ImageViewer } from "./image-viewer";
import {
  cancelUpload,
  dismissUpload,
  retryUpload,
  startUpload,
  useUploadsFor,
  type Upload,
} from "./upload-manager";

// The Attachments section of a note, task or project (V2 feature 09 §6): a hairline list with an
// "Attach files" button and a drop zone. Files added from the editor (a picture block, a file
// block) belong to the same owner, so they are listed here too.

type Props = {
  ownerType: OwnerType;
  ownerId: string | null;
  className?: string;
};

function UploadRow({ upload }: { upload: Upload }) {
  const failed = upload.status === "failed";
  return (
    <li className="border-b border-border px-2 py-2" aria-live="polite">
      <div className="flex min-h-9 items-center gap-2">
        {failed ? (
          <FileKindIcon category={upload.isImage ? "image" : "document"} mime={upload.mime} />
        ) : (
          <Loader2
            className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate type-body-md">{upload.name}</span>
        <span className="shrink-0 type-body-sm text-muted-foreground">
          {formatBytes(upload.size)}
        </span>
        {failed ? (
          <>
            {validateDeclared({ name: upload.name, mime: upload.mime, size: upload.size }).ok ? (
              <Button variant="secondary" onClick={() => retryUpload(upload.id)}>
                Retry
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => dismissUpload(upload.id)}>
              Dismiss
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => cancelUpload(upload.id)}>
            Cancel
          </Button>
        )}
      </div>
      {failed ? (
        <p role="alert" className="type-body-sm text-muted-foreground">
          {upload.error}
        </p>
      ) : (
        <div
          role="progressbar"
          aria-label={`Uploading ${upload.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(upload.progress * 100)}
          className="mt-1 h-1 overflow-hidden rounded-full bg-secondary"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${upload.progress * 100}%` }}
          />
        </div>
      )}
    </li>
  );
}

function FileRow({
  file,
  onDelete,
}: {
  file: AttachmentDTO;
  onDelete: (file: AttachmentDTO) => void;
}) {
  const [viewing, setViewing] = useState(false);
  const image = file.category === "image";
  return (
    <li className="flex min-h-row-touch items-center gap-2 border-b border-border px-2 py-1 md:min-h-row">
      {image ? (
        <button
          type="button"
          onClick={() => setViewing(true)}
          aria-label={`Open picture: ${file.name}`}
          className="size-8 shrink-0 cursor-zoom-in overflow-hidden rounded-sm bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind a redirect */}
          <img src={fileUrl(file.id)} alt="" loading="lazy" className="size-8 object-cover" />
        </button>
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center">
          <FileKindIcon category={file.category} mime={file.mime} />
        </span>
      )}
      <a
        href={fileUrl(file.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate type-body-md text-foreground no-underline hover:underline"
      >
        {file.name}
      </a>
      <span className="hidden shrink-0 type-body-sm text-muted-foreground sm:inline">
        {formatBytes(file.size)} · {formatShortDate(new Date(file.createdAt))}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${file.name}`}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:size-8"
        >
          <MoreHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={fileUrl(file.id, { download: true })}>
              <Download className="size-4" strokeWidth={1.5} aria-hidden /> Download
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDelete(file)}>
            <Trash2 className="size-4" strokeWidth={1.5} aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {image ? (
        <ImageViewer
          attachmentId={file.id}
          label={file.name}
          open={viewing}
          onOpenChange={setViewing}
        />
      ) : null}
    </li>
  );
}

export function AttachmentsSection({ ownerType, ownerId, className }: Props) {
  const { filesEnabled } = useWorkspace();
  const [saved, setSaved] = useState<AttachmentDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const uploads = useUploadsFor(ownerType, ownerId);

  useEffect(() => {
    if (!filesEnabled || !ownerId) return;
    let alive = true;
    void listFiles(ownerType, ownerId).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setSaved(result.data.attachments);
        primeAttachments(result.data.attachments);
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [filesEnabled, ownerType, ownerId]);

  // Saved files plus the ones that finished during this visit, newest first.
  const files = useMemo(() => {
    const byId = new Map(saved.map((file) => [file.id, file]));
    for (const upload of uploads) {
      if (upload.status === "done" && upload.attachment) {
        byId.set(upload.attachment.id, upload.attachment);
      }
    }
    return [...byId.values()]
      .filter((file) => !removed.has(file.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [saved, uploads, removed]);

  const inFlight = uploads.filter((u) => u.status !== "done" && u.status !== "canceled");

  if (!filesEnabled || !ownerId) return null;

  function add(list: File[]) {
    for (const file of list) startUpload(file, { type: ownerType, id: ownerId! });
  }

  async function remove(file: AttachmentDTO) {
    const result = await deleteFile(file.id);
    if (!result.ok) {
      toast.error("Couldn't delete that file. Try again.");
      return;
    }
    setRemoved((set) => new Set(set).add(file.id));
    markAttachmentRemoved(file.id);
    toast("File removed.");
  }

  return (
    <section
      aria-labelledby={`attachments-heading-${ownerId}`}
      data-testid="attachments"
      className={cn("mt-6", className)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragging(false);
        add(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id={`attachments-heading-${ownerId}`} className="type-label-caps text-muted-foreground">
          Attachments
          {files.length > 0 ? <span className="type-data-sm"> {files.length}</span> : null}
        </h3>
        <Button variant="secondary" onClick={async () => add(await pickFiles(ACCEPT))}>
          <Paperclip className="size-4" strokeWidth={1.5} aria-hidden /> Attach files
        </Button>
      </div>
      <ul
        className={cn(
          "border-t border-border",
          dragging && "rounded-md outline-2 -outline-offset-2 outline-ring",
        )}
      >
        {inFlight.map((upload) => (
          <UploadRow key={upload.id} upload={upload} />
        ))}
        {files.map((file) => (
          <FileRow key={file.id} file={file} onDelete={(f) => void remove(f)} />
        ))}
      </ul>
      {loaded && files.length === 0 && inFlight.length === 0 ? (
        <p className="py-3 type-body-md text-muted-foreground">
          No attachments. Drop files here or use Attach files.
        </p>
      ) : null}
    </section>
  );
}
