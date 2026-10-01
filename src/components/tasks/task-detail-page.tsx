"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { TaskDetailDTO } from "@/lib/tasks/dto";
import { TaskDetail } from "./task-detail";

/** The full-page view used below 1024px (and by direct links). */
export function TaskDetailPage({ detail }: { detail: TaskDetailDTO }) {
  const router = useRouter();

  return (
    <div className="max-w-content">
      <Link
        href="/tasks"
        className="mb-4 -ml-2 inline-flex h-11 items-center gap-2 rounded-md px-2 type-body-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-8"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden /> Tasks
      </Link>
      <h1 className="sr-only">Task</h1>
      <TaskDetail detail={detail} variant="page" onClose={() => router.push("/tasks")} />
    </div>
  );
}
