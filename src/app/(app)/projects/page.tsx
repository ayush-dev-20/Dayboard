import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { NewProjectButton } from "@/components/projects/new-project-button";
import { ProjectCard } from "@/components/projects/project-card";
import { listProjects, nextDueTasks } from "@/db/queries/projects";
import { getUserToday } from "@/lib/dates/today";
import { getPreferences } from "@/lib/preferences";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/projects/status";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";

export const metadata: Metadata = { title: "Projects" };

function Heading({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 pb-3 type-label-caps text-muted-foreground">
      {label}
      <span className="type-data-sm">{count}</span>
    </h2>
  );
}

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const [projects, nextDue, prefs] = await Promise.all([
    listProjects(user.id),
    nextDueTasks(user.id),
    getPreferences(user.id),
  ]);
  const today = getUserToday({ timezone: prefs.timezone, startOfDay: prefs.startOfDay });
  const grid = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";
  const autoOpen = (await searchParams).new === "1";
  const by = (status: ProjectStatus) => projects.filter((p) => p.status === status);
  const active = by("ACTIVE");
  const archived = by("ARCHIVED");

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Projects"
        description={projects.length > 0 ? `${active.length} active` : undefined}
      >
        <NewProjectButton autoOpen={autoOpen} />
      </PageHeader>

      {projects.length === 0 ? (
        <EmptyState
          illustration="projects-empty"
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
                <ul className={grid}>
                  {items.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      nextDue={nextDue.get(project.id)}
                      today={today}
                    />
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
              <ul className={grid}>
                {archived.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    nextDue={nextDue.get(project.id)}
                    today={today}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
