"use client";

import { useState } from "react";
import { Download, ExternalLink, Link2, Loader2, MoreHorizontal, RefreshCw, X } from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { toast } from "sonner";
import { fetchLinkPreview } from "@/components/files/api";
import { useAttachment } from "@/components/files/attachment-meta-store";
import { FileKindIcon } from "@/components/files/file-icon";
import { ImageViewer } from "@/components/files/image-viewer";
import { ResizableFrame } from "./image-resize";
import {
  cancelUpload,
  dismissUpload,
  retryUpload,
  useUpload,
} from "@/components/files/upload-manager";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IMAGE_CAPTION_MAX } from "@/lib/editor/limits";
import { fileUrl } from "@/lib/storage/dto";
import { formatBytes } from "@/lib/storage/policy";
import { cn } from "@/lib/utils";

// How the three blocks of V2 feature 09 §6 look and behave. Image and file blocks hold only an
// attachment id; what they show comes from the attachment store and the upload manager, so a file
// that was removed says "File removed" and a file still going up shows its progress, never a broken
// picture. A bookmark holds a snapshot of the page's preview, so it reads the same offline.

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="h-1 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div className="h-full bg-primary transition-[width]" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

/** What a block shows for an upload that is not finished: progress, or the retry row. */
function UploadState({ id, name, onRemove }: { id: string; name: string; onRemove: () => void }) {
  const upload = useUpload(id);
  if (!upload) return null;
  if (upload.status === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2 type-body-md" role="alert">
        <span className="text-muted-foreground">{upload.error ?? "Couldn't upload."}</span>
        <Button variant="secondary" onClick={() => retryUpload(id)}>
          Retry
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            dismissUpload(id);
            onRemove();
          }}
        >
          Remove
        </Button>
      </div>
    );
  }
  if (upload.status === "canceled") return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 type-body-md text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {upload.status === "finishing" ? "Finishing" : "Uploading"} {name}
        </span>
        <Button
          variant="ghost"
          onClick={() => {
            cancelUpload(id);
            onRemove();
          }}
        >
          Cancel
        </Button>
      </div>
      <Progress value={upload.progress} label={`Uploading ${name}`} />
    </div>
  );
}

const removedNote = <p className="type-body-md text-muted-foreground">File removed</p>;

export function ImageView({ node, editor, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const id = String(node.attrs.attachmentId ?? "");
  const caption = String(node.attrs.caption ?? "");
  const width = typeof node.attrs.width === "number" ? node.attrs.width : null;
  const state = useAttachment(id);
  const upload = useUpload(id);
  const [viewing, setViewing] = useState(false);
  const [broken, setBroken] = useState(false);
  // The picture's own proportions, from the file's record or, failing that, from the loaded image.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  const pending = upload && upload.status !== "done";
  const name = state.state === "ready" ? state.file.name : (upload?.name ?? "image");
  const label = caption || name;
  const editable = editor.isEditable;

  if (pending || state.state === "loading" || state.state === "missing" || broken) {
    let body: React.ReactNode;
    if (pending) {
      body = (
        <div className="rounded-md border border-border p-3">
          <UploadState id={id} name={upload.name} onRemove={() => deleteNode()} />
        </div>
      );
    } else if (state.state === "loading") {
      body = (
        <div
          className="h-24 animate-pulse rounded-md bg-secondary motion-reduce:animate-none"
          aria-busy="true"
        />
      );
    } else {
      body = <div className="rounded-md border border-border p-3">{removedNote}</div>;
    }
    return (
      <NodeViewWrapper className="image-block" contentEditable={false} data-attachment-id={id}>
        {body}
      </NodeViewWrapper>
    );
  }

  const { file } = state;
  const naturalWidth = file.width ?? natural?.width ?? null;
  const naturalHeight = file.height ?? natural?.height ?? null;
  const aspect = naturalWidth && naturalHeight ? naturalWidth / naturalHeight : 1.5;

  return (
    <NodeViewWrapper className="image-block" contentEditable={false} data-attachment-id={id}>
      <ResizableFrame
        width={width}
        aspect={aspect}
        naturalWidth={naturalWidth}
        editable={editable}
        selected={selected}
        onResize={(next) => updateAttributes({ width: next })}
      >
        <button
          type="button"
          onClick={() => setViewing(true)}
          aria-label={`Open picture: ${label}`}
          className="block w-full cursor-zoom-in rounded-md focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind a redirect */}
          <img
            src={fileUrl(id)}
            alt={label}
            width={file.width ?? undefined}
            height={file.height ?? undefined}
            loading="lazy"
            draggable={false}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setBroken(true)}
            className="block h-auto w-full rounded-md"
          />
        </button>
        {editable ? (
          <input
            type="text"
            value={caption}
            maxLength={IMAGE_CAPTION_MAX}
            placeholder="Add a caption"
            aria-label="Picture caption"
            onChange={(event) => updateAttributes({ caption: event.target.value })}
            className="image-caption mt-1 w-0 min-w-full bg-transparent type-body-sm text-muted-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : caption ? (
          <p className="mt-1 type-body-sm text-muted-foreground">{caption}</p>
        ) : null}
      </ResizableFrame>
      <ImageViewer attachmentId={id} label={label} open={viewing} onOpenChange={setViewing} />
    </NodeViewWrapper>
  );
}

