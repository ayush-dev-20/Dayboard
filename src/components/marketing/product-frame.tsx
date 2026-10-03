import { FrameImage } from "./frame-image";
import { cn } from "@/lib/utils";
import { MARKETING_IMAGES, type MarketingImage } from "./image-sizes";

/**
 * A real screenshot of the app in a quiet frame (DESIGN.md: product-frame): 16px radius, the `md`
 * shadow, a hairline. Light and dark images swap with the theme. The images come from
 * `pnpm capture:marketing`, never from a mockup, and carry their real size so nothing shifts.
 */
export function ProductFrame({
  name,
  alt,
  priority,
  className,
  sizes = "(min-width: 1024px) 960px, 100vw",
}: {
  /** File stem in public/marketing: `${name}-light.png` and `${name}-dark.png`. */
  name: MarketingImage;
  alt: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  const { width, height } = MARKETING_IMAGES[name];
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-md dark:border-border-strong",
        className,
      )}
    >
      <div className="overflow-hidden rounded-lg border border-border">
        <FrameImage
          src={`/marketing/${name}-light.png`}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          sizes={sizes}
          className="block dark:hidden"
        />
        <FrameImage
          src={`/marketing/${name}-dark.png`}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          sizes={sizes}
          className="hidden dark:block"
        />
      </div>
    </div>
  );
}
