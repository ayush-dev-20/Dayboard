import { FrameImage } from "./frame-image";
import { cn } from "@/lib/utils";
import { MARKETING_IMAGES, type MarketingImage } from "./image-sizes";

/** A real screenshot (light and dark) at its real size, without the product frame. */
export function Screenshot({
  name,
  alt,
  sizes,
  className,
}: {
  name: MarketingImage;
  alt: string;
  sizes: string;
  className?: string;
}) {
  const { width, height } = MARKETING_IMAGES[name];
  return (
    <>
      <FrameImage
        src={`/marketing/${name}-light.png`}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        className={cn("block dark:hidden", className)}
      />
      <FrameImage
        src={`/marketing/${name}-dark.png`}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
