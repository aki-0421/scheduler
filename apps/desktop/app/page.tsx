"use client";

import Link from "next/link";
import {
  Activity,
  AlertCircle,
  Clock,
  ListTodo,
  PauseCircle,
  Play,
  Plus,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RunStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatDuration, formatTaskSchedule, isRunActive } from "@/lib/format";
import {
  useDaemonDiagnostics,
  useDaemonTickNow,
  useHealth,
  useRuns,
  useSetSetting,
  useSettings,
  useTasks,
} from "@/lib/queries";

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

  return (
    <div className="grid gap-5">
      <PageHeader
        title="ダッシュボード"
        description="スケジューラーの状態、今後の実行予定、最近の Codex 実行を確認します。"
        actions={
          <>
            <Button
              variant="outline"
              disabled={tickNow.isPending}
              onClick={() =>
                tickNow.mutate(undefined, {
                  onSuccess: (result) =>
                    toast.success(
                      result.triggered
                        ? "期限チェックを開始しました"
                        : "デーモンが tick 要求を受け付けました",
                    ),
                  onError: (error) =>
                    toast.error("期限チェックを開始できませんでした", {
                      description:
                        error instanceof Error
                          ? error.message
                          : "デーモンコマンドに失敗しました。",
                    }),
                })
              }
            >
              <Clock className="size-4" aria-hidden="true" />
              期限チェック
            </Button>
            <Button
              variant="outline"
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
              全体停止
            </Button>
            <Button asChild>
              <Link href="/tasks/new">
                <Plus className="size-4" aria-hidden="true" />
                新規タスク
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/runs">診断</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              スケジューラー状態
              <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={health.data?.schedulerEnabled ? "success" : "muted"}>
              {health.data?.schedulerEnabled ? "稼働中" : "一時停止"}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground">
              デーモン {health.data?.version ?? "確認中"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              実行中
              <Play className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{runningCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">待機中または実行中の run</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              直近 24 時間の失敗
              <AlertCircle className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{failedLastDay}</p>
            <p className="mt-1 text-xs text-muted-foreground">failed または timed_out</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              要確認
              <ListTodo className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{requiringReview}</p>
            <p className="mt-1 text-xs text-muted-foreground">triage 条件に一致</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              Codex CLI 状態
              <Stethoscope className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge
              variant={
                diagnostics.data
                  ? diagnostics.data.codexPath.exists
                    ? "success"
                    : "warning"
                  : health.data?.ok
                    ? "outline"
                    : "destructive"
              }
            >
              {settings.data["runner.codex_path"]}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground">
              {diagnostics.data
                ? diagnostics.data.codexPath.exists
                  ? "codex path は存在します"
                  : "codex path が見つかりません"
                : health.data?.ok
                  ? "デーモンは正常です。診断情報は未取得です"
                  : "デーモン状態を取得できません"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" aria-hidden="true" />
              次の 10 件
            </CardTitle>
            <CardDescription>active なタスクを next_run_at 順に表示します。</CardDescription>
          </CardHeader>
          <CardContent>
            {nextRuns.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>タスク</TableHead>
                    <TableHead>スケジュール</TableHead>
                    <TableHead>次回実行</TableHead>
                    <TableHead>状態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nextRuns.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">
                        <Link className="hover:underline" href={`/tasks?task=${task.id}`}>
                          {task.name}
                        </Link>
                      </TableCell>
                      <TableCell>{formatTaskSchedule(task)}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateTime(task.nextRunAt)}
                      </TableCell>
                      <TableCell>
                        <TaskStatusBadge status={task.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Clock}
                title="実行予定はありません"
                description="スケジュール済みタスクを作成または再開すると、このキューに表示されます。"
                action={{ label: "新規タスク", href: "/tasks/new" }}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最近の run</CardTitle>
            <CardDescription>全タスクの最新実行結果です。</CardDescription>
          </CardHeader>
          <CardContent>
            {recentRuns.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>状態</TableHead>
                    <TableHead>実行</TableHead>
                    <TableHead>開始</TableHead>
                    <TableHead>所要時間</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <RunStatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link className="hover:underline" href={`/runs?run=${run.id}`}>
                          {run.id}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateTime(run.startedAt ?? run.scheduledFor)}
                      </TableCell>
                      <TableCell>{formatDuration(run)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Activity}
                title="run はまだありません"
                description="タスクがキューに入るか手動実行されると、ここに表示されます。"
                action={{ label: "タスクを開く", href: "/tasks" }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
