"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  FileText,
  FolderGit2,
  FolderOpen,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  codexModelOptions,
  defaultReasoningEffortForModel,
  reasoningEffortOptionsForModel,
} from "@/lib/codex-options";
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
import { getSystemTimezone, localDateTimeToUtcIso } from "@/lib/timezone";
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
  pageHeader?: {
    title: string;
    description?: string;
  };
};

type ScheduleChoice = "manual" | "once" | PresetMode | "cron";
type TargetChoice = "chat" | "project";

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

const japaneseErrorMessages: Record<string, string> = {
  name: "タスク名は必須です。",
  prompt: "プロンプトは必須です。",
  repoPath: "プロジェクト実行にはGitプロジェクトを選択してください。",
  onceDate: "有効な日付と時刻を選択してください。",
  onceTime: "有効な日付と時刻を選択してください。",
  model: "モデルは必須です。",
  reasoningEffort: "推論 effort は必須です。",
};

const errorFieldOrder = [
  "prompt",
  "name",
  "repoPath",
  "onceDate",
  "onceTime",
  "cronPreview",
  "model",
  "reasoningEffort",
];

const errorLabelByKey: Record<string, string> = {
  prompt: "プロンプト",
  name: "タスク名",
  repoPath: "プロジェクト",
  onceDate: "日付",
  onceTime: "時刻",
  cronPreview: "カスタム cron 式",
  model: "モデル",
  reasoningEffort: "推論 effort",
};

const errorTargetIds: Record<string, string[]> = {
  prompt: ["task-prompt"],
  name: ["task-name"],
  repoPath: ["project"],
  onceDate: ["once-date"],
  onceTime: ["once-time"],
  cronPreview: ["cron-expression"],
  model: ["model"],
  reasoningEffort: ["reasoning"],
};

function formatCronError(message?: string) {
  if (!message) {
    return undefined;
  }

  if (
    message.includes("Seconds are not supported") ||
    message.includes("秒フィールド")
  ) {
    return "秒フィールドはサポートしていません。5フィールドの cron 式を使ってください。";
  }

  if (message.includes("5-field") || message.includes("5フィールド")) {
    return "5フィールドの cron 式を入力してください。";
  }

  if (
    message.includes("Invalid cron expression") ||
    message.includes("cron 式が無効")
  ) {
    return "有効な cron 式を入力してください。";
  }

  return message;
}

function formatProjectRegistrationError(error: unknown) {
  if (error instanceof Error) {
    return error.message.includes("Git repository")
      ? "Gitリポジトリ内のフォルダを選択してください。"
      : error.message;
  }
  return "プロジェクトコマンドに失敗しました。";
}

