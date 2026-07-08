"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
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
  { value: "schedule:create", label: "Create schedules" },
  { value: "schedule:update-current", label: "Update this task" },
  { value: "schedule:update-any", label: "Update any task" },
  { value: "schedule:list", label: "List schedules" },
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
  { value: "manual", label: "Manual only" },
  { value: "once", label: "Once at..." },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "cron", label: "Custom (cron)" },
];

const weekdayOptions = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const weekdayByValue = Object.fromEntries(
  weekdayOptions.map((option) => [option.value, option.label]),
);

const targetModeOptions = [
  { value: "chat", label: "Chat workspace" },
  { value: "repo-local", label: "Existing repository" },
  { value: "repo-worktree", label: "Fresh worktree" },
] satisfies SelectOption<TaskDraft["targetMode"]>[];

const sandboxModeOptions = [
  { value: "read-only", label: "Read only" },
  { value: "workspace-write", label: "Workspace write" },
  { value: "danger-full-access", label: "Full filesystem access" },
] satisfies SelectOption<TaskDraft["sandboxMode"]>[];

const approvalPolicyOptions = [
  { value: "never", label: "Never ask" },
  { value: "on-request", label: "Ask when needed" },
  { value: "untrusted", label: "Ask for untrusted actions" },
] satisfies SelectOption<TaskDraft["approvalPolicy"]>[];

const overlapPolicyOptions = [
  { value: "skip", label: "Skip while running" },
  { value: "queue", label: "Queue the next run" },
  { value: "cancel_previous", label: "Cancel previous run" },
] satisfies SelectOption<TaskDraft["overlapPolicy"]>[];

const missedPolicyOptions = [
  { value: "skip", label: "Skip missed runs" },
  { value: "latest_within_window", label: "Run latest within window" },
  { value: "run_all_capped", label: "Run missed runs, capped" },
] satisfies SelectOption<TaskDraft["missedPolicy"]>[];

const cleanupPolicyOptions = [
  { value: "keep", label: "Keep artifacts" },
  { value: "delete_on_success", label: "Delete on success" },
  { value: "delete_after_days", label: "Delete after retention" },
] satisfies SelectOption<TaskDraft["cleanupPolicy"]>[];

const englishErrorMessages: Record<string, string> = {
  name: "Task name is required.",
  prompt: "Prompt is required.",
  repoPath: "Repository path is required for repository targets.",
  onceDate: "Choose a valid date and time.",
  onceTime: "Choose a valid date and time.",
  timezone: "Timezone is required.",
  model: "Model is required.",
  reasoningEffort: "Reasoning effort is required.",
  maxRuntimeSec: "Use at least 60 seconds.",
  maxRetries: "Retries cannot be negative.",
  maxCreatedSchedulesPerRun: "Use a value from 1 to 100.",
  dangerConfirmed: "Confirm that you understand full filesystem access.",
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
  prompt: "Prompt",
  name: "Task name",
  repoPath: "Repository path",
  onceDate: "Date",
  onceTime: "Time",
  cronPreview: "Custom cron expression",
  timezone: "Timezone",
  model: "Model",
  reasoningEffort: "Reasoning effort",
  maxRuntimeSec: "Max runtime",
  maxRetries: "Retries",
  dangerConfirmed: "Full filesystem access",
  maxCreatedSchedulesPerRun: "Max schedules created per run",
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

  if (message.includes("Seconds are not supported")) {
    return "Seconds are not supported. Use a 5-field cron expression.";
  }

  if (message.includes("5-field")) {
    return "Enter a 5-field cron expression.";
  }

  if (message.includes("Invalid cron expression")) {
    return "Enter a valid cron expression.";
  }

  return message;
}

