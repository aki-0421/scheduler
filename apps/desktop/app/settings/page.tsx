"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import { formatEnumLabel } from "@/lib/format";
import { ipcClient } from "@/lib/ipc";
import { useHealth, useSetSetting, useSettings } from "@/lib/queries";
import {
  approvalPolicies,
  cleanupPolicies,
  sandboxModes,
  type SchedulerSettings,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-t pt-5 first:border-t-0">
      <div className="grid gap-1 md:grid-cols-[11rem_minmax(0,1fr)]">
        <h2 className="text-base font-semibold text-balance">{title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground text-pretty">
          {description}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border bg-surface/70 px-4">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  htmlFor,
  children,
  controlClassName,
}: {
  label: string;
  description: string;
  htmlFor?: string;
  children: ReactNode;
  controlClassName?: string;
}) {
  return (
    <div className="grid gap-3 border-b py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)] md:items-center">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          {description}
        </p>
      </div>
      <div className={cn("min-w-0 md:justify-self-end md:w-80", controlClassName)}>
        {children}
      </div>
    </div>
  );
}

function ReadOnlyCode({ value }: { value: string }) {
  return (
    <code className="block truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
      {value}
    </code>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const health = useHealth();
  const setSetting = useSetSetting();
  const [form, setForm] = useState<SchedulerSettings>(settings.data);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);

  useEffect(() => {
    setForm(settings.data);
  }, [settings.data]);

  function update<Key extends keyof SchedulerSettings>(
    key: Key,
    value: SchedulerSettings[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    try {
      await Promise.all(
        (Object.keys(form) as Array<keyof SchedulerSettings>).map((key) =>
          setSetting.mutateAsync({ key, value: form[key] }),
        ),
      );
      toast.success("Settings saved");
    } catch (error) {
      toast.error("Could not save settings", {
        description:
          error instanceof Error ? error.message : "The settings command failed.",
      });
    }
  }

  async function exportDiagnostics() {
    setIsExportingDiagnostics(true);
    try {
      const path = await ipcClient.diagnosticsExport();
      if (path) {
        toast.success("Diagnostics exported", { description: path });
      } else {
        toast.info("Diagnostics export canceled");
      }
    } catch (error) {
      toast.error("Could not export diagnostics", {
        description:
          error instanceof Error ? error.message : "The diagnostics command failed.",
      });
    } finally {
      setIsExportingDiagnostics(false);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Settings"
        description="Configure scheduler behavior, default Codex execution, notifications, and diagnostics."
      />

      <SettingsSection
        title="General"
        description="Global switches that decide whether scheduled work runs and when you are notified."
      >
        <SettingRow
          label="Scheduler"
          description="Controls whether scheduled tasks are queued automatically."
          htmlFor="settings-scheduler-enabled"
          controlClassName="md:w-auto"
        >
          <Switch
            id="settings-scheduler-enabled"
            checked={form["scheduler.enabled"]}
            onCheckedChange={(checked) => update("scheduler.enabled", checked)}
          />
        </SettingRow>
        <SettingRow
          label="Notifications"
          description="Send desktop notifications when a run fails or times out."
          htmlFor="notifications-enabled"
          controlClassName="md:w-auto"
        >
          <Switch
            id="notifications-enabled"
            checked={form["notifications.enabled"]}
            onCheckedChange={(checked) => update("notifications.enabled", checked)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Execution"
        description="Defaults copied into new tasks and limits used by the local daemon."
      >
        <SettingRow
          label="Global concurrency"
          description="Maximum number of scheduler runs the daemon may execute at once."
          htmlFor="global-concurrency"
        >
          <Input
            id="global-concurrency"
            type="number"
            min={1}
            value={form["daemon.global_concurrency"]}
            onChange={(event) =>
              update("daemon.global_concurrency", Number(event.currentTarget.value))
            }
          />
        </SettingRow>
        <SettingRow
          label="Codex path"
          description="Command or absolute path used to launch the Codex CLI."
          htmlFor="codex-path"
        >
          <Input
            id="codex-path"
            value={form["runner.codex_path"]}
            onChange={(event) => update("runner.codex_path", event.currentTarget.value)}
          />
        </SettingRow>
        <SettingRow
          label="Default model"
          description="Model value copied into newly created tasks."
          htmlFor="default-model"
        >
          <Input
            id="default-model"
            value={form["runner.default_model"]}
            onChange={(event) =>
              update("runner.default_model", event.currentTarget.value)
            }
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Permissions"
        description="Default safety settings for new Codex runs and isolated worktree cleanup."
      >
        <SettingRow
          label="Default sandbox"
          description="Filesystem access mode copied into newly created tasks."
          htmlFor="default-sandbox-mode"
        >
          <Select
            value={form["runner.default_sandbox_mode"]}
            onValueChange={(value) =>
              update(
                "runner.default_sandbox_mode",
                value as SchedulerSettings["runner.default_sandbox_mode"],
              )
            }
          >
            <SelectTrigger id="default-sandbox-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sandboxModes.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {formatEnumLabel(mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label="Default approval policy"
          description="Approval behavior copied into newly created tasks."
          htmlFor="default-approval-policy"
        >
          <Select
            value={form["runner.default_approval_policy"]}
            onValueChange={(value) =>
              update(
                "runner.default_approval_policy",
                value as SchedulerSettings["runner.default_approval_policy"],
              )
            }
          >
            <SelectTrigger id="default-approval-policy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {approvalPolicies.map((policy) => (
                <SelectItem key={policy} value={policy}>
                  {formatEnumLabel(policy)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label="Worktree cleanup"
          description="Default cleanup policy for isolated worktree runs."
          htmlFor="default-cleanup-policy"
        >
          <Select
            value={form["worktree.default_cleanup_policy"]}
            onValueChange={(value) =>
              update(
                "worktree.default_cleanup_policy",
                value as SchedulerSettings["worktree.default_cleanup_policy"],
              )
            }
          >
            <SelectTrigger id="default-cleanup-policy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cleanupPolicies.map((policy) => (
                <SelectItem key={policy} value={policy}>
                  {formatEnumLabel(policy)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Diagnostics"
        description="Read-only local paths and a diagnostic export for scheduler support work."
      >
        <SettingRow
          label="Socket path"
          description="Unix socket used by the desktop app to reach the scheduler daemon."
          controlClassName="md:w-[28rem]"
        >
          <ReadOnlyCode value="~/Library/Application Support/Codex Scheduler/scheduler.sock" />
        </SettingRow>
        <SettingRow
          label="Database path"
          description="Local SQLite database used by Codex Scheduler."
          controlClassName="md:w-[28rem]"
        >
          <ReadOnlyCode value="~/Library/Application Support/Codex Scheduler/scheduler.sqlite3" />
        </SettingRow>
        <SettingRow
          label="Schema version"
          description="Current database schema version reported by the daemon."
        >
          <span className="block text-sm tabular-nums">
            {health.data?.dbSchemaVersion ?? "Unknown"}
          </span>
        </SettingRow>
        <SettingRow
          label="Export diagnostics"
          description="Write daemon health, diagnostics, and redacted daemon log tails to a local file."
          controlClassName="md:w-auto"
        >
          <Button
            type="button"
            variant="outline"
            disabled={isExportingDiagnostics}
            onClick={() => void exportDiagnostics()}
          >
            <Download className="size-4" aria-hidden="true" />
            Export diagnostics
          </Button>
        </SettingRow>
      </SettingsSection>

      <div className="sticky bottom-0 z-10 border-t bg-background py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex justify-end">
          <Button disabled={setSetting.isPending} onClick={() => void save()}>
            <Save className="size-4" aria-hidden="true" />
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}
