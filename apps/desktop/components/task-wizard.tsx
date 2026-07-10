"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  FileText,
  FolderGit2,
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
import { Separator } from "@/components/ui/separator";
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
import { ipcClient } from "@/lib/ipc";
import {
  buildTaskDto,
  defaultTaskDraft,
  getDraftCronExpression,
  taskToDraft,
  validateTaskDraft,
  type PresetMode,
  type TaskDraftErrors,
  type TaskDraft,
} from "@/lib/task-draft";
import { getSystemTimezone } from "@/lib/timezone";
import type { TaskDto } from "@/lib/types";
import { useCreateTask, useProjects, useUpdateTask } from "@/lib/queries";
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
  disabled?: boolean;
  showCancelAction?: boolean;
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

const japaneseErrorMessages: Record<string, string> = {
  name: "タスク名は必須です。",
  prompt: "プロンプトは必須です。",
  scheduleMode: "スケジュールは必須です。",
  presetMode: "スケジュールは必須です。",
  presetTime: "時刻は必須です。",
  weeklyDay: "曜日は必須です。",
  repoPath: "プロジェクト実行にはGitプロジェクトを選択してください。",
  onceDate: "有効な日付と時刻を選択してください。",
  onceTime: "有効な日付と時刻を選択してください。",
  model: "モデルは必須です。",
  reasoningEffort: "思考レベルは必須です。",
};

const errorFieldOrder = [
  "name",
  "scheduleMode",
  "presetMode",
  "presetTime",
  "weeklyDay",
  "prompt",
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
  scheduleMode: "スケジュール",
  presetMode: "スケジュール",
  presetTime: "時刻",
  weeklyDay: "曜日",
  repoPath: "プロジェクト",
  onceDate: "日付",
  onceTime: "時刻",
  cronPreview: "カスタム cron 式",
  model: "モデル",
  reasoningEffort: "思考レベル",
};

