"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { TaskWizard } from "@/components/task-wizard";
import { Skeleton } from "@/components/ui/skeleton";
import { taskToDraft } from "@/lib/task-draft";
import { useTask } from "@/lib/queries";
import type { TaskDto } from "@/lib/types";

function NewTaskLoading() {
  return (
    <div className="grid gap-5">
      <PageHeader
        title="New task"
        description="Describe the work, choose where Codex should run, and set the schedule."
      />
      <div className="grid gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function NewTaskPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillFromTask = searchParams.get("prefillFromTask") ?? undefined;
  const sourceRun = searchParams.get("sourceRun") ?? undefined;
  const sourceTask = useTask(prefillFromTask);
  const initialDraft = useMemo(() => {
    if (!sourceTask.data) {
      return undefined;
    }

    const draft = taskToDraft(sourceTask.data);
    return {
      ...draft,
      id: undefined,
      slug: undefined,
      name: `Follow-up: ${sourceTask.data.name}`,
      description: sourceRun ? `Follow-up for run ${sourceRun}` : draft.description,
      scheduleMode: "manual" as const,
      forcePaused: false,
    };
  }, [sourceRun, sourceTask.data]);

  function handleSaved(task: TaskDto) {
    router.push(`/tasks?task=${task.id}`);
  }

  if (prefillFromTask && sourceTask.isLoading) {
    return <NewTaskLoading />;
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title={prefillFromTask ? "Follow-up task" : "New task"}
        description="Describe the work, choose where Codex should run, and set the schedule."
      />
      <TaskWizard
        key={prefillFromTask ?? "blank"}
        initialDraft={initialDraft}
        onSaved={handleSaved}
        cancelHref="/tasks"
      />
    </div>
  );
}

export default function NewTaskPage() {
  return (
    <Suspense fallback={<NewTaskLoading />}>
      <NewTaskPageContent />
    </Suspense>
  );
}
