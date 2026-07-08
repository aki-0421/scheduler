"use client";

import { type ReactNode } from "react";
import {
  AlertTriangle,
  Clock,
  FileText,
  History,
  KeyRound,
  Target,
  type LucideIcon,
} from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RunDto, TaskAuditEvent, TaskDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type TaskDetailProps = {
  task: TaskDto;
  runs: RunDto[];
  auditEvents?: TaskAuditEvent[];
  onEdit?: (task: TaskDto) => void;
};

function DetailSection({
  title,
  description,
  icon: Icon,
  actions,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-lg border bg-surface/70 p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon ? (
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            ) : null}
            <h2 className="text-base font-semibold text-balance">{title}</h2>
          </div>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
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
    <div className={cn("min-w-0 rounded-md border bg-background p-3", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm font-medium">{value}</dd>
      {detail ? <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}

function PathValue({ value, fallback = "未設定" }: { value?: string; fallback?: string }) {
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

function formatSeconds(value?: number) {
  if (!value) {
    return "未設定";
  }

  if (value < 60) {
    return `${value}秒`;
  }
  if (value < 3_600) {
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return seconds ? `${minutes}分 ${seconds}秒` : `${minutes}分`;
  }

  const hours = Math.floor(value / 3_600);
  const minutes = Math.round((value % 3_600) / 60);
  return minutes ? `${hours}時間 ${minutes}分` : `${hours}時間`;
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
    <details className="rounded-md border bg-muted/30 p-3">
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
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{formatReadableEnum(event.action)}</Badge>
            <Badge variant="muted">実行者: {formatReadableEnum(event.actorType)}</Badge>
            {event.actorId ? <Badge variant="muted">{event.actorId}</Badge> : null}
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
  const recentRuns = runs
    .filter((run) => run.taskId === task.id)
    .slice()
    .sort((left, right) =>
      (right.startedAt ?? right.scheduledFor ?? "").localeCompare(
        left.startedAt ?? left.scheduledFor ?? "",
      ),
    )
    .slice(0, 6);
  const auditEvents = loadedAuditEvents ?? task.auditEvents ?? [];
  const isDangerFullAccess = task.codex.sandboxMode === "danger-full-access";
  const schedule = describeTaskSchedule(task);
  const target = describeTaskTarget(task);
  const capabilities = task.policies.scheduleCliCapabilities ?? [];
  const retryDetail =
    task.policies.maxRetries && task.policies.maxRetries > 0
      ? `${task.policies.maxRetries} 回再試行 · ${formatSeconds(task.policies.retryBackoffSec)} 待機`
      : "自動再試行なし";

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-lg border bg-surface/70 p-4">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-balance">
                {task.name}
              </h2>
              <TaskStatusBadge status={task.status} />
              {isDangerFullAccess ? (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  フルアクセス
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground text-pretty">
              {task.description || "説明なし"}
            </p>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
              {task.id}
            </p>
          </div>
          <TaskRowActions
            task={task}
            className="shrink-0 justify-start lg:justify-end"
            onEdit={(selected) => onEdit?.(selected)}
          />
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
              <span className="block truncate font-mono" title={target.detail}>
                {target.detail ?? "アプリ管理ワークスペース"}
              </span>
            }
          />
        </dl>
      </section>

      <DetailSection
        title="プロンプト"
        description="各実行で Codex に送信される指示です。"
        icon={FileText}
        actions={<CopyButton value={task.prompt.body} toastLabel="プロンプト" />}
      >
        <pre className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-5">
          {task.prompt.body}
        </pre>
      </DetailSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <DetailSection
          title="スケジュールと実行先"
          description="このタスクをいつ、どこで実行するかを示します。"
          icon={Clock}
        >
          <dl className="grid gap-3">
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
            <DefinitionItem
              label="未実行分"
              value={formatReadableEnum(task.policies.missedPolicy)}
              detail={
                task.policies.missedWindowDays
                  ? `${task.policies.missedWindowDays}日間の期間`
                  : undefined
              }
            />
            <DefinitionItem
              label="実行先モード"
              value={target.label}
              detail={target.detail}
            />
            <DefinitionItem
              label="リポジトリ"
              value={<PathValue value={task.target.repoPath} fallback="アプリ管理ワークスペース" />}
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
        </DetailSection>

        <DetailSection
          title="実行と安全性"
          description="Codex モデル、権限、実行時間、スケジューラー制御です。"
          icon={KeyRound}
        >
          <dl className="grid gap-3">
            <DefinitionItem value={task.codex.model ?? "既定モデル"} label="モデル" />
            <DefinitionItem
              label="推論 effort"
              value={formatReadableEnum(task.codex.reasoningEffort)}
            />
            <DefinitionItem
              label="サンドボックス"
              value={
                <Badge variant={isDangerFullAccess ? "warning" : "outline"}>
                  {formatReadableEnum(task.codex.sandboxMode)}
                </Badge>
              }
            />
            <DefinitionItem
              label="承認ポリシー"
              value={formatReadableEnum(task.codex.approvalPolicy)}
            />
            <DefinitionItem
              label="最大実行時間"
              value={formatSeconds(task.policies.maxRuntimeSec)}
            />
            <DefinitionItem label="再試行" value={retryDetail} />
            <DefinitionItem
              label="重複ポリシー"
              value={formatReadableEnum(task.policies.overlapPolicy)}
            />
            <DefinitionItem
              label="スケジュール CLI"
              value={
                <Badge variant={task.policies.allowScheduleCli ? "success" : "muted"}>
                  {task.policies.allowScheduleCli ? "許可" : "ブロック"}
                </Badge>
              }
              detail={
                capabilities.length
                  ? capabilities.map(formatReadableEnum).join(", ")
                  : "追加の schedule 権限なし"
              }
            />
            <DefinitionItem
              label="作成スケジュール上限"
              value={task.policies.maxCreatedSchedulesPerRun ?? "上限なし"}
            />
            <DefinitionItem
              label="クリーンアップ"
              value={formatReadableEnum(task.policies.cleanupPolicy)}
              detail={
                task.policies.cleanupAfterDays
                  ? `${task.policies.cleanupAfterDays}日間保持`
                  : undefined
              }
            />
            <DefinitionItem
              label="スケジューラー指示"
              value={
                task.prompt.injectSchedulerInstructions ? "挿入済み" : "未挿入"
              }
            />
          </dl>
        </DetailSection>
      </div>

      <DetailSection
        title="最近の実行"
        description="このタスクの最近のスケジューラー実行です。"
        icon={Target}
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>状態</TableHead>
                <TableHead>予定時刻</TableHead>
                <TableHead>所要時間</TableHead>
                <TableHead>終了コード</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentRuns.length ? (
                recentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatAbsoluteDateTime(run.scheduledFor)}
                    </TableCell>
                    <TableCell>{formatRunDuration(run)}</TableCell>
                    <TableCell>{run.exitCode ?? "—"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    実行履歴はまだありません。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </DetailSection>

      <DetailSection title="監査ログ" icon={History}>
        <div className="grid gap-3 text-sm">
          {auditEvents.length ? (
            auditEvents.map((event) => <AuditEventRow key={event.id} event={event} />)
          ) : (
            <p className="text-muted-foreground">
              現在のデーモンタスク API から監査イベントは返されませんでした。
            </p>
          )}
        </div>
      </DetailSection>
    </div>
  );
}
