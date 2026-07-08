"use client";

import { useEffect, useState } from "react";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
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
import { formatEnumLabel } from "@/lib/format";
import { ipcClient } from "@/lib/ipc";
import { useHealth, useSetSetting, useSettings } from "@/lib/queries";
import {
  approvalPolicies,
  cleanupPolicies,
  sandboxModes,
  type SchedulerSettings,
} from "@/lib/types";

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
      toast.success("設定を保存しました");
    } catch (error) {
      toast.error("設定を保存できませんでした", {
        description:
          error instanceof Error ? error.message : "設定コマンドに失敗しました。",
      });
    }
  }

  async function exportDiagnostics() {
    setIsExportingDiagnostics(true);
    try {
      const path = await ipcClient.diagnosticsExport();
      if (path) {
        toast.success("診断情報を書き出しました", { description: path });
      } else {
        toast.info("診断情報の書き出しをキャンセルしました");
      }
    } catch (error) {
      toast.error("診断情報を書き出せませんでした", {
        description:
          error instanceof Error ? error.message : "診断コマンドに失敗しました。",
      });
    } finally {
      setIsExportingDiagnostics(false);
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title="設定"
        description="スケジューラー、デーモン並列数、Codex 既定値、通知、クリーンアップを設定します。"
        actions={
          <Button disabled={setSetting.isPending} onClick={() => void save()}>
            <Save className="size-4" aria-hidden="true" />
            保存
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>スケジューラー</CardTitle>
            <CardDescription>全体のスケジュール動作とデーモン容量です。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="settings-scheduler-enabled">スケジューラーを有効化</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  キュー投入されるスケジュール全体のスイッチです。
                </p>
              </div>
              <Switch
                id="settings-scheduler-enabled"
                checked={form["scheduler.enabled"]}
                onCheckedChange={(checked) => update("scheduler.enabled", checked)}
              />
            </div>
            <Field label="全体の並列数" htmlFor="global-concurrency">
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
            <CardTitle>runner 既定値</CardTitle>
            <CardDescription>新規タスクへコピーされる既定値です。</CardDescription>
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
            <Field label="既定 model" htmlFor="default-model">
              <Input
                id="default-model"
                value={form["runner.default_model"]}
                onChange={(event) =>
                  update("runner.default_model", event.currentTarget.value)
                }
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="既定 sandbox mode">
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
                        {formatEnumLabel(mode)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="既定 approval policy">
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
                        {formatEnumLabel(policy)}
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
            <CardTitle>通知</CardTitle>
            <CardDescription>スケジューラーイベントのデスクトップ通知です。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="notifications-enabled">通知を有効化</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  run が新たに失敗またはタイムアウトしたときに通知します。
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
            <CardTitle>worktree</CardTitle>
            <CardDescription>隔離 worktree run の既定クリーンアップポリシーです。</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="既定 cleanup policy">
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
                      {formatEnumLabel(policy)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>実行時パス</CardTitle>
            <CardDescription>ローカルスケジューラーが使う読み取り専用のデーモンパスです。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <span className="text-muted-foreground">socket path</span>
              <code className="rounded-md bg-muted px-2 py-1 text-xs">
                ~/Library/Application Support/Codex Scheduler/scheduler.sock
              </code>
            </div>
            <div className="grid gap-1">
              <span className="text-muted-foreground">database path</span>
              <code className="rounded-md bg-muted px-2 py-1 text-xs">
                ~/Library/Application Support/Codex Scheduler/scheduler.sqlite3
              </code>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">schema version</span>
              <span className="tabular-nums">
                {health.data?.dbSchemaVersion ?? "unknown"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="font-medium">診断情報</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  デーモン状態、診断情報、伏せ字化したデーモンログ末尾を書き出します。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={isExportingDiagnostics}
                onClick={() => void exportDiagnostics()}
              >
                <Download className="size-4" aria-hidden="true" />
                診断情報を書き出す
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
