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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { codexModelOptions } from "@/lib/codex-options";
import { Switch } from "@/components/ui/switch";
import { ipcClient } from "@/lib/ipc";
import { useHealth, useSetSetting, useSettings } from "@/lib/queries";
import type { SchedulerSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-t pt-5 first:border-t-0">
      <div>
        <h2 className="text-base font-semibold text-balance">{title}</h2>
      </div>
      <div>{children}</div>
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
      <div
        className={cn("min-w-0 md:justify-self-end md:w-80", controlClassName)}
      >
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
      toast.success("設定を保存しました");
    } catch (error) {
      toast.error("設定を保存できませんでした", {
        description:
          error instanceof Error
            ? error.message
            : "設定コマンドに失敗しました。",
      });
    }
  }

  async function exportDiagnostics() {
    setIsExportingDiagnostics(true);
    try {
      const path = await ipcClient.diagnosticsExport();
      if (path) {
        toast.success("診断情報をエクスポートしました", { description: path });
      } else {
        toast.info("診断情報のエクスポートをキャンセルしました");
      }
    } catch (error) {
      toast.error("診断情報をエクスポートできませんでした", {
        description:
          error instanceof Error
            ? error.message
            : "診断コマンドに失敗しました。",
      });
    } finally {
      setIsExportingDiagnostics(false);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="設定"
        description="スケジューラー、Codex 実行、診断の既定値を管理します。"
      />

      <SettingsSection title="一般">
        <SettingRow
          label="スケジューラー"
          description="スケジュール済みタスクを自動的にキューへ入れるかを制御します。"
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
          label="通知"
          description="実行が失敗したときにデスクトップ通知を送信します。"
          htmlFor="notifications-enabled"
          controlClassName="md:w-auto"
        >
          <Switch
            id="notifications-enabled"
            checked={form["notifications.enabled"]}
            onCheckedChange={(checked) =>
              update("notifications.enabled", checked)
            }
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="実行">
        <SettingRow
          label="全体同時実行数"
          description="デーモンが同時に実行できるスケジューラー実行の最大数です。"
          htmlFor="global-concurrency"
        >
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
        </SettingRow>
        <SettingRow
          label="Codex パス"
          description="Codex CLI を起動するコマンドまたは絶対パスです。"
          htmlFor="codex-path"
        >
          <Input
            id="codex-path"
            value={form["runner.codex_path"]}
            onChange={(event) =>
              update("runner.codex_path", event.currentTarget.value)
            }
          />
        </SettingRow>
        <SettingRow
          label="既定モデル"
          description="新規タスクへコピーされる Codex フロンティアモデルです。"
          htmlFor="default-model"
        >
          <Select
            value={form["runner.default_model"]}
            onValueChange={(value) =>
              update(
                "runner.default_model",
                value as SchedulerSettings["runner.default_model"],
              )
            }
          >
            <SelectTrigger id="default-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {codexModelOptions.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="診断">
        <SettingRow
          label="ソケットパス"
          description="デスクトップアプリがスケジューラーデーモンへ接続するための Unix ソケットです。"
          controlClassName="md:w-[28rem]"
        >
          <ReadOnlyCode value="~/Library/Application Support/Codex Scheduler/scheduler.sock" />
        </SettingRow>
        <SettingRow
          label="データベースパス"
          description="Codex Scheduler が使用するローカル SQLite データベースです。"
          controlClassName="md:w-[28rem]"
        >
          <ReadOnlyCode value="~/Library/Application Support/Codex Scheduler/scheduler.sqlite3" />
        </SettingRow>
        <SettingRow
          label="スキーマバージョン"
          description="デーモンが報告する現在のデータベーススキーマバージョンです。"
        >
          <span className="block text-sm tabular-nums">
            {health.data?.dbSchemaVersion ?? "不明"}
          </span>
        </SettingRow>
        <SettingRow
          label="診断情報をエクスポート"
          description="デーモンの健全性、診断、マスク済みログ末尾をローカルファイルに書き出します。"
          controlClassName="md:w-auto"
        >
          <Button
            type="button"
            variant="outline"
            disabled={isExportingDiagnostics}
            onClick={() => void exportDiagnostics()}
          >
            <Download className="size-4" aria-hidden="true" />
            診断情報をエクスポート
          </Button>
        </SettingRow>
      </SettingsSection>

      <div className="sticky bottom-0 z-10 border-t bg-background py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex justify-end">
          <Button disabled={setSetting.isPending} onClick={() => void save()}>
            <Save className="size-4" aria-hidden="true" />
            設定を保存
          </Button>
        </div>
      </div>
    </div>
  );
}
