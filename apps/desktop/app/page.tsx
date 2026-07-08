"use client";

import Link from "next/link";
import {
  Activity,
  AlertCircle,
  CalendarClock,
  Clock,
  ListTodo,
  PauseCircle,
  Play,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatDateTime,
  formatDuration,
  formatTargetMode,
  formatTaskSchedule,
  isRunActive,
} from "@/lib/format";
import {
  useDaemonDiagnostics,
  useDaemonTickNow,
  useHealth,
  useRuns,
  useSetSetting,
  useSettings,
  useTasks,
} from "@/lib/queries";

type SummaryChipProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: BadgeProps["variant"];
};

function SummaryChip({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: SummaryChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={tone}>{value}</Badge>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
      <div>
        <h2 className="text-base font-semibold text-balance">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">{description}</p>
      </div>
      {action ? <div className="flex shrink-0">{action}</div> : null}
    </div>
  );
}

export default function DashboardPage() {
  const tasks = useTasks();
  const runs = useRuns();
  const health = useHealth();
  const diagnostics = useDaemonDiagnostics();
  const tickNow = useDaemonTickNow();
  const settings = useSettings();
  const setSetting = useSetSetting();
  const taskList = tasks.data ?? [];
  const runList = runs.data ?? [];
  const tasksById = new Map(taskList.map((task) => [task.id, task]));
  const nextRuns = taskList
    .filter((task) => task.status === "active" && task.nextRunAt)
    .sort((left, right) => (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? ""))
    .slice(0, 10);
  const recentRuns = runList
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? "",
      ),
    )
    .slice(0, 8);
  const runningCount = runList.filter((run) => isRunActive(run.status)).length;
  const failedSince = Date.now() - 24 * 60 * 60 * 1000;
  const failedLastDay = runList.filter(
    (run) =>
      (run.status === "failed" || run.status === "timed_out") &&
      new Date(run.endedAt ?? run.startedAt ?? run.scheduledFor ?? 0).valueOf() >=
        failedSince,
  ).length;
  const requiringReview = runList.filter(
    (run) =>
      run.status === "failed" ||
      run.status === "timed_out" ||
      (run.findingsCount ?? 0) > 0 ||
      (run.createdScheduleCount ?? 0) > 0,
  ).length;
  const schedulerEnabled =
    health.data?.schedulerEnabled ?? settings.data["scheduler.enabled"];
  const nextRun = nextRuns[0];
  const heroDescription = nextRun
    ? `次の実行は ${nextRun.name} で、${formatDateTime(nextRun.nextRunAt)} に予定されています。`
    : taskList.length
      ? "次回実行がある有効なタスクはありません。タスクを再開するかスケジュールを設定してください。"
      : "最初の Codex スケジュールタスクを作成するとキューが動き始めます。";
  const codexStatus = diagnostics.data
    ? diagnostics.data.codexPath.exists
      ? "準備完了"
      : "未検出"
    : health.data?.ok
      ? "未確認"
      : "利用不可";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="今日"
        description={heroDescription}
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip
          icon={Activity}
          label="スケジューラー"
          value={schedulerEnabled ? "オン" : "一時停止"}
          tone={schedulerEnabled ? "success" : "muted"}
        />
        <SummaryChip
          icon={Play}
          label="現在実行中"
          value={runningCount.toLocaleString("ja-JP")}
          tone={runningCount ? "info" : "muted"}
        />
        <SummaryChip
          icon={AlertCircle}
          label="今日の失敗"
          value={failedLastDay.toLocaleString("ja-JP")}
          tone={failedLastDay ? "destructive" : "muted"}
        />
        <SummaryChip
          icon={ListTodo}
          label="確認が必要"
          value={requiringReview.toLocaleString("ja-JP")}
          tone={requiringReview ? "warning" : "muted"}
        />
        <SummaryChip
          icon={Stethoscope}
          label="Codex CLI"
          value={codexStatus}
          tone={
            diagnostics.data
              ? diagnostics.data.codexPath.exists
                ? "success"
                : "warning"
              : "muted"
          }
        />
      </div>

      <section className="grid gap-3">
        <SectionHeader
          title="今後の実行"
          description="次回実行時刻の近い順に並べた Codex タスクです。"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/tasks">タスクを見る</Link>
            </Button>
          }
        />
        {nextRuns.length ? (
          <div className="overflow-hidden rounded-lg border bg-surface/70">
            {nextRuns.map((task) => (
              <Link
                key={task.id}
                href={`/tasks?task=${task.id}`}
                className="grid gap-3 border-b p-4 transition-colors duration-150 hover:bg-muted/50 last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(9rem,0.8fr)_minmax(10rem,0.8fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{task.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTargetMode(task.target.mode)}
                  </p>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">スケジュール</span>
                  <span className="truncate text-sm">{formatTaskSchedule(task)}</span>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">次回実行</span>
                  <span className="text-sm tabular-nums">
                    {formatDateTime(task.nextRunAt)}
                  </span>
                </div>
                <div className="md:justify-self-end">
                  <TaskStatusBadge status={task.status} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Clock}
            title={taskList.length ? "今後の実行はありません" : "タスクがまだありません"}
            description={
              taskList.length
                ? "スケジュール済みまたは再開済みのタスクに次回実行時刻があると、ここに表示されます。"
                : "スケジュール付きの Codex タスクを作成すると、次に実行される内容を確認できます。"
            }
            action={{
              label: taskList.length ? "タスクを開く" : "最初のタスクを作成",
              href: taskList.length ? "/tasks" : "/tasks/new",
            }}
          />
        )}
      </section>

      <section className="grid gap-3">
        <SectionHeader
          title="最近のアクティビティ"
          description="すべてのタスクの最新実行結果です。"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/runs">実行履歴を見る</Link>
            </Button>
          }
        />
        {recentRuns.length ? (
          <div className="overflow-hidden rounded-lg border bg-surface/70">
            {recentRuns.map((run) => {
              const task = tasksById.get(run.taskId);
              const summary =
                run.resultSummary ??
                run.statusReason ??
                (isRunActive(run.status) ? "実行中です。" : run.id);

              return (
                <Link
                  key={run.id}
                  href={`/runs?run=${run.id}`}
                  className="grid gap-3 border-b p-4 transition-colors duration-150 hover:bg-muted/50 last:border-b-0 lg:grid-cols-[9rem_minmax(0,1fr)_minmax(10rem,0.45fr)_minmax(7rem,0.3fr)] lg:items-center"
                >
                  <div>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {task?.name ?? "不明なタスク"}
                    </p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {summary}
                    </p>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">開始</span>
                    <span className="text-sm tabular-nums">
                      {formatDateTime(run.startedAt ?? run.scheduledFor)}
                    </span>
                  </div>
                  <div className="grid gap-1 lg:text-right">
                    <span className="text-xs text-muted-foreground">所要時間</span>
                    <span className="text-sm tabular-nums">{formatDuration(run)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Activity}
            title="実行履歴はまだありません"
            description="タスクがキューに入るか手動で開始されると、ここに表示されます。"
            action={{ label: "タスクを開く", href: "/tasks" }}
          />
        )}
      </section>

      <section className="grid gap-3 border-t pt-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <h2 className="text-sm font-medium">スケジューラー操作</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            メンテナンス操作はここに集約し、ダッシュボードでは次回実行と最近の動きを見やすくします。
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            デーモン {health.data?.version ?? "未確認"} · Codex パス{" "}
            <span className="font-mono">{settings.data["runner.codex_path"]}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={tickNow.isPending}
            onClick={() =>
              tickNow.mutate(undefined, {
                onSuccess: (result) =>
                  toast.success(
                    result.triggered
                      ? "期限到来チェックを開始しました"
                      : "デーモンが tick 要求を受け付けました",
                  ),
                onError: (error) =>
                  toast.error("期限到来チェックを開始できませんでした", {
                    description:
                      error instanceof Error
                        ? error.message
                        : "デーモンコマンドに失敗しました。",
                  }),
              })
            }
          >
            <CalendarClock className="size-4" aria-hidden="true" />
            期限到来を確認
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={setSetting.isPending}
            onClick={() =>
              setSetting.mutate(
                { key: "scheduler.enabled", value: false },
                {
                  onSuccess: () => toast.success("スケジュールを一時停止しました"),
                  onError: (error) =>
                    toast.error("スケジュールを一時停止できませんでした", {
                      description:
                        error instanceof Error
                          ? error.message
                          : "設定コマンドに失敗しました。",
                    }),
                },
              )
            }
          >
            <PauseCircle className="size-4" aria-hidden="true" />
            スケジュールを一時停止
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/runs">診断を開く</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
