"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode } from "react";
import { ChevronRight, LockKeyhole, LockOpen, PlusCircle } from "lucide-react";
import { toast } from "sonner";

import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { TaskRowActions } from "@/components/task-actions";
import { TaskWizard } from "@/components/task-wizard";
import {
  describeTaskSchedule,
  describeTaskTarget,
  formatAbsoluteDateTime,
  formatReadableEnum,
  formatRunDuration,
} from "@/components/task-run-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUpdateTask } from "@/lib/queries";
import type { RunDto, TaskAuditEvent, TaskDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type TaskDetailProps = {
  task: TaskDto;
  runs: RunDto[];
  auditEvents?: TaskAuditEvent[];
};

function DetailSection({ children }: { children: ReactNode }) {
  return <section className="grid gap-5">{children}</section>;
}

function DefinitionItem({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 border-t pt-3", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm font-medium">{value}</dd>
      {detail ? (
        <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd>
      ) : null}
    </div>
  );
}

function formatAuditJson(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  return JSON.stringify(value, null, 2);
}

function AuditPayloadDetails({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  const formatted = formatAuditJson(value);
  if (!formatted) {
    return null;
  }

  return (
    <details className="border-t pt-3">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {label}
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
        {formatted}
      </pre>
    </details>
  );
}

function AuditEventRow({ event }: { event: TaskAuditEvent }) {
  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{formatReadableEnum(event.action)}</Badge>
            <Badge variant="muted">
              実行者: {formatReadableEnum(event.actorType)}
            </Badge>
            {event.actorId ? (
              <Badge variant="muted">{event.actorId}</Badge>
            ) : null}
          </div>
          {event.reason ? (
            <p className="mt-2 text-sm text-muted-foreground text-pretty">
              {event.reason}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatAbsoluteDateTime(event.createdAt)}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <AuditPayloadDetails label="変更前" value={event.beforeJson} />
        <AuditPayloadDetails label="変更後" value={event.afterJson} />
      </div>
    </div>
  );
}

export function TaskDetail({
  task,
  runs,
  auditEvents: loadedAuditEvents,
}: TaskDetailProps) {
  const router = useRouter();
  const recentRuns = runs
    .filter((run) => run.taskId === task.id)
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? "",
      ),
    );
  const auditEvents = loadedAuditEvents ?? task.auditEvents ?? [];
  const schedule = describeTaskSchedule(task);
  const target = describeTaskTarget(task);
  const updateTask = useUpdateTask();

  function toggleLock() {
    updateTask.mutate(
      { ...task, locked: !task.locked },
      {
        onSuccess: (updated) =>
          toast.success(
            updated.locked
              ? "タスクをロックしました"
              : "タスクのロックを解除しました",
          ),
        onError: (error) =>
          toast.error("ロック状態を更新できませんでした", {
            description:
              error instanceof Error
                ? error.message
                : "スケジューラーコマンドに失敗しました。",
          }),
      },
    );
  }

  return (
    <Tabs defaultValue="history" className="grid min-w-0 gap-4">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="history">実行履歴</TabsTrigger>
        <TabsTrigger value="settings">設定</TabsTrigger>
      </TabsList>

      <TabsContent value="history">
        <DetailSection>
          <div className="grid gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <TaskStatusBadge status={task.status} />
                {task.locked ? (
                  <Badge variant="outline" className="gap-1">
                    <LockKeyhole className="size-3" aria-hidden="true" />
                    ロック中
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                {task.id}
              </p>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <DefinitionItem
                label="スケジュール"
                value={schedule.label}
                detail={schedule.detail}
              />
              <DefinitionItem
                label="次回実行"
                value={
                  <span className="tabular-nums">
                    {formatAbsoluteDateTime(task.nextRunAt)}
                  </span>
                }
              />
              <DefinitionItem
                label="実行先"
                value={target.label}
                detail={
                  <span
                    className="block truncate font-mono"
                    title={target.detail}
                  >
                    {target.detail ?? "アプリ管理ワークスペース"}
                  </span>
                }
              />
            </dl>
          </div>

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
                      {run.resultSummary ??
                        run.statusReason ??
                        run.exitCode ??
                        "—"}
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
        </DetailSection>
      </TabsContent>

      <TabsContent value="settings">
        <DetailSection>
          {task.locked ? (
            <Alert>
              <LockKeyhole aria-hidden="true" />
              <AlertTitle>このタスクはロックされています</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-pretty">
                  設定を変更するには、先にロックを解除してください。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={updateTask.isPending}
                  onClick={toggleLock}
                >
                  <LockOpen data-icon="inline-start" aria-hidden="true" />
                  ロックを解除
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <TaskWizard
            key={`${task.id}:${task.status}:${task.locked}`}
            task={task}
            disabled={task.locked}
            showCancelAction={false}
          />

          <section
            aria-labelledby="task-actions-title"
            className="grid gap-3 border-t pt-5"
          >
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 id="task-actions-title" className="text-sm font-semibold">
                  タスク操作
                </h3>
                <p className="mt-1 text-xs text-muted-foreground text-pretty">
                  手動実行、稼働状態、複製、ロック、削除を管理します。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <TaskRowActions
                  task={task}
                  onDeleted={() => router.push("/tasks?view=archived")}
                />
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={`/tasks/new?duplicateFromTask=${encodeURIComponent(task.id)}`}
                  >
                    <PlusCircle data-icon="inline-start" aria-hidden="true" />
                    複製
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant={task.locked ? "default" : "outline"}
                  size="sm"
                  disabled={updateTask.isPending}
                  onClick={toggleLock}
                >
                  {task.locked ? (
                    <LockOpen data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <LockKeyhole data-icon="inline-start" aria-hidden="true" />
                  )}
                  {task.locked ? "ロックを解除" : "ロック"}
                </Button>
              </div>
            </div>
          </section>

          <details className="group border-t pt-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold marker:hidden">
              <span className="flex items-center gap-2">
                <ChevronRight
                  className="size-4 text-muted-foreground group-open:rotate-90"
                  aria-hidden="true"
                />
                変更履歴
              </span>
              <Badge variant="muted">{auditEvents.length}件</Badge>
            </summary>
            <div className="mt-4 divide-y text-sm">
              {auditEvents.length ? (
                auditEvents.map((event) => (
                  <AuditEventRow key={event.id} event={event} />
                ))
              ) : (
                <p className="text-muted-foreground">
                  現在のデーモンタスク API
                  から監査イベントは返されませんでした。
                </p>
              )}
            </div>
          </details>
        </DetailSection>
      </TabsContent>
    </Tabs>
  );
}
