"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  priority?: boolean;
  className?: string;
};

/**
 * A marketing screenshot that never shows a broken-image icon. If the file can't be loaded (it
 * hasn't been generated yet by `pnpm capture:marketing`, the optimizer failed, or the visitor is
 * offline), a quiet placeholder of the same size takes its place, so the layout doesn't move and
 * the alt text still names what belongs there.
 */
export function FrameImage({ src, alt, width, height, sizes, priority, className }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        style={{ aspectRatio: `${width} / ${height}` }}
        className={cn("w-full bg-muted", className)}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      priority={priority}
      onError={() => setFailed(true)}
      className={cn("h-auto w-full", className)}
    />
  );
}
