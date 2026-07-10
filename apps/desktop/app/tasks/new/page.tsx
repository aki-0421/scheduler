"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { TaskWizard } from "@/components/task-wizard";
import { Skeleton } from "@/components/ui/skeleton";
import { taskToDraft } from "@/lib/task-draft";
import { useTask } from "@/lib/queries";
import type { TaskDto } from "@/lib/types";

const newTaskDescription =
  "タスク名とプロンプトで依頼内容を定義し、実行先、スケジュール、詳細設定を1画面で設定します。";

function NewTaskLoading({
  title = "新規タスク",
  description = newTaskDescription,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="grid gap-5">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-28" />
          </>
        }
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
  const duplicateFromTask = searchParams.get("duplicateFromTask") ?? undefined;
  const sourceRun = searchParams.get("sourceRun") ?? undefined;
  const sourceTask = useTask(prefillFromTask ?? duplicateFromTask);
  const title = duplicateFromTask
    ? "タスクを複製"
    : prefillFromTask
      ? "フォローアップタスク"
      : "新規タスク";
  const description = duplicateFromTask
    ? "既存タスクの設定をもとに、新しいタスクを作成します。"
    : prefillFromTask
      ? "選択した実行やタスクの文脈を引き継いで、次の作業用タスクを作成します。"
      : newTaskDescription;
  const initialDraft = useMemo(() => {
    if (!sourceTask.data) {
      return undefined;
    }

    const draft = taskToDraft(sourceTask.data);
    const duplicate = Boolean(duplicateFromTask);
    return {
      ...draft,
      id: undefined,
      slug: undefined,
      name: duplicate
        ? `${sourceTask.data.name} のコピー`
        : `フォローアップ: ${sourceTask.data.name}`,
      prompt:
        duplicate || !sourceRun
          ? draft.prompt
          : `実行 ${sourceRun} の結果を踏まえて、次のフォローアップを行ってください。\n\n${draft.prompt}`,
      scheduleMode: duplicate ? draft.scheduleMode : ("manual" as const),
      forcePaused: false,
      locked: false,
    };
  }, [duplicateFromTask, sourceRun, sourceTask.data]);

  function handleSaved(task: TaskDto) {
    router.push(`/tasks?task=${encodeURIComponent(task.id)}`);
  }

  if ((prefillFromTask || duplicateFromTask) && sourceTask.isLoading) {
    return <NewTaskLoading title={title} description={description} />;
  }

  return (
    <TaskWizard
      key={prefillFromTask ?? duplicateFromTask ?? "blank"}
      initialDraft={initialDraft}
      onSaved={handleSaved}
      pageHeader={{ title, description }}
    />
  );
}

export default function NewTaskPage() {
  return (
    <Suspense fallback={<NewTaskLoading />}>
      <NewTaskPageContent />
    </Suspense>
  );
}
