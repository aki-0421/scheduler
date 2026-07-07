"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  ShieldCheck,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getCronPreview } from "@/lib/cron";
import { formatDateTime, formatTargetMode } from "@/lib/format";
import { ipcClient } from "@/lib/ipc";
import {
  buildTaskDto,
  defaultTaskDraft,
  getDraftCronExpression,
  taskToDraft,
  validateTaskDraftStep,
  type ScheduleMode,
  type TaskDraft,
} from "@/lib/task-draft";
import {
  approvalPolicies,
  cleanupPolicies,
  missedPolicies,
  overlapPolicies,
  sandboxModes,
  targetModes,
  type TaskDto,
} from "@/lib/types";
import {
  useCreateTask,
  useProjects,
  useTrustProject,
  useUpdateTask,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

const steps = [
  "基本情報",
  "実行先",
  "スケジュール",
  "Codex 設定",
  "CLI 権限",
  "確認",
];

const capabilityOptions = [
  { value: "schedule:create", label: "スケジュールを作成" },
  { value: "schedule:update-current", label: "現在のタスクを更新" },
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
];

type TaskWizardProps = {
  task?: TaskDto;
  initialDraft?: TaskDraft;
  initialStep?: number;
  cancelHref?: string;
  onSaved?: (task: TaskDto) => void;
};

function SelectField<T extends string>({
  label,
  value,
  values,
  onChange,
  className,
}: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function CheckboxRow({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex gap-3 rounded-md border p-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="grid gap-1">
        <span className="font-medium">{label}</span>
        {description ? (
          <span className="text-xs text-muted-foreground text-pretty">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function TaskWizard({
  task,
  initialDraft,
  initialStep = 0,
  cancelHref = "/tasks",
  onSaved,
}: TaskWizardProps) {
  const [step, setStep] = useState(initialStep);
  const [draft, setDraft] = useState<TaskDraft>(
    () => initialDraft ?? (task ? taskToDraft(task) : defaultTaskDraft()),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isImportingPrompt, setIsImportingPrompt] = useState(false);
  const [isPickingRepo, setIsPickingRepo] = useState(false);
  const projects = useProjects();
  const trustProject = useTrustProject();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const isSaving = createTask.isPending || updateTask.isPending;
  const cronExpression = getDraftCronExpression(draft);
  const cronPreview = useMemo(
    () =>
      cronExpression
        ? getCronPreview(cronExpression, draft.timezone)
        : { ok: true as const, dates: [] },
    [cronExpression, draft.timezone],
  );
  const matchedProject = projects.data?.find(
    (project) =>
      project.path === draft.repoPath ||
      project.gitRoot === draft.repoPath ||
      project.id === draft.projectId,
  );
  const isRepoTarget = draft.targetMode !== "chat";
  const repoTrusted = !isRepoTarget || Boolean(matchedProject?.trustedAt);
  const isDangerFullAccess = draft.sandboxMode === "danger-full-access";
  const canUpdateAnySchedule =
    draft.allowScheduleCli && draft.capabilities.includes("schedule:update-any");
  const canModifyLocalChanges =
    draft.targetMode === "repo-local" && draft.sandboxMode === "workspace-write";

  function update<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
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
    setErrors((current) => {
      const next = { ...current };
      delete next.targetMode;
      delete next.repoPath;
      return next;
    });
  }

  function validateCurrentStep() {
    const stepErrors = validateTaskDraftStep(draft, step);
    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  }

  function goNext() {
    if (!validateCurrentStep()) {
      return;
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function save(paused: boolean) {
    const allErrors = [0, 1, 2, 3, 4]
      .map((index) => validateTaskDraftStep(draft, index))
      .reduce<Record<string, string>>(
        (accumulator, value) => ({ ...accumulator, ...value }),
        {},
      );
    setErrors(allErrors);
    if (Object.keys(allErrors).length > 0) {
      const firstKey = Object.keys(allErrors)[0];
      const stepByKey: Record<string, number> = {
        repoPath: 1,
        onceDate: 2,
        onceTime: 2,
        timezone: 2,
        cronPreview: 2,
        model: 3,
        reasoningEffort: 3,
        maxRuntimeSec: 3,
        maxRetries: 3,
        maxCreatedSchedulesPerRun: 4,
        dangerConfirmed: 5,
      };
      setStep(stepByKey[firstKey] ?? 0);
      toast.error("保存前に入力エラーを解消してください。");
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
        update("repoPath", path);
      }
    } catch (error) {
      toast.error("リポジトリフォルダーを選択できませんでした", {
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
      toast.success("prompt を読み込みました");
    } catch (error) {
      toast.error("prompt を読み込めませんでした", {
        description:
          error instanceof Error ? error.message : "prompt ファイルを読み取れませんでした。",
      });
    } finally {
      setIsImportingPrompt(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{task ? "タスクを編集" : "新規タスク"}</CardTitle>
          <CardDescription>
            ステップ {step + 1} / {steps.length}: {steps[step]}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-6">
            {steps.map((label, index) => (
              <button
                key={label}
                type="button"
                className={cn(
                  "flex items-center justify-center rounded-md border px-3 py-2 text-xs font-medium",
                  index === step
                    ? "border-primary bg-primary text-primary-foreground"
                    : index < step
                      ? "bg-background text-foreground"
                      : "bg-muted text-muted-foreground",
                )}
                onClick={() => setStep(index)}
              >
                {index < step ? <Check className="mr-1 size-3" aria-hidden="true" /> : null}
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
            <CardDescription>スケジュール名と Codex に送る prompt を入力します。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="名前" htmlFor="task-name" error={errors.name}>
              <Input
                id="task-name"
                value={draft.name}
                onChange={(event) => update("name", event.currentTarget.value)}
              />
            </Field>
            <Field label="説明" htmlFor="task-description">
              <Input
                id="task-description"
                value={draft.description}
                onChange={(event) => update("description", event.currentTarget.value)}
              />
            </Field>
            <Field
              label="prompt"
              htmlFor="task-prompt"
              error={errors.prompt}
              description={`${draft.prompt.length.toLocaleString("ja-JP")} 文字`}
            >
              <div className="grid gap-2">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isImportingPrompt}
                    onClick={() => void importPromptFile()}
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    ファイルを読み込む
                  </Button>
                </div>
                <Textarea
                  id="task-prompt"
                  className="min-h-52 font-mono"
                  value={draft.prompt}
                  onChange={(event) => update("prompt", event.currentTarget.value)}
                />
              </div>
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="inject-instructions">スケジューラー CLI 手順を注入</Label>
                <p className="mt-1 text-xs text-muted-foreground text-pretty">
                  最小限の codex-schedule 使用方法と run スコープの識別子を含めます。
                </p>
              </div>
              <Switch
                id="inject-instructions"
                checked={draft.injectSchedulerInstructions}
                onCheckedChange={(checked) =>
                  update("injectSchedulerInstructions", checked)
                }
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>実行先</CardTitle>
            <CardDescription>Codex を実行する場所を選びます。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SelectField
              label="target mode"
              value={draft.targetMode}
              values={targetModes}
              onChange={updateTargetMode}
            />
            {draft.targetMode === "repo-local" ? (
              <Alert variant="warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>ローカル working tree</AlertTitle>
                <AlertDescription>
                  このリポジトリの未コミット変更を Codex が変更する可能性があります。
                </AlertDescription>
              </Alert>
            ) : null}
            {isRepoTarget ? (
              <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                <Field
                  label="リポジトリパス"
                  htmlFor="repo-path"
                  error={errors.repoPath}
                  description="ローカルの絶対パスを指定してください。"
                >
                  <div className="flex gap-2">
                    <Input
                      id="repo-path"
                      className="min-w-0"
                      value={draft.repoPath}
                      onChange={(event) => update("repoPath", event.currentTarget.value)}
                      placeholder="/Users/alice/src/my-app"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPickingRepo}
                      onClick={() => void pickRepositoryFolder()}
                    >
                      <FolderOpen className="size-4" aria-hidden="true" />
                      参照
                    </Button>
                  </div>
                </Field>
                <Field label="base ref" htmlFor="base-ref">
                  <Input
                    id="base-ref"
                    value={draft.baseRef}
                    onChange={(event) => update("baseRef", event.currentTarget.value)}
                  />
                </Field>
              </div>
            ) : null}
            {isRepoTarget ? (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    <span className="text-sm font-medium">プロジェクト信頼</span>
                    <Badge variant={repoTrusted ? "success" : "warning"}>
                      {repoTrusted ? "信頼済み" : "未信頼"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground text-pretty">
                    {repoTrusted
                      ? matchedProject?.path
                      : "リポジトリ付きスケジュールを保存する前に、このパスを信頼してください。"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!draft.repoPath || trustProject.isPending}
                  onClick={() =>
                    trustProject.mutate(draft.repoPath, {
                      onSuccess: (project) => {
                        update("projectId", project.id);
                        toast.success("プロジェクトを信頼しました");
                      },
                      onError: (error) =>
                        toast.error("プロジェクトを信頼できませんでした", {
                          description:
                            error instanceof Error ? error.message : "プロジェクトコマンドに失敗しました。",
                        }),
                    })
                  }
                >
                  信頼
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>スケジュール</CardTitle>
            <CardDescription>手動、一回、プリセット、5-field cron のいずれかを使います。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Tabs
              value={draft.scheduleMode}
              onValueChange={(value) => update("scheduleMode", value as ScheduleMode)}
            >
              <TabsList>
                <TabsTrigger value="manual">手動</TabsTrigger>
                <TabsTrigger value="once">一回</TabsTrigger>
                <TabsTrigger value="preset">プリセット</TabsTrigger>
                <TabsTrigger value="cron">Cron</TabsTrigger>
              </TabsList>
              <TabsContent value="manual" className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground text-pretty">
                  手動タスクは「今すぐ実行」またはスケジューラー CLI からのみ実行されます。
                </p>
              </TabsContent>
              <TabsContent value="once" className="grid gap-4 rounded-md border p-4 md:grid-cols-3">
                <Field label="日付" htmlFor="once-date" error={errors.onceDate}>
                  <Input
                    id="once-date"
                    type="date"
                    value={draft.onceDate}
                    onChange={(event) => update("onceDate", event.currentTarget.value)}
                  />
                </Field>
                <Field label="時刻" htmlFor="once-time">
                  <Input
                    id="once-time"
                    type="time"
                    value={draft.onceTime}
                    onChange={(event) => update("onceTime", event.currentTarget.value)}
                  />
                </Field>
                <SelectField
                  label="timezone"
                  value={draft.timezone}
                  values={timezoneOptions}
                  onChange={(value) => update("timezone", value)}
                />
              </TabsContent>
              <TabsContent value="preset" className="grid gap-4 rounded-md border p-4 md:grid-cols-4">
                <SelectField
                  label="preset"
                  value={draft.presetMode}
                  values={["hourly", "daily", "weekdays", "weekly"]}
                  onChange={(value) => update("presetMode", value)}
                />
                <Field label="時刻" htmlFor="preset-time">
                  <Input
                    id="preset-time"
                    type="time"
                    value={draft.presetTime}
                    disabled={draft.presetMode === "hourly"}
                    onChange={(event) => update("presetTime", event.currentTarget.value)}
                  />
                </Field>
                <SelectField
                  label="曜日"
                  value={draft.weeklyDay}
                  values={["0", "1", "2", "3", "4", "5", "6"]}
                  onChange={(value) => update("weeklyDay", value)}
                />
                <SelectField
                  label="timezone"
                  value={draft.timezone}
                  values={timezoneOptions}
                  onChange={(value) => update("timezone", value)}
                />
              </TabsContent>
              <TabsContent value="cron" className="grid gap-4 rounded-md border p-4">
                <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                  <Field
                    label="Cron 式"
                    htmlFor="cron-expression"
                    error={
                      errors.cronPreview ??
                      (draft.scheduleMode === "cron" && !cronPreview.ok
                        ? cronPreview.error
                        : undefined)
                    }
                  >
                    <Input
                      id="cron-expression"
                      value={draft.cronExpr}
                      aria-invalid={draft.scheduleMode === "cron" && !cronPreview.ok}
                      onChange={(event) => update("cronExpr", event.currentTarget.value)}
                      placeholder="0 9 * * 1-5"
                    />
                  </Field>
                  <SelectField
                    label="timezone"
                    value={draft.timezone}
                    values={timezoneOptions}
                    onChange={(value) => update("timezone", value)}
                  />
                </div>
                {draft.scheduleMode === "cron" && cronPreview.ok ? (
                  <div className="rounded-md border bg-muted/30 p-3" data-testid="cron-preview">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      次の 5 回
                    </p>
                    <div className="grid gap-1 text-sm tabular-nums">
                      {cronPreview.dates.map((date) => (
                        <span key={date}>{formatDateTime(date)}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>Codex 設定</CardTitle>
            <CardDescription>実行時間、model、sandbox、retry、スケジューリングポリシーを設定します。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Codex binary path" description="設定のグローバル runner.codex_path を使います。">
                <Input value="グローバル設定" disabled />
              </Field>
              <Field label="model" htmlFor="model" error={errors.model}>
                <Input
                  id="model"
                  value={draft.model}
                  onChange={(event) => update("model", event.currentTarget.value)}
                />
              </Field>
              <Field label="reasoning effort" htmlFor="reasoning" error={errors.reasoningEffort}>
                <Input
                  id="reasoning"
                  value={draft.reasoningEffort}
                  onChange={(event) => update("reasoningEffort", event.currentTarget.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <SelectField
                label="Sandbox mode"
                value={draft.sandboxMode}
                values={sandboxModes}
                onChange={(value) => update("sandboxMode", value)}
              />
              <SelectField
                label="Approval policy"
                value={draft.approvalPolicy}
                values={approvalPolicies}
                onChange={(value) => update("approvalPolicy", value)}
              />
              <Field label="最大実行秒数" htmlFor="max-runtime" error={errors.maxRuntimeSec}>
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
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="retry 回数" htmlFor="retries" error={errors.maxRetries}>
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
                label="Overlap policy"
                value={draft.overlapPolicy}
                values={overlapPolicies}
                onChange={(value) => update("overlapPolicy", value)}
              />
              <SelectField
                label="Missed run policy"
                value={draft.missedPolicy}
                values={missedPolicies}
                onChange={(value) => update("missedPolicy", value)}
              />
              <SelectField
                label="Cleanup policy"
                value={draft.cleanupPolicy}
                values={cleanupPolicies}
                onChange={(value) => update("cleanupPolicy", value)}
              />
            </div>
            {isDangerFullAccess ? (
              <Alert variant="warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>danger-full-access</AlertTitle>
                <AlertDescription>
                  sandbox と承認による保護を迂回するため、隔離環境以外では非推奨です。
                </AlertDescription>
                <div className="mt-3">
                  <CheckboxRow
                    checked={draft.dangerConfirmed}
                    label="danger-full-access のリスクを理解しました"
                    onChange={(checked) => update("dangerConfirmed", checked)}
                  />
                  {errors.dangerConfirmed ? (
                    <p className="mt-2 text-xs text-destructive">{errors.dangerConfirmed}</p>
                  ) : null}
                </div>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle>Schedule CLI 権限</CardTitle>
            <CardDescription>スケジュール実行された Codex セッションが変更できる範囲を制限します。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="allow-schedule-cli">schedule CLI を許可</Label>
                <p className="mt-1 text-xs text-muted-foreground text-pretty">
                  run スコープの環境変数とともに codex-schedule を PATH に追加します。
                </p>
              </div>
              <Switch
                id="allow-schedule-cli"
                checked={draft.allowScheduleCli}
                onCheckedChange={(checked) => update("allowScheduleCli", checked)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {capabilityOptions.map((capability) => (
                <CheckboxRow
                  key={capability.value}
                  checked={draft.capabilities.includes(capability.value)}
                  label={capability.label}
                  onChange={(checked) => toggleCapability(capability.value, checked)}
                />
              ))}
            </div>
            <div className="grid gap-4">
              <Field
                label="run ごとの最大スケジュール作成数"
                htmlFor="max-created-schedules"
                error={errors.maxCreatedSchedulesPerRun}
                description="このタスクが codex-schedule 経由で作成できるスケジュール数を制限します。"
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
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="force-paused">このタスクを paused で作成</Label>
                  <p className="mt-1 text-xs text-muted-foreground text-pretty">
                    確認を先に行うワークフロー向けに、このタスクを status=paused で保存します。
                  </p>
                </div>
                <Switch
                  id="force-paused"
                  checked={draft.forcePaused}
                  onCheckedChange={(checked) => update("forcePaused", checked)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 5 ? (
        <Card>
          <CardHeader>
            <CardTitle>確認</CardTitle>
            <CardDescription>作成前に保存されるタスク内容を確認します。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">タスク</p>
                <p className="mt-1 font-medium">{draft.name || "無題のタスク"}</p>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">
                  {draft.description || "説明はありません"}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">実行先</p>
                <p className="mt-1 font-medium">{formatTargetMode(draft.targetMode)}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {draft.targetMode === "chat" ? "アプリ管理のチャットワークスペース" : draft.repoPath}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">スケジュール</p>
                <p className="mt-1 font-medium">
                  {draft.scheduleMode === "preset"
                    ? `preset · ${cronExpression}`
                    : draft.scheduleMode === "cron"
                      ? cronExpression
                      : draft.scheduleMode}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {cronPreview.ok && cronPreview.dates[0]
                    ? `次回: ${formatDateTime(cronPreview.dates[0])}`
                    : draft.scheduleMode === "once"
                      ? `実行時刻: ${draft.onceDate} ${draft.onceTime} ${draft.timezone}`
                      : "手動のみ"}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">Codex コマンド</p>
                <p className="mt-1 truncate font-mono text-sm">
                  codex exec --model {draft.model} --sandbox {draft.sandboxMode}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  approval {draft.approvalPolicy} · 最大 {draft.maxRuntimeSec} 秒
                  · 最大 {draft.maxCreatedSchedulesPerRun} 件の schedule を作成
                </p>
              </div>
            </div>
            <div className="grid gap-3">
              {isDangerFullAccess ? (
                <Alert variant="warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>danger-full-access</AlertTitle>
                  <AlertDescription>
                    このタスクはファイルシステム sandbox 保護と承認プロンプトなしで実行できます。
                  </AlertDescription>
                  <div className="mt-3">
                    <CheckboxRow
                      checked={draft.dangerConfirmed}
                      label="danger-full-access のリスクを理解しました"
                      onChange={(checked) => update("dangerConfirmed", checked)}
                    />
                    {errors.dangerConfirmed ? (
                      <p className="mt-2 text-xs text-destructive">
                        {errors.dangerConfirmed}
                      </p>
                    ) : null}
                  </div>
                </Alert>
              ) : null}
              {canModifyLocalChanges ? (
                <Alert variant="warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>ローカル未コミット変更</AlertTitle>
                  <AlertDescription>
                    この repo-local タスクは working tree に書き込めるため、未コミット変更が変更される可能性があります。
                  </AlertDescription>
                </Alert>
              ) : null}
              {canUpdateAnySchedule ? (
                <Alert variant="warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>schedule:update-any</AlertTitle>
                  <AlertDescription>
                    このタスクのスケジュール実行 Codex セッションは、現在のタスク以外のスケジュールも更新できます。
                  </AlertDescription>
                </Alert>
              ) : null}
              {!repoTrusted ? (
                <Alert variant="warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>未信頼のリポジトリ</AlertTitle>
                  <AlertDescription>
                    リポジトリパスはまだ信頼されていません。
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" asChild>
          <Link href={cancelHref}>キャンセル</Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            戻る
          </Button>
          {step < steps.length - 1 ? (
            <Button type="button" onClick={goNext}>
              次へ
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <>
              {!task ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving}
                  onClick={() => void save(true)}
                >
                  paused で作成
                </Button>
              ) : null}
              <Button type="button" disabled={isSaving} onClick={() => void save(false)}>
                {task ? "変更を保存" : "作成"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
