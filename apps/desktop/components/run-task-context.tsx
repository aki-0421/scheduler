"use client";

import { FileText, PanelRight } from "lucide-react";
import type { ReactNode } from "react";

import { TaskStatusBadge } from "@/components/status-badge";
import {
  CopyButton,
  describeTaskSchedule,
  describeTaskTarget,
  formatAbsoluteDateTime,
} from "@/components/task-run-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  codexModelOptions,
  reasoningEffortOptions,
} from "@/lib/codex-options";
import type { TaskDto } from "@/lib/types";

type TaskContextProps = {
  task?: TaskDto;
};

function TaskInfoItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-pretty">
        {value}
        {detail ? (
          <span className="mt-1 block text-xs font-normal text-muted-foreground text-pretty">
            {detail}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function TaskInfoSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`task-info-${title}`}>
      <h3 id={`task-info-${title}`} className="text-sm font-semibold text-balance">
        {title}
      </h3>
      <dl className="grid gap-4">{children}</dl>
    </section>
  );
}

function modelLabel(value?: string) {
  if (!value) {
    return "既定モデル";
  }
  return codexModelOptions.find((option) => option.value === value)?.label ?? value;
}

function reasoningEffortLabel(value?: string) {
  if (!value) {
    return "モデル既定";
  }
  return (
    reasoningEffortOptions.find((option) => option.value === value)?.label ??
    value
  );
}

export function TaskInfoSheet({ task }: TaskContextProps) {
  const schedule = task ? describeTaskSchedule(task) : undefined;
  const target = task ? describeTaskTarget(task) : undefined;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={!task}>
          <PanelRight data-icon="inline-start" aria-hidden="true" />
          タスク情報
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="overflow-hidden">
        <SheetHeader className="shrink-0 pr-8">
          <SheetTitle>タスク情報</SheetTitle>
          <SheetDescription>
            この実行に紐づくタスクの現在の設定です。
          </SheetDescription>
        </SheetHeader>

        {task ? (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
            <div className="flex flex-col gap-3">
              <TaskInfoItem label="タスク名" value={task.name} />
              <div className="flex flex-wrap gap-2">
                <TaskStatusBadge status={task.status} />
                <Badge variant={task.locked ? "outline" : "muted"}>
                  {task.locked ? "ロック中" : "ロックなし"}
                </Badge>
              </div>
            </div>

            <Separator />

            <TaskInfoSection title="スケジュール">
              <TaskInfoItem
                label="実行タイミング"
                value={schedule?.label ?? "未設定"}
                detail={schedule?.detail}
              />
              <TaskInfoItem
                label="次回実行"
                value={formatAbsoluteDateTime(task.nextRunAt)}
              />
              <TaskInfoItem label="タイムゾーン" value={task.timezone} />
            </TaskInfoSection>

            <Separator />

            <TaskInfoSection title="モデル">
              <TaskInfoItem
                label="モデル"
                value={modelLabel(task.codex.model)}
              />
              <TaskInfoItem
                label="思考レベル"
                value={reasoningEffortLabel(task.codex.reasoningEffort)}
              />
            </TaskInfoSection>

            <Separator />

            <TaskInfoSection title="実行先">
              <TaskInfoItem
                label="種類"
                value={target?.label ?? "未設定"}
                detail={
                  <span className="break-all font-mono">{target?.detail}</span>
                }
              />
              {task.target.baseRef ? (
                <TaskInfoItem
                  label="ベースブランチ"
                  value={<span className="font-mono">{task.target.baseRef}</span>}
                />
              ) : null}
            </TaskInfoSection>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function TaskPromptDialog({ task }: TaskContextProps) {
  const prompt = task?.prompt.body.trim() ?? "";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={!task}>
          <FileText data-icon="inline-start" aria-hidden="true" />
          タスクプロンプト
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(80dvh,48rem)] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>タスクプロンプト</DialogTitle>
          <DialogDescription>
            現在のタスク設定に保存されているプロンプトです。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto rounded-md bg-muted p-4">
          {prompt ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-foreground">
              {prompt}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground text-pretty">
              このタスクにはプロンプトが保存されていません。
            </p>
          )}
        </div>

        <DialogFooter>
          <CopyButton
            value={prompt}
            label="プロンプトをコピー"
            toastLabel="タスクプロンプト"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
