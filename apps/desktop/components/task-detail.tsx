"use client";

import Link from "next/link";

import { RunStatusBadge } from "@/components/status-badge";
import { TaskWizard } from "@/components/task-wizard";
import {
  formatAbsoluteDateTime,
  formatRunDuration,
} from "@/components/task-run-display";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RunDto, TaskDto } from "@/lib/types";

type TaskDetailProps = {
  task: TaskDto;
  runs: RunDto[];
};

export function TaskDetail({ task, runs }: TaskDetailProps) {
  const recentRuns = runs
    .filter((run) => run.taskId === task.id)
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? "",
      ),
    );

  return (
    <Tabs defaultValue="history" className="grid min-w-0 gap-4">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="history">実行履歴</TabsTrigger>
        <TabsTrigger value="settings">設定</TabsTrigger>
      </TabsList>

      <TabsContent value="history">
        <div className="border-y">
          <div className="hidden grid-cols-[8rem_12rem_8rem_minmax(0,1fr)] gap-3 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span>状態</span>
            <span>予定時刻</span>
            <span>所要時間</span>
            <span>結果</span>
          </div>
          {recentRuns.length ? (
            <div className="divide-y">
              {recentRuns.map((run) => (
                <Link
                  key={run.id}
                  href={`/runs?run=${encodeURIComponent(run.id)}`}
                  className="grid gap-3 p-3 text-sm transition-colors duration-150 hover:bg-muted/50 md:grid-cols-[8rem_12rem_8rem_minmax(0,1fr)] md:items-center"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground md:hidden">
                      状態
                    </span>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <div className="flex min-w-0 items-center gap-2 tabular-nums">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground md:hidden">
                      予定
                    </span>
                    <span className="truncate">
                      {formatAbsoluteDateTime(run.scheduledFor)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground md:hidden">
                      時間
                    </span>
                    <span>{formatRunDuration(run)}</span>
                  </div>
                  <p className="min-w-0 truncate text-muted-foreground">
                    {run.resultSummary ?? run.statusReason ?? run.exitCode ?? "—"}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-3 text-sm text-muted-foreground">
              実行履歴はまだありません。
            </p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="settings">
        <TaskWizard
          key={`${task.id}:${task.status}:${task.locked}`}
          task={task}
          showCancelAction={false}
        />
      </TabsContent>
    </Tabs>
  );
}
