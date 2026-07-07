"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/field";
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
import { useSetSetting, useSettings } from "@/lib/queries";
import {
  approvalPolicies,
  cleanupPolicies,
  sandboxModes,
  type SchedulerSettings,
} from "@/lib/types";

export default function SettingsPage() {
  const settings = useSettings();
  const setSetting = useSetSetting();
  const [form, setForm] = useState<SchedulerSettings>(settings.data);

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
          error instanceof Error ? error.message : "Settings command failed.",
      });
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-balance">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Configure scheduler, daemon concurrency, Codex defaults, notifications, and cleanup.
          </p>
        </div>
        <Button disabled={setSetting.isPending} onClick={() => void save()}>
          <Save className="size-4" aria-hidden="true" />
          Save
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Scheduler</CardTitle>
            <CardDescription>Global scheduling and daemon capacity.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="settings-scheduler-enabled">Scheduler enabled</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Global switch for queued schedules.
                </p>
              </div>
              <Switch
                id="settings-scheduler-enabled"
                checked={form["scheduler.enabled"]}
                onCheckedChange={(checked) => update("scheduler.enabled", checked)}
              />
            </div>
            <Field label="Global concurrency" htmlFor="global-concurrency">
              <Input
                id="global-concurrency"
                type="number"
                min={1}
                value={form["daemon.global_concurrency"]}
                onChange={(event) =>
                  update(
                    "daemon.global_concurrency",
                    Number(event.currentTarget.value),
                  )
                }
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runner defaults</CardTitle>
            <CardDescription>Defaults copied into newly created tasks.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Codex path" htmlFor="codex-path">
              <Input
                id="codex-path"
                value={form["runner.codex_path"]}
                onChange={(event) =>
                  update("runner.codex_path", event.currentTarget.value)
                }
              />
            </Field>
            <Field label="Default model" htmlFor="default-model">
              <Input
                id="default-model"
                value={form["runner.default_model"]}
                onChange={(event) =>
                  update("runner.default_model", event.currentTarget.value)
                }
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Default sandbox mode">
                <Select
                  value={form["runner.default_sandbox_mode"]}
                  onValueChange={(value) =>
                    update(
                      "runner.default_sandbox_mode",
                      value as SchedulerSettings["runner.default_sandbox_mode"],
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sandboxModes.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {mode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Default approval policy">
                <Select
                  value={form["runner.default_approval_policy"]}
                  onValueChange={(value) =>
                    update(
                      "runner.default_approval_policy",
                      value as SchedulerSettings["runner.default_approval_policy"],
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {approvalPolicies.map((policy) => (
                      <SelectItem key={policy} value={policy}>
                        {policy}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Desktop notifications for scheduler events.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="notifications-enabled">Notifications enabled</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run started, succeeded, failed, and permission failure events.
                </p>
              </div>
              <Switch
                id="notifications-enabled"
                checked={form["notifications.enabled"]}
                onCheckedChange={(checked) => update("notifications.enabled", checked)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Worktrees</CardTitle>
            <CardDescription>Default cleanup policy for isolated worktree runs.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Default cleanup policy">
              <Select
                value={form["worktree.default_cleanup_policy"]}
                onValueChange={(value) =>
                  update(
                    "worktree.default_cleanup_policy",
                    value as SchedulerSettings["worktree.default_cleanup_policy"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cleanupPolicies.map((policy) => (
                    <SelectItem key={policy} value={policy}>
                      {policy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