function normalizeErrors(stepErrors: StepErrors): Record<string, string> {
  return Object.entries(stepErrors).reduce<Record<string, string>>(
    (normalized, [key, message]) => {
      normalized[key] =
        key === "cronPreview"
          ? (formatCronError(message) ?? "有効な cron 式を入力してください。")
          : (japaneseErrorMessages[key] ??
            message ??
            "この項目を確認してください。");
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
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
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
        <p
          id={descriptionId}
          className="text-xs text-muted-foreground text-pretty"
        >
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

export function TaskWizard({
  task,
  initialDraft,
  cancelHref = "/tasks",
  onCancel,
  onSaved,
  pageHeader,
}: TaskWizardProps) {
  const [draft, setDraft] = useState<TaskDraft>(() => ({
    ...(initialDraft ?? (task ? taskToDraft(task) : defaultTaskDraft())),
    timezone: getSystemTimezone(),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
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
      ...(projects.data ?? [])
        .filter((project) => project.kind === "git" && project.gitRoot)
        .map((project) => ({
          value: project.id,
          label: project.name || project.path,
        })),
    ],
    [projects.data],
  );
  const matchedProject = projects.data?.find(
    (project) =>
      project.kind === "git" &&
      project.gitRoot &&
      project.id === draft.projectId &&
      project.gitRoot === draft.repoPath,
  );
  const isRepoTarget = draft.targetMode === "repo-worktree";
  const targetChoice: TargetChoice = isRepoTarget ? "project" : "chat";
  const modelReasoningEffortOptions = useMemo(
    () => reasoningEffortOptionsForModel(draft.model),
    [draft.model],
  );
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

  function updateModel(value: TaskDraft["model"]) {
    setDraft((current) => ({
      ...current,
      model: value,
      reasoningEffort: defaultReasoningEffortForModel(value),
    }));
    clearErrors("model", "reasoningEffort");
  }

  function updateTargetChoice(value: TargetChoice) {
    const targetMode = value === "project" ? "repo-worktree" : "chat";
    setDraft((current) => ({
      ...current,
      targetMode,
    }));
    clearErrors("targetMode", "projectId", "repoPath");
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
    clearErrors("scheduleMode", "onceDate", "onceTime", "cronPreview");
  }

  function selectProject(value: string) {
    if (value === "none") {
      setDraft((current) => ({ ...current, projectId: "", repoPath: "" }));
      clearErrors("projectId", "repoPath", "targetMode");
      return;
    }

    const project = projects.data?.find(
      (item) => item.id === value && item.kind === "git" && item.gitRoot,
    );
    if (!project?.gitRoot) {
      return;
    }
    const gitRoot = project.gitRoot;

    setDraft((current) => ({
      ...current,
      projectId: project.id,
      repoPath: gitRoot,
      baseRef: project.defaultBranch ?? current.baseRef,
      targetMode: "repo-worktree",
    }));
    clearErrors("projectId", "repoPath", "targetMode");
  }

  function collectErrors() {
    const allErrors = [0, 1, 2, 3]
      .map((index) => normalizeErrors(validateTaskDraftStep(draft, index)))
      .reduce<
        Record<string, string>
      >((accumulator, value) => ({ ...accumulator, ...value }), {});

    if (
      draft.targetMode === "repo-worktree" &&
      projects.data &&
      !matchedProject
    ) {
      allErrors.repoPath =
        "プロジェクト実行には登録済みGitプロジェクトが必要です。";
    }

    setErrors(allErrors);
    return allErrors;
  }

  function focusErrorField(key: string) {
    const target = (errorTargetIds[key] ?? [])
      .map((id) => document.getElementById(id))
      .find(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );

    const fallback = document.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
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
      toast.error(
        task ? "タスクを更新できませんでした" : "タスクを作成できませんでした",
        {
          description:
            error instanceof Error
              ? error.message
              : "スケジューラーコマンドに失敗しました。",
        },
      );
    }
  }

  async function pickRepositoryFolder() {
    setIsPickingRepo(true);
    try {
      const path = await ipcClient.projectPickFolder();
      if (path) {
        trustProject.mutate(path, {
          onSuccess: (project) => {
            if (project.kind !== "git" || !project.gitRoot) {
              toast.error("Gitリポジトリを選択してください");
              return;
            }
            const gitRoot = project.gitRoot;
            setDraft((current) => ({
              ...current,
              projectId: project.id,
              repoPath: gitRoot,
              baseRef: project.defaultBranch ?? current.baseRef,
              targetMode: "repo-worktree",
            }));
            clearErrors("projectId", "repoPath", "targetMode");
            toast.success("Gitプロジェクトを追加しました");
          },
          onError: (error) =>
            toast.error("Gitプロジェクトを追加できませんでした", {
              description: formatProjectRegistrationError(error),
            }),
        });
      }
    } catch (error) {
      toast.error("Gitリポジトリを選択できませんでした", {
        description:
          error instanceof Error
            ? error.message
            : "ダイアログコマンドに失敗しました。",
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
          error instanceof Error
            ? error.message
            : "プロンプトファイルを読み取れませんでした。",
      });
    } finally {
      setIsImportingPrompt(false);
    }
  }

  const cronError =
    scheduleChoice === "cron" && !cronPreview.ok
      ? formatCronError(cronPreview.error)
      : undefined;

  function renderSaveActions() {
    return (
      <>
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
        <Button
          type="button"
          disabled={isSaving}
          onClick={() => void save(false)}
        >
          {task ? "変更を保存" : "タスクを作成"}
        </Button>
      </>
    );
  }

  return (
    <div className="grid gap-4">
      {pageHeader ? (
        <PageHeader
          title={pageHeader.title}
          description={pageHeader.description}
          actions={renderSaveActions()}
        />
      ) : null}

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
                    onClick={() =>
                      window.setTimeout(() => focusErrorField(key), 0)
                    }
                  >
                    <span className="font-medium">{label}:</span> {message}
                  </button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
          <section
            className="grid content-start gap-4"
            aria-labelledby="task-content-heading"
          >
            <h3 id="task-content-heading" className="text-sm font-semibold">
              依頼内容
            </h3>
            <Field label="タスク名" htmlFor="task-name" error={errors.name}>
              <Input
                id="task-name"
                value={draft.name}
                placeholder="毎日のリポジトリレビュー"
                onChange={(event) => update("name", event.currentTarget.value)}
              />
            </Field>
            <Field
              label="プロンプト"
              htmlFor="task-prompt"
              error={errors.prompt}
            >
              <div className="grid gap-2">
                <Textarea
                  id="task-prompt"
                  className="min-h-56 resize-y font-mono text-sm leading-6"
                  value={draft.prompt}
                  placeholder="Codex にリポジトリの確認、変更、失敗レビュー、レポート作成などを依頼します。"
                  onChange={(event) =>
                    update("prompt", event.currentTarget.value)
                  }
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {draft.prompt.length.toLocaleString("ja-JP")} 文字
                  </span>
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
          </section>

          <div className="grid content-start gap-5 lg:border-l lg:pl-6">
            <section
              className="grid gap-3"
              aria-labelledby="target-choice-label"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="target-choice-label" className="text-sm font-semibold">
                  実行先
                </h3>
                {isRepoTarget ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPickingRepo || trustProject.isPending}
                    onClick={() => void pickRepositoryFolder()}
                  >
                    <FolderOpen data-icon="inline-start" aria-hidden="true" />
                    Gitリポジトリを追加
                  </Button>
                ) : null}
              </div>
              <RadioGroup
                value={targetChoice}
                aria-labelledby="target-choice-label"
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
                onValueChange={(value) =>
                  updateTargetChoice(value as TargetChoice)
                }
              >
                <Label
                  htmlFor="target-chat"
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border bg-background p-3 transition-colors duration-150 hover:bg-muted/50",
                    targetChoice === "chat" && "border-ring bg-accent/50",
                  )}
                >
                  <RadioGroupItem
                    id="target-chat"
                    value="chat"
                    className="mt-0.5 shrink-0"
                  />
                  <MessageSquare
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">チャット</span>
                    <span className="text-xs font-normal text-muted-foreground text-pretty">
                      アプリ管理のワークスペースで実行します。
                    </span>
                  </span>
                </Label>
                <Label
                  htmlFor="target-project"
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border bg-background p-3 transition-colors duration-150 hover:bg-muted/50",
                    targetChoice === "project" && "border-ring bg-accent/50",
                  )}
                >
                  <RadioGroupItem
                    id="target-project"
                    value="project"
                    className="mt-0.5 shrink-0"
                  />
                  <FolderGit2
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">プロジェクト</span>
                    <span className="text-xs font-normal text-muted-foreground text-pretty">
                      実行ごとにGitワークツリーを作成します。
                    </span>
                  </span>
                </Label>
              </RadioGroup>
              {isRepoTarget ? (
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <SelectField
                      id="project"
                      label="Gitプロジェクト"
                      value={draft.projectId || "none"}
                      options={projectOptions}
                      onChange={selectProject}
                      error={errors.repoPath}
                    />
                    <Field label="ベース参照" htmlFor="base-ref">
                      <Input
                        id="base-ref"
                        value={draft.baseRef}
                        onChange={(event) =>
                          update("baseRef", event.currentTarget.value)
                        }
                      />
                    </Field>
                  </div>
                  {matchedProject ? (
                    <div className="break-all rounded-md border p-3 text-xs text-muted-foreground">
                      {matchedProject.gitRoot}
                    </div>
                  ) : null}
                  <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <FolderGit2
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <p className="text-pretty">
                      登録した作業ツリーは変更せず、実行ごとに分離ワークツリーを作成します。
                    </p>
                  </div>
                </div>
              ) : null}
            </section>

            <section
              className="grid gap-3 border-t pt-5"
              aria-labelledby="schedule-heading"
            >
              <h3 id="schedule-heading" className="text-sm font-semibold">
                スケジュール
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  id="schedule"
                  label="実行タイミング"
                  value={scheduleChoice}
                  options={scheduleOptions}
                  onChange={updateScheduleChoice}
                />

                {scheduleChoice === "once" ? (
                  <>
                    <Field
                      label="日付"
                      htmlFor="once-date"
                      error={errors.onceDate}
                    >
                      <Input
                        id="once-date"
                        type="date"
                        value={draft.onceDate}
                        onChange={(event) =>
                          update("onceDate", event.currentTarget.value)
                        }
                      />
                    </Field>
                    <Field
                      label="時刻"
                      htmlFor="once-time"
                      error={errors.onceTime}
                    >
                      <Input
                        id="once-time"
                        type="time"
                        value={draft.onceTime}
                        onChange={(event) =>
                          update("onceTime", event.currentTarget.value)
                        }
                      />
                    </Field>
                  </>
                ) : null}

                {scheduleChoice === "daily" ||
                scheduleChoice === "weekdays" ||
                scheduleChoice === "weekly" ? (
                  <>
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
                  </>
                ) : null}

                {scheduleChoice === "cron" ? (
                  <Field
                    label="カスタム cron 式"
                    htmlFor="cron-expression"
                    error={errors.cronPreview ?? cronError}
                    description="5フィールドの cron 式を使ってください。"
                    className="sm:col-span-2"
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
              </div>

              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="grid min-w-0 gap-1">
                    <p className="text-sm font-medium">
                      {getScheduleSummary(draft)}
                    </p>
                    {scheduleChoice !== "manual" ? (
                      <p className="text-xs text-muted-foreground">
                        PCのタイムゾーン（{draft.timezone}）を使用します。
                      </p>
                    ) : null}
                    {cronPreview.ok && cronPreview.dates.length ? (
                      <div data-testid="cron-preview" className="grid gap-1">
                        <p className="text-xs text-muted-foreground">次の5回</p>
                        <div className="grid gap-x-3 gap-y-1 text-sm tabular-nums sm:grid-cols-2">
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
                        タスク詳細または scheduler CLI
                        からこのタスクを実行します。
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        今後の実行をプレビューするにはスケジュールを修正してください。
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <section
          className="grid gap-4 border-t pt-5"
          aria-labelledby="advanced-settings-heading"
        >
          <h2 id="advanced-settings-heading" className="text-sm font-semibold">
            詳細
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="model"
              label="モデル"
              value={draft.model}
              options={codexModelOptions}
              onChange={updateModel}
              error={errors.model}
            />
            <SelectField
              id="reasoning"
              label="推論 effort"
              value={draft.reasoningEffort}
              options={modelReasoningEffortOptions}
              onChange={(value) => update("reasoningEffort", value)}
              error={errors.reasoningEffort}
            />
          </div>

          <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
            <SwitchRow
              id="task-locked"
              checked={draft.locked}
              label="タスクをロック"
              description="スケジュール実行からの変更・停止・削除を防ぎます。"
              onChange={(checked) => update("locked", checked)}
            />
            <SwitchRow
              id="force-paused"
              checked={draft.forcePaused}
              label="一時停止状態で保存"
              description="内容を確認してから手動で有効化できます。"
              onChange={(checked) => update("forcePaused", checked)}
            />
          </div>
        </section>

        {!pageHeader ? (
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
              {renderSaveActions()}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
