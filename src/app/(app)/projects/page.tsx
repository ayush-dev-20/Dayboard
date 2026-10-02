import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { NewProjectButton } from "@/components/projects/new-project-button";
import { ProjectCard } from "@/components/projects/project-card";
import { listProjects } from "@/db/queries/projects";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/projects/status";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Projects" };

function Heading({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground">
      {label}
      <span className="type-data-sm">{count}</span>
    </h2>
  );
}

export default async function ProjectsPage() {
  const user = await requireUser({ redirect: true });
  const projects = await listProjects(user.id);
  const by = (status: ProjectStatus) => projects.filter((p) => p.status === status);
  const active = by("ACTIVE");
  const archived = by("ARCHIVED");

  return (
    <div className="max-w-content">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="sr-only type-headline-lg text-foreground md:not-sr-only">Projects</h1>
          {projects.length > 0 ? (
            <p className="mt-1 type-body-md text-muted-foreground">{active.length} active</p>
          ) : null}
        </div>
        <NewProjectButton />
      </header>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet."
          description="Projects group tasks, todos and notes. Everything also works without one."
        >
          <NewProjectButton />
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {(["ACTIVE", "ON_HOLD", "COMPLETED"] as const).map((status) => {
            const items = by(status);
            if (items.length === 0) return null;
            return (
              <section key={status} aria-label={PROJECT_STATUS_LABELS[status]}>
                <Heading label={PROJECT_STATUS_LABELS[status]} count={items.length} />
                <ul className="border-t border-border">
                  {items.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </ul>
              </section>
            );
          })}

          {archived.length > 0 ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 pb-2 type-label-caps text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="size-4 transition-transform duration-[120ms] group-open:rotate-90"
                  strokeWidth={1.5}
                  aria-hidden
                />
                Archived
                <span className="type-data-sm">{archived.length}</span>
              </summary>
              <ul className="border-t border-border">
                {archived.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}