export function FileView({ node, deleteNode }: NodeViewProps) {
  const id = String(node.attrs.attachmentId ?? "");
  const state = useAttachment(id);
  const upload = useUpload(id);
  const pending = upload && upload.status !== "done";

  let body: React.ReactNode;
  if (pending) {
    body = <UploadState id={id} name={upload.name} onRemove={() => deleteNode()} />;
  } else if (state.state === "loading") {
    body = (
      <div
        className="h-5 w-40 animate-pulse rounded bg-secondary motion-reduce:animate-none"
        aria-busy="true"
      />
    );
  } else if (state.state === "missing") {
    body = removedNote;
  } else {
    const { file } = state;
    body = (
      <div className="flex min-h-11 items-center gap-2 md:min-h-9">
        <FileKindIcon category={file.category} mime={file.mime} />
        <a
          href={fileUrl(id)}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate type-body-md text-foreground no-underline hover:underline"
        >
          {file.name}
        </a>
        <span className="shrink-0 type-body-sm text-muted-foreground">
          {formatBytes(file.size)}
        </span>
        <a
          href={fileUrl(id, { download: true })}
          aria-label={`Download ${file.name}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:size-8"
        >
          <Download className="size-4" strokeWidth={1.5} aria-hidden />
        </a>
      </div>
    );
  }

  return (
    <NodeViewWrapper
      className="file-block rounded-md border border-border px-3 py-1"
      contentEditable={false}
      data-attachment-id={id}
    >
      {body}
    </NodeViewWrapper>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function BookmarkView({
  node,
  editor,
  updateAttributes,
  deleteNode,
  getPos,
}: NodeViewProps) {
  const url = String(node.attrs.url ?? "");
  const title = (node.attrs.title as string | null) || hostOf(url);
  const description = node.attrs.description as string | null;
  const siteName = (node.attrs.siteName as string | null) || hostOf(url);
  const favicon = node.attrs.favicon as string | null;
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    const result = await fetchLinkPreview(url, true);
    setBusy(false);
    if (!result.ok || result.data.preview.status !== "OK") {
      toast("Couldn't load a preview.");
      return;
    }
    const p = result.data.preview;
    updateAttributes({
      title: p.title,
      description: p.description,
      siteName: p.siteName,
      favicon: p.favicon,
      fetchedAt: p.fetchedAt,
    });
  }

  function convertToLink() {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const link = editor.state.schema.marks.link;
    if (!link) return;
    const text = editor.state.schema.text(url, [link.create({ href: url })]);
    const paragraph = editor.state.schema.nodes.paragraph!.create(null, text);
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, paragraph));
  }

  const failed = !node.attrs.title && !node.attrs.description && !node.attrs.fetchedAt;

  if (failed) {
    // A preview that could not be loaded is a plain link with a quiet note, never an empty card.
    return (
      <NodeViewWrapper className="bookmark-block" contentEditable={false}>
        <p className="type-body-md">
          <a href={url} target="_blank" rel="noopener noreferrer nofollow">
            {url}
          </a>{" "}
          <span className="type-body-sm text-muted-foreground">Couldn&apos;t load a preview.</span>
        </p>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="bookmark-block" contentEditable={false}>
      <div className="group/bookmark relative flex rounded-md border border-border hover:bg-accent/50">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`Open ${title} (${siteName}) in a new tab`}
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-1 p-3 text-foreground no-underline",
            "rounded-md focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span className="truncate type-body-md font-semibold">{title}</span>
          {description ? (
            <span className="line-clamp-2 type-body-sm text-muted-foreground">{description}</span>
          ) : null}
          <span className="flex items-center gap-1.5 type-body-sm text-muted-foreground">
            {favicon ? (
              // eslint-disable-next-line @next/next/no-img-element -- a small data: icon
              <img src={favicon} alt="" width={16} height={16} className="size-4 rounded-sm" />
            ) : (
              <Link2 className="size-4" strokeWidth={1.5} aria-hidden />
            )}
            <span className="truncate">{siteName}</span>
            <ExternalLink className="size-3 shrink-0" strokeWidth={1.5} aria-hidden />
          </span>
        </a>
        {editor.isEditable ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Bookmark options"
              className="m-1 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:size-8"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <MoreHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void refresh()}>
                <RefreshCw className="size-4" strokeWidth={1.5} aria-hidden /> Refresh
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={convertToLink}>
                <Link2 className="size-4" strokeWidth={1.5} aria-hidden /> Convert to link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => deleteNode()}>
                <X className="size-4" strokeWidth={1.5} aria-hidden /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
