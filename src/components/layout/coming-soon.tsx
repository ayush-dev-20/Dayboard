import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

/** Placeholder so navigation is complete from day one. Each page is replaced by its own feature. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="max-w-content">
      <PageHeader title={title} />
      <EmptyState
        title={`${title} is on its way`}
        description="This part of Dayboard is still being built. Everything else is ready to use."
      />
    </div>
  );
}
