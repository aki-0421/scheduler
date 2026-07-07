"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
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
  "Basics",
  "Target",
  "Schedule",
  "Codex settings",
  "CLI permissions",
  "Review",
];

const capabilityOptions = [
  { value: "schedule:create", label: "Create schedules" },
  { value: "schedule:update-current", label: "Update current task" },
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
        dangerConfirmed: 3,
      };
      setStep(stepByKey[firstKey] ?? 0);
      toast.error("Resolve validation errors before saving.");
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
      toast.error(task ? "Could not update task" : "Could not create task", {
        description:
          error instanceof Error ? error.message : "Scheduler command failed.",
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

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{task ? "Edit task" : "New task"}</CardTitle>
          <CardDescription>
            Step {step + 1} of {steps.length}: {steps[step]}
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
            <CardTitle>Basics</CardTitle>
            <CardDescription>Name the schedule and write the prompt sent to Codex.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Name" htmlFor="task-name" error={errors.name}>
              <Input
                id="task-name"
                value={draft.name}
                onChange={(event) => update("name", event.currentTarget.value)}
              />
            </Field>
            <Field label="Description" htmlFor="task-description">
              <Input
                id="task-description"
                value={draft.description}
                onChange={(event) => update("description", event.currentTarget.value)}
              />
            </Field>
            <Field
              label="Prompt"
              htmlFor="task-prompt"
              error={errors.prompt}
              description={`${draft.prompt.length.toLocaleString()} characters`}
            >
              <Textarea
                id="task-prompt"
                className="min-h-52 font-mono"
                value={draft.prompt}
                onChange={(event) => update("prompt", event.currentTarget.value)}
              />
            </Field>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="inject-instructions">Inject scheduler CLI instructions</Label>
                <p className="mt-1 text-xs text-muted-foreground text-pretty">
                  Include the minimal codex-schedule usage and run-scoped identifiers.
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
            <CardTitle>Target</CardTitle>
            <CardDescription>Choose where Codex will run.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SelectField
              label="Target mode"
              value={draft.targetMode}
              values={targetModes}
              onChange={updateTargetMode}
            />
            {draft.targetMode === "repo-local" ? (
              <Alert variant="warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>Local working tree</AlertTitle>
                <AlertDescription>
                  Uncommitted changes in this repository may be modified by Codex.
                </AlertDescription>
              </Alert>
            ) : null}
            {isRepoTarget ? (
              <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                <Field
                  label="Repository path"
                  htmlFor="repo-path"
                  error={errors.repoPath}
                  description="Use an absolute local path. Folder picker will be wired by the Tauri shell."
                >
                  <Input
                    id="repo-path"
                    value={draft.repoPath}
                    onChange={(event) => update("repoPath", event.currentTarget.value)}
                    placeholder="/Users/alice/src/my-app"
                  />
                </Field>
                <Field label="Base ref" htmlFor="base-ref">
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
                    <span className="text-sm font-medium">Project trust</span>
                    <Badge variant={repoTrusted ? "success" : "warning"}>
                      {repoTrusted ? "trusted" : "untrusted"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground text-pretty">
                    {repoTrusted
                      ? matchedProject?.path
                      : "Trust this path before saving repo-backed schedules."}
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
                        toast.error("Could not trust project", {
                          description:
                            error instanceof Error ? error.message : "Project command failed.",
                        }),
                    })
                  }
                >
                  Trust
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Use manual, once, preset, or 5-field cron schedules.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Tabs
              value={draft.scheduleMode}
              onValueChange={(value) => update("scheduleMode", value as ScheduleMode)}
            >
              <TabsList>
                <TabsTrigger value="manual">Manual</TabsTrigger>
                <TabsTrigger value="once">Once</TabsTrigger>
                <TabsTrigger value="preset">Preset</TabsTrigger>
                <TabsTrigger value="cron">Cron</TabsTrigger>
              </TabsList>
              <TabsContent value="manual" className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground text-pretty">
                  Manual tasks run only from Run now or the scheduler CLI.
                </p>
              </TabsContent>
              <TabsContent value="once" className="grid gap-4 rounded-md border p-4 md:grid-cols-3">
                <Field label="Date" htmlFor="once-date" error={errors.onceDate}>
                  <Input
                    id="once-date"
                    type="date"
                    value={draft.onceDate}
                    onChange={(event) => update("onceDate", event.currentTarget.value)}
                  />
                </Field>
                <Field label="Time" htmlFor="once-time">
                  <Input
                    id="once-time"
                    type="time"
                    value={draft.onceTime}
                    onChange={(event) => update("onceTime", event.currentTarget.value)}
                  />
                </Field>
                <SelectField
                  label="Timezone"
                  value={draft.timezone}
                  values={timezoneOptions}
                  onChange={(value) => update("timezone", value)}
                />
              </TabsContent>
              <TabsContent value="preset" className="grid gap-4 rounded-md border p-4 md:grid-cols-4">
                <SelectField
                  label="Preset"
                  value={draft.presetMode}
                  values={["hourly", "daily", "weekdays", "weekly"]}
                  onChange={(value) => update("presetMode", value)}
                />
                <Field label="Time" htmlFor="preset-time">
                  <Input
                    id="preset-time"
                    type="time"
                    value={draft.presetTime}
                    disabled={draft.presetMode === "hourly"}
                    onChange={(event) => update("presetTime", event.currentTarget.value)}
                  />
                </Field>
                <SelectField
                  label="Weekly day"
                  value={draft.weeklyDay}
                  values={["0", "1", "2", "3", "4", "5", "6"]}
                  onChange={(value) => update("weeklyDay", value)}
                />
                <SelectField
                  label="Timezone"
                  value={draft.timezone}
                  values={timezoneOptions}
                  onChange={(value) => update("timezone", value)}
                />
              </TabsContent>
              <TabsContent value="cron" className="grid gap-4 rounded-md border p-4">
                <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                  <Field
                    label="Cron expression"
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
                    label="Timezone"
                    value={draft.timezone}
                    values={timezoneOptions}
                    onChange={(value) => update("timezone", value)}
                  />
                </div>
                {draft.scheduleMode === "cron" && cronPreview.ok ? (
                  <div className="rounded-md border bg-muted/30 p-3" data-testid="cron-preview">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Next 5 runs
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
            <CardTitle>Codex settings</CardTitle>
            <CardDescription>Set runtime, model, sandbox, retry, and scheduling policies.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Codex binary path" description="Uses global runner.codex_path in settings.">
                <Input value="Global setting" disabled />
              </Field>
              <Field label="Model" htmlFor="model" error={errors.model}>
                <Input
                  id="model"
                  value={draft.model}
                  onChange={(event) => update("model", event.currentTarget.value)}
                />
              </Field>
              <Field label="Reasoning effort" htmlFor="reasoning" error={errors.reasoningEffort}>
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
              <Field label="Max runtime seconds" htmlFor="max-runtime" error={errors.maxRuntimeSec}>
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
              <Field label="Retry count" htmlFor="retries" error={errors.maxRetries}>
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
            {draft.sandboxMode === "danger-full-access" ? (
              <Alert variant="warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>danger-full-access</AlertTitle>
                <AlertDescription>
                  This bypasses sandbox and approval protection and is discouraged outside isolated environments.
                </AlertDescription>
                <div className="mt-3">
                  <CheckboxRow
                    checked={draft.dangerConfirmed}
                    label="I understand the danger-full-access risk"
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
            <CardTitle>Schedule CLI permissions</CardTitle>
            <CardDescription>Limit what scheduled Codex sessions can change.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="allow-schedule-cli">Allow schedule CLI</Label>
                <p className="mt-1 text-xs text-muted-foreground text-pretty">
                  Adds codex-schedule to PATH with run-scoped environment variables.
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
              {/* TODO: Restore max-created-schedules when TaskDto carries this permission field. */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="force-paused">Create this task as paused</Label>
                  <p className="mt-1 text-xs text-muted-foreground text-pretty">
                    Saves this task with status=paused for review-first workflows.
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
            <CardTitle>Review</CardTitle>
            <CardDescription>Confirm the saved task shape before creating it.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">Task</p>
                <p className="mt-1 font-medium">{draft.name || "Untitled task"}</p>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">
                  {draft.description || "No description"}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">Target</p>
                <p className="mt-1 font-medium">{formatTargetMode(draft.targetMode)}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {draft.targetMode === "chat" ? "App-managed chat workspace" : draft.repoPath}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">Schedule</p>
                <p className="mt-1 font-medium">
                  {draft.scheduleMode === "preset"
                    ? `preset · ${cronExpression}`
                    : draft.scheduleMode === "cron"
                      ? cronExpression
                      : draft.scheduleMode}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {cronPreview.ok && cronPreview.dates[0]
                    ? `Next: ${formatDateTime(cronPreview.dates[0])}`
                    : draft.scheduleMode === "once"
                      ? `At: ${draft.onceDate} ${draft.onceTime} ${draft.timezone}`
                      : "Manual only"}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">Codex command</p>
                <p className="mt-1 truncate font-mono text-sm">
                  codex exec --model {draft.model} --sandbox {draft.sandboxMode}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  approval {draft.approvalPolicy} · max {draft.maxRuntimeSec}s
                </p>
              </div>
            </div>
            {draft.sandboxMode === "danger-full-access" || !repoTrusted ? (
              <Alert variant="warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>Safety warnings</AlertTitle>
                <AlertDescription>
                  {draft.sandboxMode === "danger-full-access"
                    ? "danger-full-access bypasses normal sandbox protection. "
                    : ""}
                  {!repoTrusted ? "The repository path is not trusted yet." : ""}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button type="button" onClick={goNext}>
              Next
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
                  Create paused
                </Button>
              ) : null}
              <Button type="button" disabled={isSaving} onClick={() => void save(false)}>
                {task ? "Save changes" : "Create"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
