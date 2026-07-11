"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Suspense, useEffect } from "react";

import { EmptyState } from "@/components/empty-state";
import { RunDetail } from "@/components/run-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { useRun, useTask } from "@/lib/queries";

function RunDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-12">
      <Skeleton className="h-8 w-28" />
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-5 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="border-t pt-6">
        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-4">
          <Skeleton className="size-9" />
          <div className="space-y-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedRunPage({ runId }: { runId: string }) {
  const selectedRun = useRun(runId);
  const task = useTask(selectedRun.data?.taskId);

  if (selectedRun.isLoading || (selectedRun.data && task.isLoading)) {
    return <RunDetailSkeleton />;
  }

  if (selectedRun.isError || !selectedRun.data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="実行を読み込めませんでした"
        description="実行が削除されたか、スケジューラーに接続できない可能性があります。"
        action={{ label: "プロジェクトへ戻る", href: "/projects" }}
      />
    );
  }

  return <RunDetail run={selectedRun.data} task={task.data} />;
}

function RunsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedRunId = searchParams.get("run");

  useEffect(() => {
    if (!selectedRunId) {
      router.replace("/projects");
    }
  }, [router, selectedRunId]);

  return selectedRunId ? <SelectedRunPage runId={selectedRunId} /> : null;
}

export default function RunsPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground">
          実行を読み込んでいます...
        </div>
      }
    >
      <RunsPageContent />
    </Suspense>
  );
}
