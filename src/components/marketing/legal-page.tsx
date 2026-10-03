/** A plain reading page for the legal texts, with a visible "draft" note until the owner approves them. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-editor px-4 pt-32 pb-24 md:px-6">
      <h1 className="type-headline-lg text-foreground md:type-display">{title}</h1>
      <p className="mt-2 type-body-sm text-muted-foreground">Last updated {updated}</p>
      <p
        role="note"
        className="mt-6 rounded-lg border border-border bg-warning-subtle px-4 py-3 type-body-md text-foreground"
      >
        Draft for review. This plain-language text describes how Dayboard works today and has not
        yet been approved as final.
      </p>
      <div className="mt-10 flex flex-col gap-4 type-body-lg text-foreground [&_h2]:mt-6 [&_h2]:type-headline-sm [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
        {children}
      </div>
    </article>
  );
}
