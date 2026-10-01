import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: string;
  className?: string;
  /** One or two buttons. */
  children?: React.ReactNode;
};

/** Compact and flush-left: a line, a sentence, one or two actions. No illustration. */
export function EmptyState({ title, description, className, children }: Props) {
  return (
    <div className={cn("max-w-prose py-6", className)}>
      <h2 className="type-headline-sm text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 type-body-md text-muted-foreground">{description}</p>
      ) : null}
      {children ? <div className="mt-4 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}
