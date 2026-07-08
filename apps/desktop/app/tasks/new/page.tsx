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
        title="新規タスク"
        description="プロンプトとタスク名を基本タブにまとめ、通常変更しない実行設定は詳細タブで調整します。"
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
      description: duplicate
        ? draft.description
        : sourceRun
          ? `実行 ${sourceRun} のフォローアップ`
          : draft.description,
      scheduleMode: duplicate ? draft.scheduleMode : ("manual" as const),
      forcePaused: false,
      locked: false,
    };
  }, [duplicateFromTask, sourceRun, sourceTask.data]);

  function handleSaved(task: TaskDto) {
    router.push(`/tasks?task=${encodeURIComponent(task.id)}`);
  }

  if ((prefillFromTask || duplicateFromTask) && sourceTask.isLoading) {
    return <NewTaskLoading />;
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title={
          duplicateFromTask
            ? "タスクを複製"
            : prefillFromTask
              ? "フォローアップタスク"
              : "新規タスク"
        }
        description={
          duplicateFromTask
            ? "既存タスクの設定をもとに、新しいタスクを作成します。"
            : prefillFromTask
              ? "選択した実行やタスクの文脈を引き継いで、次の作業用タスクを作成します。"
              : "プロンプトとタスク名を基本タブにまとめ、通常変更しない実行設定は詳細タブで調整します。"
        }
      />
      <TaskWizard
        key={prefillFromTask ?? duplicateFromTask ?? "blank"}
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