function normalizeErrors(stepErrors: StepErrors): Record<string, string> {
  return Object.entries(stepErrors).reduce<Record<string, string>>(
    (normalized, [key, message]) => {
      normalized[key] =
        key === "cronPreview"
          ? (formatCronError(message) ?? "Enter a valid cron expression.")
          : englishErrorMessages[key] ?? message ?? "Review this field.";
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
    label: errorLabelByKey[key] ?? "Field",
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
    return "Manual only";
  }

  if (choice === "once") {
    return `Once at ${getOncePreview(draft)}`;
  }

  if (choice === "hourly") {
    return "Every hour";
  }

  if (choice === "daily") {
    return `Every day at ${draft.presetTime}`;
  }

  if (choice === "weekdays") {
    return `Every weekday at ${draft.presetTime}`;
  }

  if (choice === "weekly") {
    return `Every ${weekdayByValue[draft.weeklyDay] ?? "Monday"} at ${draft.presetTime}`;
  }

  return draft.cronExpr ? `Custom cron: ${draft.cronExpr}` : "Custom cron";
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
      { value: "custom", label: "Custom path" },
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
  const repoTrusted = !isRepoTarget || Boolean(matchedProject?.trustedAt);
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
    if (value === "custom") {
      update("projectId", "");
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
      toast.success(task ? "Task updated" : "Task created");
      onSaved?.(saved);
    } catch (error) {
      toast.error(task ? "Could not update the task" : "Could not create the task", {
        description:
          error instanceof Error ? error.message : "The scheduler command failed.",
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
      toast.error("Could not choose a repository folder", {
        description:
          error instanceof Error ? error.message : "The dialog command failed.",
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
      toast.success("Prompt imported");
    } catch (error) {
      toast.error("Could not import the prompt", {
        description:
          error instanceof Error ? error.message : "The prompt file could not be read.",
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
        <CardTitle>{task ? "Edit task" : "New task"}</CardTitle>
        <CardDescription>
          Start with the instruction, then choose where and when Codex should run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 p-4">
        {hasErrors ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Some fields need attention</AlertTitle>
            <AlertDescription className="grid gap-2">
              <p>Fix the highlighted fields and try saving again.</p>
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
              label="Prompt"
              htmlFor="task-prompt"
              error={errors.prompt}
              description={`${draft.prompt.length.toLocaleString("en-US")} characters`}
            >
              <div className="grid gap-2">
                <Textarea
                  id="task-prompt"
                  className="min-h-[320px] resize-y font-mono text-sm leading-6"
                  value={draft.prompt}
                  placeholder="Ask Codex to inspect the repository, make a change, review failures, or prepare a report."
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
                    Import prompt
                  </Button>
                </div>
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)]">
              <Field label="Task name" htmlFor="task-name" error={errors.name}>
                <Input
                  id="task-name"
                  value={draft.name}
                  placeholder="Daily repository review"
                  onChange={(event) => update("name", event.currentTarget.value)}
                />
              </Field>
              <Field label="Description" htmlFor="task-description">
                <Input
                  id="task-description"
                  value={draft.description}
                  placeholder="Optional"
                  onChange={(event) =>
                    update("description", event.currentTarget.value)
                  }
                />
              </Field>
            </div>
          </section>

          <aside className="grid content-start gap-4">
            <Panel
              title="Target"
              description="Choose the workspace Codex should use."
            >
              <SelectField
                id="target-mode"
                label="Target"
                value={draft.targetMode}
                options={targetModeOptions}
                onChange={updateTargetMode}
              />
              <SelectField
                id="project"
                label="Project"
                value={draft.projectId || "custom"}
                options={projectOptions}
                onChange={selectProject}
                description="Use a trusted project or enter a path manually."
              />
              {isRepoTarget ? (
                <div className="grid gap-4">
                  <Field
                    label="Repository path"
                    htmlFor="repo-path"
                    error={errors.repoPath}
                    description="Use a local absolute path."
                  >
                    <div className="flex gap-2">
                      <Input
                        id="repo-path"
                        className="min-w-0"
                        value={draft.repoPath}
                        onChange={(event) =>
                          update("repoPath", event.currentTarget.value)
                        }
                        placeholder="/Users/alice/src/my-app"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPickingRepo}
                        onClick={() => void pickRepositoryFolder()}
                      >
                        <FolderOpen className="size-4" aria-hidden="true" />
                        Browse
                      </Button>
                    </div>
                  </Field>
                  <Field label="Base ref" htmlFor="base-ref">
                    <Input
                      id="base-ref"
                      value={draft.baseRef}
                      onChange={(event) => update("baseRef", event.currentTarget.value)}
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="size-4" aria-hidden="true" />
                        <span className="text-sm font-medium">Project trust</span>
                        <Badge variant={repoTrusted ? "success" : "warning"}>
                          {repoTrusted ? "Trusted" : "Not trusted"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground text-pretty">
                        {repoTrusted
                          ? (matchedProject?.path ?? draft.repoPath)
                          : "Trust this path before saving repository schedules."}
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
                            toast.success("Project trusted");
                          },
                          onError: (error) =>
                            toast.error("Could not trust the project", {
                              description:
                                error instanceof Error
                                  ? error.message
                                  : "The project command failed.",
                            }),
                        })
                      }
                    >
                      Trust
                    </Button>
                  </div>
                </div>
              ) : null}
              {canModifyLocalChanges ? (
                <Alert variant="warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>Existing repository can be changed</AlertTitle>
                  <AlertDescription>
                    Workspace write lets Codex modify files in the current working tree.
                  </AlertDescription>
                </Alert>
              ) : null}
            </Panel>

            <Panel
              title="Schedule"
              description="Pick a readable cadence. Cron is only shown for custom schedules."
            >
              <SelectField
                id="schedule"
                label="When"
                value={scheduleChoice}
                options={scheduleOptions}
                onChange={updateScheduleChoice}
              />

              {scheduleChoice === "once" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Date" htmlFor="once-date" error={errors.onceDate}>
                    <Input
                      id="once-date"
                      type="date"
                      value={draft.onceDate}
                      onChange={(event) =>
                        update("onceDate", event.currentTarget.value)
                      }
                    />
                  </Field>
                  <Field label="Time" htmlFor="once-time" error={errors.onceTime}>
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
                      label="Day"
                      value={draft.weeklyDay}
                      options={weekdayOptions}
                      onChange={(value) => update("weeklyDay", value)}
                    />
                  ) : null}
                  <Field label="Time" htmlFor="preset-time">
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
                  label="Custom cron expression"
                  htmlFor="cron-expression"
                  error={errors.cronPreview ?? cronError}
                  description="Use a 5-field cron expression."
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
                  label="Timezone"
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
                        <p className="text-xs text-muted-foreground">Next 5 runs</p>
                        <div className="grid gap-1 text-sm tabular-nums">
                          {cronPreview.dates.map((date) => (
                            <span key={date}>{formatDateTime(date)}</span>
                          ))}
                        </div>
                      </div>
                    ) : scheduleChoice === "once" ? (
                      <p className="text-xs text-muted-foreground">
                        Next run: {getOncePreview(draft)}
                      </p>
                    ) : scheduleChoice === "manual" ? (
                      <p className="text-xs text-muted-foreground">
                        Run this task from the task list, detail view, or scheduler CLI.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Fix the schedule to preview upcoming runs.
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
              <span className="text-sm font-semibold">Advanced settings</span>
              <span className="text-sm text-muted-foreground text-pretty">
                Codex model, sandbox, approvals, retries, and scheduler CLI access.
              </span>
            </span>
            <span className="flex items-center gap-2">
              {isDangerFullAccess ? (
                <Badge variant="warning">Full access</Badge>
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
                label="Codex binary path"
                description="Uses the global runner.codex_path setting."
              >
                <Input value="Global runner setting" disabled />
              </Field>
              <Field label="Model" htmlFor="model" error={errors.model}>
                <Input
                  id="model"
                  value={draft.model}
                  onChange={(event) => update("model", event.currentTarget.value)}
                />
              </Field>
              <Field
                label="Reasoning effort"
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
                label="Sandbox"
                value={draft.sandboxMode}
                options={sandboxModeOptions}
                onChange={(value) => update("sandboxMode", value)}
              />
              <SelectField
                id="approval-policy"
                label="Approval policy"
                value={draft.approvalPolicy}
                options={approvalPolicyOptions}
                onChange={(value) => update("approvalPolicy", value)}
              />
              <Field
                label="Max runtime"
                htmlFor="max-runtime"
                error={errors.maxRuntimeSec}
                description="Seconds."
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
                <AlertTitle>Full filesystem access</AlertTitle>
                <AlertDescription>
                  This bypasses sandbox protection and should only be used in isolated
                  environments.
                </AlertDescription>
                <div className="mt-3">
                  <CheckboxRow
                    id="danger-confirmed"
                    checked={draft.dangerConfirmed}
                    label="I understand the risk of full filesystem access"
                    error={errors.dangerConfirmed}
                    onChange={(checked) => update("dangerConfirmed", checked)}
                  />
                </div>
              </Alert>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-4">
              <Field label="Retries" htmlFor="retries" error={errors.maxRetries}>
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
                label="Overlap"
                value={draft.overlapPolicy}
                options={overlapPolicyOptions}
                onChange={(value) => update("overlapPolicy", value)}
              />
              <SelectField
                id="missed-policy"
                label="Missed runs"
                value={draft.missedPolicy}
                options={missedPolicyOptions}
                onChange={(value) => update("missedPolicy", value)}
              />
              <SelectField
                id="cleanup-policy"
                label="Cleanup"
                value={draft.cleanupPolicy}
                options={cleanupPolicyOptions}
                onChange={(value) => update("cleanupPolicy", value)}
              />
            </div>

            <div className="grid gap-3">
              <SwitchRow
                id="inject-instructions"
                checked={draft.injectSchedulerInstructions}
                label="Add scheduler CLI context to the prompt"
                description="Includes minimal codex-schedule usage and the run scope identifiers."
                onChange={(checked) =>
                  update("injectSchedulerInstructions", checked)
                }
              />
              <SwitchRow
                id="allow-schedule-cli"
                checked={draft.allowScheduleCli}
                label="Allow schedule CLI"
                description="Adds codex-schedule to PATH with scoped run environment variables."
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
                  <AlertTitle>Can update any schedule</AlertTitle>
                  <AlertDescription>
                    This task can use schedule:update-any from a scheduled Codex run.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Field
                  label="Max schedules created per run"
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
                  label="Save this task as paused"
                  description="Use this when you want to review the task before the first run."
                  onChange={(checked) => update("forcePaused", checked)}
                />
              </div>
            </div>
          </div>
        </details>

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href={cancelHref}>Cancel</Link>
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
                Create paused
              </Button>
            ) : null}
            <Button type="button" disabled={isSaving} onClick={() => void save(false)}>
              {task ? "Save changes" : "Create task"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
