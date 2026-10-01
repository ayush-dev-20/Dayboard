import { cn } from "@/lib/utils";

export function SettingsSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-12 first:mt-6", className)}>
      <h2 className="mb-1 type-headline-sm text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Title and helper text on the left, the control on the right, a hairline underneath. */
export function SettingsRow({
  title,
  description,
  children,
  className,
  stackOnPhone = false,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** For wide controls (a long select): on phones the control moves under the title at full width. */
  stackOnPhone?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-16 items-center justify-between gap-4 border-b border-border py-3",
        stackOnPhone && "max-sm:flex-col max-sm:items-stretch max-sm:gap-2",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="type-body-md font-semibold text-foreground">{title}</p>
        {description ? <p className="type-body-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? (
        <div className={cn("shrink-0", stackOnPhone && "max-sm:w-full")}>{children}</div>
      ) : null}
    </div>
  );
}
