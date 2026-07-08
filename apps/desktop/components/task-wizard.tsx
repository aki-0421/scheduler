"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  FileText,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getCronPreview } from "@/lib/cron";
import { formatDateTime } from "@/lib/format";
import { ipcClient } from "@/lib/ipc";
import {
  buildTaskDto,
  defaultTaskDraft,
  getDraftCronExpression,
  taskToDraft,
  validateTaskDraftStep,
  type PresetMode,
  type StepErrors,
  type TaskDraft,
} from "@/lib/task-draft";
import { localDateTimeToUtcIso } from "@/lib/timezone";
import type { TaskDto } from "@/lib/types";
import {
  useCreateTask,
  useProjects,
  useTrustProject,
  useUpdateTask,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type TaskWizardProps = {
  task?: TaskDto;
  initialDraft?: TaskDraft;
  cancelHref?: string;
  onCancel?: () => void;
  onSaved?: (task: TaskDto) => void;
};

type ScheduleChoice = "manual" | "once" | PresetMode | "cron";

const capabilityOptions = [
  { value: "schedule:create", label: "スケジュールを作成" },
  { value: "schedule:update-current", label: "このタスクを更新" },
  { value: "schedule:update-any", label: "任意のタスクを更新" },
  { value: "schedule:list", label: "スケジュールを一覧表示" },
];

const timezoneOptions = [
  "Asia/Tokyo",
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
].map((value) => ({ value, label: value }));

const scheduleOptions: SelectOption<ScheduleChoice>[] = [
  { value: "manual", label: "手動のみ" },
  { value: "once", label: "一度だけ..." },
  { value: "hourly", label: "毎時" },
  { value: "daily", label: "毎日" },
  { value: "weekdays", label: "平日" },
  { value: "weekly", label: "毎週" },
  { value: "cron", label: "カスタム (cron)" },
];

const weekdayOptions = [
  { value: "0", label: "日曜日" },
  { value: "1", label: "月曜日" },
  { value: "2", label: "火曜日" },
  { value: "3", label: "水曜日" },
  { value: "4", label: "木曜日" },
  { value: "5", label: "金曜日" },
  { value: "6", label: "土曜日" },
];

const weekdayByValue = Object.fromEntries(
  weekdayOptions.map((option) => [option.value, option.label]),
);

const targetModeOptions = [
  { value: "chat", label: "チャットワークスペース" },
  { value: "repo-local", label: "既存リポジトリ" },
  { value: "repo-worktree", label: "新規ワークツリー" },
] satisfies SelectOption<TaskDraft["targetMode"]>[];

const sandboxModeOptions = [
  { value: "read-only", label: "読み取り専用" },
  { value: "workspace-write", label: "ワークスペース書き込み" },
  { value: "danger-full-access", label: "ファイルシステムのフルアクセス" },
] satisfies SelectOption<TaskDraft["sandboxMode"]>[];

const approvalPolicyOptions = [
  { value: "never", label: "確認しない" },
  { value: "on-request", label: "必要時に確認" },
  { value: "untrusted", label: "信頼されていない操作で確認" },
] satisfies SelectOption<TaskDraft["approvalPolicy"]>[];

const overlapPolicyOptions = [
  { value: "skip", label: "実行中はスキップ" },
  { value: "queue", label: "次の実行をキューに追加" },
  { value: "cancel_previous", label: "前回の実行をキャンセル" },
] satisfies SelectOption<TaskDraft["overlapPolicy"]>[];

const missedPolicyOptions = [
  { value: "skip", label: "未実行分をスキップ" },
  { value: "latest_within_window", label: "期間内の最新のみ実行" },
  { value: "run_all_capped", label: "上限付きで未実行分を実行" },
] satisfies SelectOption<TaskDraft["missedPolicy"]>[];

const cleanupPolicyOptions = [
  { value: "keep", label: "成果物を保持" },
  { value: "delete_on_success", label: "成功時に削除" },
  { value: "delete_after_days", label: "保持期間後に削除" },
] satisfies SelectOption<TaskDraft["cleanupPolicy"]>[];

const japaneseErrorMessages: Record<string, string> = {
  name: "タスク名は必須です。",
  prompt: "プロンプトは必須です。",
  repoPath: "リポジトリ実行先にはプロジェクトを選択してください。",
  onceDate: "有効な日付と時刻を選択してください。",
  onceTime: "有効な日付と時刻を選択してください。",
  timezone: "タイムゾーンは必須です。",
  model: "モデルは必須です。",
  reasoningEffort: "推論 effort は必須です。",
  maxRuntimeSec: "60秒以上を指定してください。",
  maxRetries: "再試行回数は 0 以上にしてください。",
  maxCreatedSchedulesPerRun: "1 から 100 までの値を指定してください。",
  dangerConfirmed: "ファイルシステムのフルアクセスのリスクを確認してください。",
};

const advancedErrorKeys = new Set([
  "model",
  "reasoningEffort",
  "sandboxMode",
  "approvalPolicy",
  "maxRuntimeSec",
  "maxRetries",
  "missedPolicy",
  "overlapPolicy",
  "cleanupPolicy",
  "maxCreatedSchedulesPerRun",
  "dangerConfirmed",
]);

const errorFieldOrder = [
  "prompt",
  "name",
  "repoPath",
  "onceDate",
  "onceTime",
  "cronPreview",
  "timezone",
  "model",
  "reasoningEffort",
  "maxRuntimeSec",
  "maxRetries",
  "dangerConfirmed",
  "maxCreatedSchedulesPerRun",
];

const errorLabelByKey: Record<string, string> = {
  prompt: "プロンプト",
  name: "タスク名",
  repoPath: "プロジェクト",
  onceDate: "日付",
  onceTime: "時刻",
  cronPreview: "カスタム cron 式",
  timezone: "タイムゾーン",
  model: "モデル",
  reasoningEffort: "推論 effort",
  maxRuntimeSec: "最大実行時間",
  maxRetries: "再試行",
  dangerConfirmed: "ファイルシステムのフルアクセス",
  maxCreatedSchedulesPerRun: "1実行あたりの作成スケジュール上限",
};

const errorTargetIds: Record<string, string[]> = {
  prompt: ["task-prompt"],
  name: ["task-name"],
  repoPath: ["repo-path"],
  onceDate: ["once-date"],
  onceTime: ["once-time"],
  cronPreview: ["cron-expression"],
  timezone: ["timezone"],
  model: ["model"],
  reasoningEffort: ["reasoning"],
  maxRuntimeSec: ["max-runtime"],
  maxRetries: ["retries"],
  dangerConfirmed: ["danger-confirmed"],
  maxCreatedSchedulesPerRun: ["max-created-schedules"],
};

function formatCronError(message?: string) {
  if (!message) {
    return undefined;
  }

  if (message.includes("Seconds are not supported") || message.includes("秒フィールド")) {
    return "秒フィールドはサポートしていません。5フィールドの cron 式を使ってください。";
  }

  if (message.includes("5-field") || message.includes("5フィールド")) {
    return "5フィールドの cron 式を入力してください。";
  }

  if (message.includes("Invalid cron expression") || message.includes("cron 式が無効")) {
    return "有効な cron 式を入力してください。";
  }

  return message;
}

function normalizeErrors(stepErrors: StepErrors): Record<string, string> {
  return Object.entries(stepErrors).reduce<Record<string, string>>(
    (normalized, [key, message]) => {
      normalized[key] =
        key === "cronPreview"
          ? (formatCronError(message) ?? "有効な cron 式を入力してください。")
          : japaneseErrorMessages[key] ?? message ?? "この項目を確認してください。";
      return normalized;
    },
    {},
  );
}

function getOrderedErrorEntries(errors: Record<string, string>) {
  const orderedKeys = [
    ...errorFieldOrder.filter((key) => errors[key]),
    ...Object.keys(errors).filter((key) => !errorFieldOrder.includes(key)),
  ];

  return orderedKeys.map((key) => ({
    key,
    label: errorLabelByKey[key] ?? "項目",
    message: errors[key],
  }));
}

function getScheduleChoice(draft: TaskDraft): ScheduleChoice {
  if (draft.scheduleMode === "preset") {
    return draft.presetMode;
  }

  return draft.scheduleMode;
}

function getOncePreview(draft: TaskDraft) {
  try {
    return formatDateTime(
      localDateTimeToUtcIso(draft.onceDate, draft.onceTime, draft.timezone),
    );
  } catch {
    return `${draft.onceDate} ${draft.onceTime} ${draft.timezone}`.trim();
  }
}

function getScheduleSummary(draft: TaskDraft) {
  const choice = getScheduleChoice(draft);

  if (choice === "manual") {
    return "手動のみ";
  }

  if (choice === "once") {
    return `${getOncePreview(draft)} に一度だけ`;
  }

  if (choice === "hourly") {
    return "毎時";
  }

  if (choice === "daily") {
    return `毎日 ${draft.presetTime}`;
  }

  if (choice === "weekdays") {
    return `平日 ${draft.presetTime}`;
  }

  if (choice === "weekly") {
    return `毎週${weekdayByValue[draft.weeklyDay] ?? "月曜日"} ${draft.presetTime}`;
  }

  return draft.cronExpr ? `カスタム cron: ${draft.cronExpr}` : "カスタム cron";
}

function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  description,
  error,
  className,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  description?: string;
  error?: string;
  className?: string;
}) {
  return (
    <Field
      label={label}
      htmlFor={id}
      description={description}
      error={error}
      className={className}
    >
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function CheckboxRow({
  id,
  checked,
  label,
  description,
  error,
  onChange,
}: {
  id?: string;
  checked: boolean;
  label: string;
  description?: string;
  error?: string;
  onChange: (checked: boolean) => void;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex gap-3 rounded-md border p-3 text-sm",
        error ? "border-destructive" : undefined,
      )}
    >
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={checked}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="grid gap-1">
        <span className="font-medium">{label}</span>
        {description ? (
          <span id={descriptionId} className="text-xs text-muted-foreground text-pretty">
            {description}
          </span>
        ) : null}
        {error ? (
          <span id={errorId} className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function SwitchRow({
  id,
  checked,
  label,
  description,
  onChange,
}: {
  id: string;
  checked: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  const descriptionId = `${id}-description`;

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div className="grid gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p id={descriptionId} className="text-xs text-muted-foreground text-pretty">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        aria-describedby={descriptionId}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-4 rounded-lg border p-4", className)}>
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold text-balance">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function TaskWizard({
  task,
  initialDraft,
  cancelHref = "/tasks",
  onCancel,
  onSaved,
}: TaskWizardProps) {
  const [draft, setDraft] = useState<TaskDraft>(
    () => initialDraft ?? (task ? taskToDraft(task) : defaultTaskDraft()),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isImportingPrompt, setIsImportingPrompt] = useState(false);
  const [isPickingRepo, setIsPickingRepo] = useState(false);
  const projects = useProjects();
  const trustProject = useTrustProject();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const isSaving = createTask.isPending || updateTask.isPending;
  const scheduleChoice = getScheduleChoice(draft);
  const cronExpression = getDraftCronExpression(draft);
  const cronPreview = useMemo(
    () =>
      cronExpression
        ? getCronPreview(cronExpression, draft.timezone)
        : { ok: true as const, dates: [] },
    [cronExpression, draft.timezone],
  );
  const projectOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: "none", label: "選択してください" },
      ...(projects.data ?? []).map((project) => ({
        value: project.id,
        label: project.name || project.path,
      })),
    ],
    [projects.data],
  );
  const matchedProject = projects.data?.find(
    (project) =>
      project.path === draft.repoPath ||
      project.gitRoot === draft.repoPath ||
      project.id === draft.projectId,
  );
  const isRepoTarget = draft.targetMode !== "chat";
  const isDangerFullAccess = draft.sandboxMode === "danger-full-access";
  const canUpdateAnySchedule =
    draft.allowScheduleCli && draft.capabilities.includes("schedule:update-any");
  const canModifyLocalChanges =
    draft.targetMode === "repo-local" && draft.sandboxMode === "workspace-write";
  const hasErrors = Object.keys(errors).length > 0;
  const errorSummary = getOrderedErrorEntries(errors);

  function clearErrors(...keys: string[]) {
    setErrors((current) => {
      const next = { ...current };
      keys.forEach((key) => {
        delete next[key];
      });
      return next;
    });
  }

  function update<K extends keyof TaskDraft>(
    key: K,
    value: TaskDraft[K],
    extraErrorKeys: string[] = [],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearErrors(String(key), ...extraErrorKeys);
  }

  function updateTargetMode(value: TaskDraft["targetMode"]) {
    setDraft((current) => ({
      ...current,
      targetMode: value,
      sandboxMode:
        value !== "chat" && current.sandboxMode === "read-only"
          ? "workspace-write"
          : value === "chat" && current.sandboxMode === "workspace-write"
            ? "read-only"
            : current.sandboxMode,
    }));
    clearErrors("targetMode", "repoPath");
  }

  function updateScheduleChoice(value: ScheduleChoice) {
    setDraft((current) => {
      if (value === "manual" || value === "once" || value === "cron") {
        return {
          ...current,
          scheduleMode: value,
        };
      }

      return {
        ...current,
        scheduleMode: "preset",
        presetMode: value,
      };
    });
    clearErrors("scheduleMode", "timezone", "onceDate", "onceTime", "cronPreview");
  }

  function selectProject(value: string) {
    if (value === "none") {
      setDraft((current) => ({ ...current, projectId: "", repoPath: "" }));
      clearErrors("projectId", "repoPath", "targetMode");
      return;
    }

    const project = projects.data?.find((item) => item.id === value);
    if (!project) {
      return;
    }

    setDraft((current) => ({
      ...current,
      projectId: project.id,
      repoPath: project.gitRoot ?? project.path,
      baseRef: project.defaultBranch ?? current.baseRef,
      targetMode: current.targetMode === "chat" ? "repo-local" : current.targetMode,
    }));
    clearErrors("projectId", "repoPath", "targetMode");
  }

  function collectErrors() {
    const allErrors = [0, 1, 2, 3, 4]
      .map((index) => normalizeErrors(validateTaskDraftStep(draft, index)))
      .reduce<Record<string, string>>(
        (accumulator, value) => ({ ...accumulator, ...value }),
        {},
      );

    setErrors(allErrors);
    if (Object.keys(allErrors).some((key) => advancedErrorKeys.has(key))) {
      setAdvancedOpen(true);
    }
    return allErrors;
  }

  function focusErrorField(key: string) {
    const target = (errorTargetIds[key] ?? [])
      .map((id) => document.getElementById(id))
      .find((element): element is HTMLElement => element instanceof HTMLElement);

    const fallback = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    const element = target ?? fallback;
    if (!element) {
      return;
    }

    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    element.focus({ preventScroll: true });
  }

  function focusFirstError(nextErrors: Record<string, string>) {
    const [firstError] = getOrderedErrorEntries(nextErrors);
    if (!firstError) {
      return;
    }

    window.setTimeout(() => focusErrorField(firstError.key), 0);
  }

  async function save(paused: boolean) {
    const allErrors = collectErrors();
    if (Object.keys(allErrors).length > 0) {
      focusFirstError(allErrors);
      return;
    }

    const dto = buildTaskDto(draft, paused);
    try {
      const saved = task
        ? await updateTask.mutateAsync(dto)
        : await createTask.mutateAsync(dto);
      toast.success(task ? "タスクを更新しました" : "タスクを作成しました");
      onSaved?.(saved);
    } catch (error) {
      toast.error(task ? "タスクを更新できませんでした" : "タスクを作成できませんでした", {
        description:
          error instanceof Error ? error.message : "スケジューラーコマンドに失敗しました。",
      });
    }
  }

  function toggleCapability(value: string, checked: boolean) {
    update(
      "capabilities",
      checked
        ? Array.from(new Set([...draft.capabilities, value]))
        : draft.capabilities.filter((item) => item !== value),
    );
  }

  async function pickRepositoryFolder() {
    setIsPickingRepo(true);
    try {
      const path = await ipcClient.projectPickFolder();
      if (path) {
        trustProject.mutate(path, {
          onSuccess: (project) => {
            setDraft((current) => ({
              ...current,
              projectId: project.id,
              repoPath: project.gitRoot ?? project.path,
              baseRef: project.defaultBranch ?? current.baseRef,
              targetMode: current.targetMode === "chat" ? "repo-local" : current.targetMode,
            }));
            clearErrors("projectId", "repoPath", "targetMode");
            toast.success("プロジェクトを追加しました");
          },
          onError: (error) =>
            toast.error("プロジェクトを追加できませんでした", {
              description:
                error instanceof Error
                  ? error.message
                  : "プロジェクトコマンドに失敗しました。",
            }),
        });
      }
    } catch (error) {
      toast.error("プロジェクトフォルダを選択できませんでした", {
        description:
          error instanceof Error ? error.message : "ダイアログコマンドに失敗しました。",
      });
    } finally {
      setIsPickingRepo(false);
    }
  }

  async function importPromptFile() {
    setIsImportingPrompt(true);
    try {
      const contents = await ipcClient.promptImportFile();
      if (!contents) {
        return;
      }
      update("prompt", contents);
      toast.success("プロンプトをインポートしました");
    } catch (error) {
      toast.error("プロンプトをインポートできませんでした", {
        description:
          error instanceof Error ? error.message : "プロンプトファイルを読み取れませんでした。",
      });
    } finally {
      setIsImportingPrompt(false);
    }
  }

  const cronError =
    scheduleChoice === "cron" && !cronPreview.ok
      ? formatCronError(cronPreview.error)
      : undefined;

  return (
    <Card>
      <CardHeader className="border-b bg-muted/20">
        <CardTitle>{task ? "タスクを編集" : "新規タスク"}</CardTitle>
        <CardDescription>
          指示を書き、Codex の実行場所と実行タイミングを選びます。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 p-4">
        {hasErrors ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>確認が必要な項目があります</AlertTitle>
            <AlertDescription className="grid gap-2">
              <p>強調表示された項目を修正してから、もう一度保存してください。</p>
              <ul className="list-disc space-y-1 pl-4">
                {errorSummary.map(({ key, label, message }) => (
                  <li key={key}>
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                      onClick={() => focusErrorField(key)}
                    >
                      <span className="font-medium">{label}:</span> {message}
                    </button>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid content-start gap-4">
            <Field
              label="プロンプト"
              htmlFor="task-prompt"
              error={errors.prompt}
              description={`${draft.prompt.length.toLocaleString("ja-JP")} 文字`}
            >
              <div className="grid gap-2">
                <Textarea
                  id="task-prompt"
                  className="min-h-[320px] resize-y font-mono text-sm leading-6"
                  value={draft.prompt}
                  placeholder="Codex にリポジトリの確認、変更、失敗レビュー、レポート作成などを依頼します。"
                  onChange={(event) => update("prompt", event.currentTarget.value)}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isImportingPrompt}
                    onClick={() => void importPromptFile()}
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    プロンプトをインポート
                  </Button>
                </div>
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)]">
              <Field label="タスク名" htmlFor="task-name" error={errors.name}>
                <Input
                  id="task-name"
                  value={draft.name}
                  placeholder="毎日のリポジトリレビュー"
                  onChange={(event) => update("name", event.currentTarget.value)}
                />
              </Field>
              <Field label="説明" htmlFor="task-description">
                <Input
                  id="task-description"
                  value={draft.description}
                  placeholder="任意"
                  onChange={(event) =>
                    update("description", event.currentTarget.value)
                  }
                />
              </Field>
            </div>
          </section>

          <aside className="grid content-start gap-4">
            <Panel
              title="実行先"
              description="Codex が使用するワークスペースを選びます。"
            >
              <SelectField
                id="target-mode"
                label="実行先"
                value={draft.targetMode}
                options={targetModeOptions}
                onChange={updateTargetMode}
              />
              <SelectField
                id="project"
                label="プロジェクト"
                value={draft.projectId || "none"}
                options={projectOptions}
                onChange={selectProject}
                description="登録済みプロジェクトを選ぶか、フォルダを選択して追加します。"
              />
              {isRepoTarget ? (
                <div className="grid gap-4">
                  <Field
                    label="プロジェクトパス"
                    htmlFor="repo-path"
                    error={errors.repoPath}
                    description="パスはプロジェクト選択またはフォルダ選択から設定します。"
                  >
                    <div className="flex gap-2">
                      <Input
                        id="repo-path"
                        className="min-w-0"
                        value={draft.repoPath}
                        readOnly
                        placeholder="プロジェクトを選択してください"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPickingRepo || trustProject.isPending}
                        onClick={() => void pickRepositoryFolder()}
                      >
                        <FolderOpen className="size-4" aria-hidden="true" />
                        フォルダを選択
                      </Button>
                    </div>
                  </Field>
                  <Field label="ベース参照" htmlFor="base-ref">
                    <Input
                      id="base-ref"
                      value={draft.baseRef}
                      onChange={(event) => update("baseRef", event.currentTarget.value)}
                    />
                  </Field>
                  {matchedProject ? (
                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      {matchedProject.path}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canModifyLocalChanges ? (
                <Alert variant="warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>既存リポジトリが変更される可能性があります</AlertTitle>
                  <AlertDescription>
                    ワークスペース書き込みでは、Codex が現在の作業ツリーのファイルを変更できます。
                  </AlertDescription>
                </Alert>
              ) : null}
            </Panel>

            <Panel
              title="スケジュール"
              description="読みやすい実行間隔を選びます。cron はカスタムスケジュールでのみ表示します。"
            >
              <SelectField
                id="schedule"
                label="実行タイミング"
                value={scheduleChoice}
                options={scheduleOptions}
                onChange={updateScheduleChoice}
              />

              {scheduleChoice === "once" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="日付" htmlFor="once-date" error={errors.onceDate}>
                    <Input
                      id="once-date"
                      type="date"
                      value={draft.onceDate}
                      onChange={(event) =>
                        update("onceDate", event.currentTarget.value)
                      }
                    />
                  </Field>
                  <Field label="時刻" htmlFor="once-time" error={errors.onceTime}>
                    <Input
                      id="once-time"
                      type="time"
                      value={draft.onceTime}
                      onChange={(event) =>
                        update("onceTime", event.currentTarget.value)
                      }
                    />
                  </Field>
                </div>
              ) : null}

              {scheduleChoice === "daily" ||
              scheduleChoice === "weekdays" ||
              scheduleChoice === "weekly" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {scheduleChoice === "weekly" ? (
                    <SelectField
                      id="weekly-day"
                      label="曜日"
                      value={draft.weeklyDay}
                      options={weekdayOptions}
                      onChange={(value) => update("weeklyDay", value)}
                    />
                  ) : null}
                  <Field label="時刻" htmlFor="preset-time">
                    <Input
                      id="preset-time"
                      type="time"
                      value={draft.presetTime}
                      onChange={(event) =>
                        update("presetTime", event.currentTarget.value)
                      }
                    />
                  </Field>
                </div>
              ) : null}

              {scheduleChoice === "cron" ? (
                <Field
                  label="カスタム cron 式"
                  htmlFor="cron-expression"
                  error={errors.cronPreview ?? cronError}
                  description="5フィールドの cron 式を使ってください。"
                >
                  <Input
                    id="cron-expression"
                    value={draft.cronExpr}
                    aria-invalid={Boolean(errors.cronPreview ?? cronError)}
                    onChange={(event) =>
                      update("cronExpr", event.currentTarget.value, [
                        "cronPreview",
                      ])
                    }
                    placeholder="0 9 * * 1-5"
                  />
                </Field>
              ) : null}

              {scheduleChoice !== "manual" ? (
                <SelectField
                  id="timezone"
                  label="タイムゾーン"
                  value={draft.timezone}
                  options={timezoneOptions}
                  onChange={(value) => update("timezone", value)}
                  error={errors.timezone}
                />
              ) : null}

              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <CalendarClock className="mt-0.5 size-4 text-muted-foreground" />
                  <div className="grid gap-1">
                    <p className="text-sm font-medium">{getScheduleSummary(draft)}</p>
                    {cronPreview.ok && cronPreview.dates.length ? (
                      <div data-testid="cron-preview" className="grid gap-1">
                        <p className="text-xs text-muted-foreground">次の5回</p>
                        <div className="grid gap-1 text-sm tabular-nums">
                          {cronPreview.dates.map((date) => (
                            <span key={date}>{formatDateTime(date)}</span>
                          ))}
                        </div>
                      </div>
                    ) : scheduleChoice === "once" ? (
                      <p className="text-xs text-muted-foreground">
                        次回実行: {getOncePreview(draft)}
                      </p>
                    ) : scheduleChoice === "manual" ? (
                      <p className="text-xs text-muted-foreground">
                        タスク一覧、詳細ビュー、または scheduler CLI からこのタスクを実行します。
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        今後の実行をプレビューするにはスケジュールを修正してください。
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          </aside>
        </div>

        <details
          className="group rounded-lg border"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
            <span className="grid gap-1">
              <span className="text-sm font-semibold">詳細設定</span>
              <span className="text-sm text-muted-foreground text-pretty">
                Codex モデル、サンドボックス、承認、再試行、scheduler CLI アクセスを設定します。
              </span>
            </span>
            <span className="flex items-center gap-2">
              {isDangerFullAccess ? (
                <Badge variant="warning">フルアクセス</Badge>
              ) : null}
              <ChevronDown
                className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
                aria-hidden="true"
              />
            </span>
          </summary>
          <div className="grid gap-4 border-t p-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Field
                label="Codex バイナリパス"
                description="全体の runner.codex_path 設定を使用します。"
              >
                <Input value="全体の runner 設定" disabled />
              </Field>
              <Field label="モデル" htmlFor="model" error={errors.model}>
                <Input
                  id="model"
                  value={draft.model}
                  onChange={(event) => update("model", event.currentTarget.value)}
                />
              </Field>
              <Field
                label="推論 effort"
                htmlFor="reasoning"
                error={errors.reasoningEffort}
              >
                <Input
                  id="reasoning"
                  value={draft.reasoningEffort}
                  onChange={(event) =>
                    update("reasoningEffort", event.currentTarget.value)
                  }
                />
              </Field>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <SelectField
                id="sandbox-mode"
                label="サンドボックス"
                value={draft.sandboxMode}
                options={sandboxModeOptions}
                onChange={(value) => update("sandboxMode", value)}
              />
              <SelectField
                id="approval-policy"
                label="承認ポリシー"
                value={draft.approvalPolicy}
                options={approvalPolicyOptions}
                onChange={(value) => update("approvalPolicy", value)}
              />
              <Field
                label="最大実行時間"
                htmlFor="max-runtime"
                error={errors.maxRuntimeSec}
                description="秒単位。"
              >
                <Input
                  id="max-runtime"
                  type="number"
                  min={60}
                  value={draft.maxRuntimeSec}
                  onChange={(event) =>
                    update("maxRuntimeSec", Number(event.currentTarget.value))
                  }
                />
              </Field>
            </div>

            {isDangerFullAccess ? (
              <Alert variant="warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>ファイルシステムのフルアクセス</AlertTitle>
                <AlertDescription>
                  サンドボックス保護を迂回します。隔離された環境でのみ使用してください。
                </AlertDescription>
                <div className="mt-3">
                  <CheckboxRow
                    id="danger-confirmed"
                    checked={draft.dangerConfirmed}
                    label="ファイルシステムのフルアクセスのリスクを理解しています"
                    error={errors.dangerConfirmed}
                    onChange={(checked) => update("dangerConfirmed", checked)}
                  />
                </div>
              </Alert>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-4">
              <Field label="再試行" htmlFor="retries" error={errors.maxRetries}>
                <Input
                  id="retries"
                  type="number"
                  min={0}
                  value={draft.maxRetries}
                  onChange={(event) =>
                    update("maxRetries", Number(event.currentTarget.value))
                  }
                />
              </Field>
              <SelectField
                id="overlap-policy"
                label="重複"
                value={draft.overlapPolicy}
                options={overlapPolicyOptions}
                onChange={(value) => update("overlapPolicy", value)}
              />
              <SelectField
                id="missed-policy"
                label="未実行分"
                value={draft.missedPolicy}
                options={missedPolicyOptions}
                onChange={(value) => update("missedPolicy", value)}
              />
              <SelectField
                id="cleanup-policy"
                label="クリーンアップ"
                value={draft.cleanupPolicy}
                options={cleanupPolicyOptions}
                onChange={(value) => update("cleanupPolicy", value)}
              />
            </div>

            <div className="grid gap-3">
              <SwitchRow
                id="inject-instructions"
                checked={draft.injectSchedulerInstructions}
                label="プロンプトに scheduler CLI の文脈を追加"
                description="最小限の codex-schedule 使用方法と実行スコープ識別子を含めます。"
                onChange={(checked) =>
                  update("injectSchedulerInstructions", checked)
                }
              />
              <SwitchRow
                id="allow-schedule-cli"
                checked={draft.allowScheduleCli}
                label="schedule CLI を許可"
                description="スコープ付き実行環境変数とともに codex-schedule を PATH に追加します。"
                onChange={(checked) => update("allowScheduleCli", checked)}
              />
              <div className="grid gap-3 md:grid-cols-2">
                {capabilityOptions.map((capability) => (
                  <CheckboxRow
                    key={capability.value}
                    id={`capability-${capability.value.replace(/[^a-z0-9]+/g, "-")}`}
                    checked={draft.capabilities.includes(capability.value)}
                    label={capability.label}
                    description={capability.value}
                    onChange={(checked) =>
                      toggleCapability(capability.value, checked)
                    }
                  />
                ))}
              </div>
              {canUpdateAnySchedule ? (
                <Alert variant="warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>任意のスケジュールを更新できます</AlertTitle>
                  <AlertDescription>
                    このタスクはスケジュールされた Codex 実行から schedule:update-any を使用できます。
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Field
                  label="1実行あたりの作成スケジュール上限"
                  htmlFor="max-created-schedules"
                  error={errors.maxCreatedSchedulesPerRun}
                >
                  <Input
                    id="max-created-schedules"
                    type="number"
                    min={1}
                    max={100}
                    value={draft.maxCreatedSchedulesPerRun}
                    onChange={(event) =>
                      update(
                        "maxCreatedSchedulesPerRun",
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                </Field>
                <SwitchRow
                  id="force-paused"
                  checked={draft.forcePaused}
                  label="このタスクを一時停止状態で保存"
                  description="初回実行前にタスクを確認したい場合に使用します。"
                  onChange={(checked) => update("forcePaused", checked)}
                />
              </div>
            </div>
          </div>
        </details>

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              キャンセル
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href={cancelHref}>キャンセル</Link>
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {!task ? (
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => void save(true)}
              >
                一時停止で作成
              </Button>
            ) : null}
            <Button type="button" disabled={isSaving} onClick={() => void save(false)}>
              {task ? "変更を保存" : "タスクを作成"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
