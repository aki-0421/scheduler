"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode } from "react";
import {
  LockKeyhole,
  LockOpen,
  PlusCircle,
} from "lucide-react";
import { toast } from "sonner";

import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { TaskRowActions } from "@/components/task-actions";
import {
  CopyButton,
  describeTaskSchedule,
  describeTaskTarget,
  formatAbsoluteDateTime,
  formatReadableEnum,
  formatRunDuration,
} from "@/components/task-run-display";
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
  onEdit?: (task: TaskDto) => void;
};

function DetailSection({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      {actions ? (
        <div className="flex flex-wrap justify-end gap-2">{actions}</div>
      ) : null}
      {children}
    </section>
  );
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

function PathValue({
  value,
  fallback = "未設定",
}: {
  value?: string;
  fallback?: string;
}) {
  if (!value) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-mono text-xs" title={value}>
        {value}
      </span>
      <CopyButton
        value={value}
        label="コピー"
        toastLabel="パス"
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 px-2 text-xs"
      />
    </span>
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
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs">
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
  onEdit,
}: TaskDetailProps) {
  const router = useRouter();
  const recentRuns = runs
    .filter((run) => run.taskId === task.id)
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? "",
      ),
    )
    .slice();
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
    <Tabs defaultValue="overview" className="grid min-w-0 gap-4">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="overview">概要</TabsTrigger>
        <TabsTrigger value="history">実行履歴</TabsTrigger>
        <TabsTrigger value="prompt">プロンプト</TabsTrigger>
        <TabsTrigger value="settings">設定</TabsTrigger>
        <TabsTrigger value="audit">監査ログ</TabsTrigger>
        <TabsTrigger value="actions">操作</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
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
        </DetailSection>
      </TabsContent>

      <TabsContent value="history">
        <DetailSection>
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

      <TabsContent value="prompt">
        <DetailSection
          actions={
            <CopyButton value={task.prompt.body} toastLabel="プロンプト" />
          }
        >
          <pre className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-5">
            {task.prompt.body}
          </pre>
        </DetailSection>
      </TabsContent>

      <TabsContent value="settings">
        <DetailSection>
          <div className="grid gap-5">
            <div className="grid gap-3">
              <h3 className="text-sm font-semibold">スケジュール</h3>
              <dl className="grid gap-3 md:grid-cols-3">
                <DefinitionItem
                  label="スケジュール"
                  value={schedule.label}
                  detail={schedule.detail}
                />
                <DefinitionItem label="タイムゾーン" value={task.timezone} />
                <DefinitionItem
                  label="次回実行"
                  value={
                    <span className="tabular-nums">
                      {formatAbsoluteDateTime(task.nextRunAt)}
                    </span>
                  }
                />
              </dl>
            </div>

            <div className="grid gap-3">
              <h3 className="text-sm font-semibold">実行先</h3>
              <dl className="grid gap-3 md:grid-cols-3">
                <DefinitionItem
                  label="実行先モード"
                  value={target.label}
                  detail={target.detail}
                />
                <DefinitionItem
                  label="リポジトリ"
                  value={
                    <PathValue
                      value={task.target.repoPath}
                      fallback="アプリ管理ワークスペース"
                    />
                  }
                  className="md:col-span-2"
                />
                <DefinitionItem
                  label="ベース参照"
                  value={
                    <span className="font-mono text-xs">
                      {task.target.baseRef ?? "既定"}
                    </span>
                  }
                />
              </dl>
            </div>

            <div className="grid gap-3">
              <h3 className="text-sm font-semibold">Codex</h3>
              <dl className="grid gap-3 md:grid-cols-2">
                <DefinitionItem
                  value={task.codex.model ?? "既定モデル"}
                  label="モデル"
                />
                <DefinitionItem
                  label="思考レベル"
                  value={formatReadableEnum(task.codex.reasoningEffort)}
                />
              </dl>
            </div>
          </div>
        </DetailSection>
      </TabsContent>

      <TabsContent value="audit">
        <DetailSection>
          <div className="divide-y text-sm">
            {auditEvents.length ? (
              auditEvents.map((event) => (
                <AuditEventRow key={event.id} event={event} />
              ))
            ) : (
              <p className="text-muted-foreground">
                現在のデーモンタスク API から監査イベントは返されませんでした。
              </p>
            )}
          </div>
        </DetailSection>
      </TabsContent>

      <TabsContent value="actions">
        <DetailSection>
          <div className="grid max-w-sm gap-3">
            <TaskRowActions
              task={task}
              className="grid justify-stretch [&>button]:w-full"
              onEdit={(selected) => onEdit?.(selected)}
              onDeleted={() => router.push("/tasks?view=archived")}
            />
            <Button variant="outline" asChild>
              <Link
                href={`/tasks/new?duplicateFromTask=${encodeURIComponent(task.id)}`}
              >
                <PlusCircle className="size-4" aria-hidden="true" />
                複製
              </Link>
            </Button>
            <Button
              type="button"
              variant={task.locked ? "default" : "outline"}
              disabled={updateTask.isPending}
              onClick={toggleLock}
            >
              {task.locked ? (
                <LockOpen className="size-4" aria-hidden="true" />
              ) : (
                <LockKeyhole className="size-4" aria-hidden="true" />
              )}
              {task.locked ? "ロックを解除" : "ロック"}
            </Button>
          </div>
        </DetailSection>
      </TabsContent>
    </Tabs>
  );
}
