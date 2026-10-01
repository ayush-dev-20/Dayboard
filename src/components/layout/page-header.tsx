import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
};

/** The page's h1. On phones the top bar already shows the title, so the heading stays for screen readers only. */
export function PageHeader({ title, description, className, children }: Props) {
  return (
    <div className={cn("mb-6 flex items-start justify-between gap-4", className)}>
      <div>
        <h1 className="sr-only type-headline-lg text-foreground md:not-sr-only">{title}</h1>
        {description ? (
          <p className="mt-1 type-body-md text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
