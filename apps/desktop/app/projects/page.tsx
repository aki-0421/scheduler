"use client";

import { FolderGit2, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { useProjects, useTasks, useTrustProject, useUntrustProject } from "@/lib/queries";
import type { ProjectDto } from "@/lib/types";

function formatProjectKind(kind: ProjectDto["kind"]) {
  return kind === "git" ? "Git" : "フォルダ";
}

function TrustBadge({ trustedAt }: { trustedAt?: string }) {
  return (
    <Badge variant={trustedAt ? "success" : "warning"}>
      {trustedAt ? "信頼済み" : "未信頼"}
    </Badge>
  );
}

export default function ProjectsPage() {
  const [path, setPath] = useState("");
  const pathInputRef = useRef<HTMLInputElement>(null);
  const projects = useProjects();
  const tasks = useTasks();
  const trustProject = useTrustProject();
  const untrustProject = useUntrustProject();
  const projectList = projects.data ?? [];
  const taskList = tasks.data ?? [];

  function activeTaskCount(project: ProjectDto) {
    return taskList.filter(
      (task) =>
        task.status === "active" &&
        (task.target.projectId === project.id ||
          task.target.repoPath === project.path ||
          task.target.repoPath === project.gitRoot),
    ).length;
  }

  function trust() {
    const trimmed = path.trim();
    if (!trimmed) {
      toast.error("プロジェクトパスを入力してください。");
      pathInputRef.current?.focus();
      return;
    }

    trustProject.mutate(trimmed, {
      onSuccess: () => {
        setPath("");
        toast.success("プロジェクトを信頼済みにしました");
      },
      onError: (error) =>
        toast.error("プロジェクトを信頼済みにできませんでした", {
          description:
            error instanceof Error ? error.message : "プロジェクトコマンドに失敗しました。",
        }),
    });
  }

  function untrust(project: ProjectDto) {
    untrustProject.mutate(project.id, {
      onSuccess: (result) => {
        toast.success("プロジェクトの信頼を解除しました", {
          description: `${result.affectedTaskCount.toLocaleString("ja-JP")}件の有効なタスクに影響します`,
        });
      },
      onError: (error) =>
        toast.error("プロジェクトの信頼を解除できませんでした", {
          description:
            error instanceof Error ? error.message : "プロジェクトコマンドに失敗しました。",
        }),
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="プロジェクト"
        description="スケジュールされた Codex 実行で使用を許可するローカルフォルダとリポジトリを管理します。"
      />

      <section className="grid gap-3 rounded-lg border bg-surface/70 p-4">
        <div>
          <h2 className="text-base font-semibold text-balance">プロジェクトパスを信頼する</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            リポジトリベースのタスクを実行する前に、絶対ローカルパスを追加してください。
          </p>
        </div>
        <form
          className="flex flex-col gap-2 md:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            trust();
          }}
        >
          <Input
            ref={pathInputRef}
            value={path}
            onChange={(event) => setPath(event.currentTarget.value)}
            placeholder="/Users/alice/src/my-app"
            aria-label="プロジェクトパス"
          />
          <Button type="submit" disabled={trustProject.isPending}>
            <Plus className="size-4" aria-hidden="true" />
            パスを信頼
          </Button>
        </form>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
          <div>
            <h2 className="text-base font-semibold text-balance">信頼済みパス</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              スケジュール実行で利用できるプロジェクトが {projectList.length.toLocaleString("ja-JP")} 件あります。
            </p>
          </div>
        </div>

        {projectList.length ? (
          <div className="overflow-x-auto overflow-y-hidden rounded-lg border bg-surface/70">
            <Table className="min-w-[880px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[17rem]">プロジェクト</TableHead>
                  <TableHead>パス</TableHead>
                  <TableHead className="w-[10rem]">信頼</TableHead>
                  <TableHead className="w-[8rem]">有効なタスク</TableHead>
                  <TableHead className="w-[9rem]">既定ブランチ</TableHead>
                  <TableHead className="w-[8rem] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectList.map((project) => {
                  const affectedTaskCount = activeTaskCount(project);
                  return (
                    <TableRow key={project.id}>
                      <TableCell className="min-w-0">
                        <div className="truncate font-medium">{project.name}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{formatProjectKind(project.kind)}</Badge>
                          {project.gitRoot ? <span className="truncate">Git ルート</span> : null}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0">
                        <div
                          className="truncate font-mono text-xs text-muted-foreground"
                          title={project.path}
                        >
                          {project.path}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-1">
                          <TrustBadge trustedAt={project.trustedAt} />
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {project.trustedAt
                              ? formatDateTime(project.trustedAt)
                              : "未信頼"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {affectedTaskCount.toLocaleString("ja-JP")}
                      </TableCell>
                      <TableCell className="truncate">
                        {project.defaultBranch ?? "未設定"}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!project.trustedAt || untrustProject.isPending}
                              aria-label={`${project.name} の信頼を解除`}
                            >
                              信頼を解除
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {project.name} の信頼を解除しますか？
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                スケジュール済みタスクはこのパスを使用できなくなります。信頼を戻すか別の信頼済みプロジェクトへ移すまで、
                                {affectedTaskCount.toLocaleString("ja-JP")} 件の有効なタスクが失敗する可能性があります。ローカルファイルと実行履歴は削除されません。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>信頼を維持</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => untrust(project)}
                              >
                                信頼を解除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            icon={FolderGit2}
            title="信頼済みプロジェクトはありません"
            description="リポジトリベースのスケジュールタスクを作成する前に、ローカルパスを信頼してください。"
            action={{
              label: "プロジェクトパスを追加",
              onClick: () => pathInputRef.current?.focus(),
            }}
          />
        )}
      </section>
    </div>
  );
}
