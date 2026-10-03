import { ILLUSTRATIONS, type IllustrationName } from "@/components/illustrations/illustrations";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: string;
  /** A small spot illustration (feature 07 §9.7). Omit for an inline, text-only empty state. */
  illustration?: IllustrationName;
  /** A keyboard hint under the actions, e.g. "or press N". */
  hint?: React.ReactNode;
  className?: string;
  /** One primary action and, optionally, one secondary one. */
  children?: React.ReactNode;
};

/**
 * Guides the next step instead of saying "no data": an illustration, a title, one sentence, one or
 * two actions and an optional keyboard hint. Left-aligned like everything in the column.
 */
export function EmptyState({ title, description, illustration, hint, className, children }: Props) {
  const Illustration = illustration ? ILLUSTRATIONS[illustration] : null;
  return (
    <div className={cn("max-w-prose py-6", illustration && "py-10", className)}>
      {Illustration ? <Illustration className="mb-5 text-muted-foreground" /> : null}
      <h2 className="type-headline-sm text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 type-body-md text-muted-foreground">{description}</p>
      ) : null}
      {children ? <div className="mt-4 flex flex-wrap gap-2">{children}</div> : null}
      {hint ? <p className="mt-3 type-body-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