const errorTargetIds: Record<string, string[]> = {
  prompt: ["task-prompt"],
  name: ["task-name"],
  scheduleMode: ["schedule"],
  presetMode: ["schedule"],
  presetTime: ["preset-time"],
  weeklyDay: ["weekly-day"],
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

function normalizeErrors(
  draftErrors: TaskDraftErrors,
): Record<string, string> {
  return Object.entries(draftErrors).reduce<Record<string, string>>(
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

function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  description,
  error,
  required = false,
  className,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <Field
      label={label}
      htmlFor={id}
      description={description}
      error={error}
      required={required}
      className={className}
    >
      <Select
        value={value}
        required={required}
        onValueChange={(next) => onChange(next as T)}
      >
        <SelectTrigger id={id} aria-required={required || undefined}>
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
    <div className="flex items-start justify-between gap-3 py-3">
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
        className="mt-0.5 shrink-0"
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
  disabled = false,
  showCancelAction = true,
  pageHeader,
}: TaskWizardProps) {
  const [draft, setDraft] = useState<TaskDraft>(() => ({
    ...(initialDraft ?? (task ? taskToDraft(task) : defaultTaskDraft())),
    timezone: getSystemTimezone(),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isImportingPrompt, setIsImportingPrompt] = useState(false);
  const projects = useProjects();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const isSaving = createTask.isPending || updateTask.isPending;
  const scheduleChoice = getScheduleChoice(draft);
  const cronExpression = getDraftCronExpression(draft);
  const cronValidation = useMemo(
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
  const draftValidation = useMemo(() => validateTaskDraft(draft), [draft]);
  const canSave =
    Object.keys(draftValidation).length === 0 &&
    (!isRepoTarget || Boolean(matchedProject));
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
    const allErrors = normalizeErrors(validateTaskDraft(draft));

    if (draft.targetMode === "repo-worktree" && !matchedProject) {
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
    scheduleChoice === "cron" && !cronValidation.ok
      ? formatCronError(cronValidation.error)
      : undefined;

  function renderSaveActions() {
    return (
      <>
        {!task ? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isSaving || !canSave}
            onClick={() => void save(true)}
          >
            一時停止で作成
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={disabled || isSaving || !canSave}
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

      <fieldset
        disabled={disabled}
        className="m-0 grid min-w-0 gap-5 border-0 p-0"
      >
        <section
          aria-label="基本設定"
          className="grid items-start gap-5 md:grid-cols-2"
        >
          <Field
            label="タスク名"
            htmlFor="task-name"
            error={errors.name}
            required
          >
            <Input
              id="task-name"
              required
              value={draft.name}
              placeholder="毎日のリポジトリレビュー"
              onChange={(event) => update("name", event.currentTarget.value)}
            />
          </Field>

          <div className="flex flex-wrap items-start gap-3">
            <SelectField
              id="schedule"
              label="スケジュール"
              value={scheduleChoice}
              options={scheduleOptions}
              onChange={updateScheduleChoice}
              required
              className="w-full sm:w-44"
            />

            {scheduleChoice === "once" ? (
              <>
                <Field
                  label="日付"
                  htmlFor="once-date"
                  error={errors.onceDate}
                  required
                  className="w-full sm:w-44"
                >
                  <Input
                    id="once-date"
                    type="date"
                    required
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
                  required
                  className="w-full sm:w-36"
                >
                  <Input
                    id="once-time"
                    type="time"
                    required
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
                    error={errors.weeklyDay}
                    required
                    className="w-full sm:w-36"
                  />
                ) : null}
                <Field
                  label="時刻"
                  htmlFor="preset-time"
                  error={errors.presetTime}
                  required
                  className="w-full sm:w-36"
                >
                  <Input
                    id="preset-time"
                    type="time"
                    required
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
                required
                className="w-full sm:w-72"
              >
                <Input
                  id="cron-expression"
                  required
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
        </section>

        <section
          aria-label="モデル設定"
          className="flex flex-wrap items-start gap-4"
        >
          <SelectField
            id="model"
            label="モデル"
            value={draft.model}
            options={codexModelOptions}
            onChange={updateModel}
            error={errors.model}
            required
            className="w-full sm:w-56"
          />
          <SelectField
            id="reasoning"
            label="思考レベル"
            value={draft.reasoningEffort}
            options={modelReasoningEffortOptions}
            onChange={(value) => update("reasoningEffort", value)}
            error={errors.reasoningEffort}
            required
            className="w-full sm:w-44"
          />
        </section>

        <Separator />

        <section
          aria-label="実行内容とオプション"
          className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(13rem,1fr)]"
        >
          <div className="grid min-w-0 gap-5">
            <section
              className="grid gap-3"
              aria-labelledby="target-choice-label"
            >
              <h3 id="target-choice-label" className="text-sm font-semibold">
                実行先
              </h3>
              <RadioGroup
                value={targetChoice}
                aria-labelledby="target-choice-label"
                className="grid gap-2 sm:grid-cols-2"
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
                <SelectField
                  id="project"
                  label="Gitプロジェクト"
                  value={draft.projectId || "none"}
                  options={projectOptions}
                  onChange={selectProject}
                  error={errors.repoPath}
                  required
                  className="w-full sm:max-w-md"
                />
              ) : null}
            </section>

            <Field
              label="プロンプト"
              htmlFor="task-prompt"
              error={errors.prompt}
              required
            >
              <div className="grid gap-2">
                <Textarea
                  id="task-prompt"
                  required
                  className="min-h-48 resize-y font-mono text-sm leading-6"
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
                    <FileText data-icon="inline-start" aria-hidden="true" />
                    プロンプトをインポート
                  </Button>
                </div>
              </div>
            </Field>
          </div>

          <fieldset className="min-w-0 lg:border-l lg:pl-5">
            <legend className="text-sm font-semibold">オプション</legend>
            <div className="mt-1 divide-y">
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
          </fieldset>
        </section>

        {!pageHeader ? (
          <div
            className={cn(
              "flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center",
              showCancelAction ? "sm:justify-between" : "items-end sm:justify-end",
            )}
          >
            {showCancelAction ? (
              onCancel ? (
                <Button type="button" variant="outline" onClick={onCancel}>
                  キャンセル
                </Button>
              ) : (
                <Button variant="outline" asChild>
                  <Link href={cancelHref}>キャンセル</Link>
                </Button>
              )
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {renderSaveActions()}
            </div>
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
