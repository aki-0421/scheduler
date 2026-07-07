"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { TaskWizard } from "@/components/task-wizard";
import { taskToDraft } from "@/lib/task-draft";
import { useTask } from "@/lib/queries";
import type { TaskDto } from "@/lib/types";

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
    return <div className="text-sm text-muted-foreground">Loading task...</div>;
  }

  return (
    <TaskWizard
      key={prefillFromTask ?? "blank"}
      initialDraft={initialDraft}
      onSaved={handleSaved}
      cancelHref="/tasks"
    />
  );
}

export default function NewTaskPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading task...</div>}>
      <NewTaskPageContent />
    </Suspense>
  );
}
