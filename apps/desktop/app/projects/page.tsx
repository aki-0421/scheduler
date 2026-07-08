"use client";

import {
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  ListChecks,
  Pencil,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ValueBadge } from "@/components/value-badge";
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
import { ipcClient } from "@/lib/ipc";
import {
  useProjects,
  useTasks,
  useTrustProject,
  useUntrustProject,
} from "@/lib/queries";
import type { ProjectDto } from "@/lib/types";

const PROJECT_NAME_STORAGE_KEY = "codex-scheduler.project-display-names";

function formatProjectKind(kind: ProjectDto["kind"]) {
  return kind === "git" ? "Git" : "フォルダ";
}

function ProjectKindBadge({ kind }: { kind: ProjectDto["kind"] }) {
  const isGit = kind === "git";
  return (
    <ValueBadge
      icon={isGit ? GitBranch : Folder}
      label={formatProjectKind(kind)}
      variant={isGit ? "info" : "muted"}
    />
  );
}

function ActiveTaskCountBadge({ count }: { count: number }) {
  return (
    <ValueBadge
      icon={ListChecks}
      label={count.toLocaleString("ja-JP")}
      variant={count > 0 ? "success" : "muted"}
      title={`${count.toLocaleString("ja-JP")} 件の有効なタスク`}
      className="justify-center"
    />
  );
}

function BranchBadge({ branch }: { branch?: string }) {
  return (
    <ValueBadge
      icon={GitBranch}
      label={branch ?? "未設定"}
      variant={branch ? "outline" : "muted"}
      title={branch ? `既定ブランチ ${branch}` : "既定ブランチ未設定"}
      className="max-w-full"
    />
  );
}

function githubRepositoryName(remoteUrl?: string) {
  if (!remoteUrl) {
    return undefined;
  }
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) {
    return undefined;
  }
  return `${match[1]}/${match[2]}`;
}

function projectDisplayName(
  project: ProjectDto,
  localNames: Record<string, string>,
) {
  return (
    githubRepositoryName(project.gitRemoteUrl) ??
    localNames[project.id] ??
    project.name
  );
}

export default function ProjectsPage() {
  const [localNames, setLocalNames] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") {
      return {};
    }
    try {
      return JSON.parse(
        window.localStorage.getItem(PROJECT_NAME_STORAGE_KEY) ?? "{}",
      ) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const projects = useProjects();
  const tasks = useTasks();
  const trustProject = useTrustProject();
  const untrustProject = useUntrustProject();
  const projectList = useMemo(() => projects.data ?? [], [projects.data]);
  const taskList = tasks.data ?? [];
  const sortedProjects = useMemo(
    () =>
      projectList
        .slice()
        .sort((left, right) =>
          projectDisplayName(left, localNames).localeCompare(
            projectDisplayName(right, localNames),
            "ja-JP",
          ),
        ),
    [localNames, projectList],
  );

  function activeTaskCount(project: ProjectDto) {
    return taskList.filter(
      (task) =>
        task.status === "active" &&
        (task.target.projectId === project.id ||
          task.target.repoPath === project.path ||
          task.target.repoPath === project.gitRoot),
    ).length;
  }

  async function addProjectFromFolder() {
    setIsPickingFolder(true);
    try {
      const selectedPath = await ipcClient.projectPickFolder();
      if (!selectedPath) {
        return;
      }
      trustProject.mutate(selectedPath, {
        onSuccess: () => toast.success("プロジェクトを追加しました"),
        onError: (error) =>
          toast.error("プロジェクトを追加できませんでした", {
            description:
              error instanceof Error
                ? error.message
                : "プロジェクトコマンドに失敗しました。",
          }),
      });
    } catch (error) {
      toast.error("フォルダを選択できませんでした", {
        description:
          error instanceof Error
            ? error.message
            : "ファイルブラウザを開けませんでした。",
      });
    } finally {
      setIsPickingFolder(false);
    }
  }

  function removeProject(project: ProjectDto) {
    untrustProject.mutate(project.id, {
      onSuccess: (result) => {
        toast.success("プロジェクトを削除しました", {
          description: `${result.affectedTaskCount.toLocaleString("ja-JP")}件の有効なタスクに影響します`,
        });
      },
      onError: (error) =>
        toast.error("プロジェクトを削除できませんでした", {
          description:
            error instanceof Error
              ? error.message
              : "プロジェクトコマンドに失敗しました。",
        }),
    });
  }

  function updateProjectDisplayName(projectId: string, value: string) {
    setLocalNames((current) => {
      const next = { ...current, [projectId]: value };
      window.localStorage.setItem(
        PROJECT_NAME_STORAGE_KEY,
        JSON.stringify(next),
      );
      return next;
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="プロジェクト"
        description="スケジュールされた Codex 実行で使うローカルフォルダとリポジトリを管理します。"
        actions={
          <Button
            type="button"
            disabled={isPickingFolder || trustProject.isPending}
            onClick={() => void addProjectFromFolder()}
          >
            <FolderOpen className="size-4" aria-hidden="true" />
            プロジェクトを追加
          </Button>
        }
      />

      <section className="grid gap-3">
        {sortedProjects.length ? (
          <div className="overflow-x-auto overflow-y-hidden rounded-lg border bg-surface/70">
            <Table className="min-w-[860px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[18rem]">プロジェクト</TableHead>
                  <TableHead>場所</TableHead>
                  <TableHead className="w-[8rem]">種類</TableHead>
                  <TableHead className="w-[8rem]">有効なタスク</TableHead>
                  <TableHead className="w-[9rem]">既定ブランチ</TableHead>
                  <TableHead className="w-[8rem] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedProjects.map((project) => {
                  const githubName = githubRepositoryName(project.gitRemoteUrl);
                  const affectedTaskCount = activeTaskCount(project);
                  const displayName = projectDisplayName(project, localNames);
                  return (
                    <TableRow key={project.id}>
                      <TableCell className="min-w-0">
                        {githubName ? (
                          <div className="truncate font-medium">
                            {displayName}
                          </div>
                        ) : (
                          <div className="flex min-w-0 items-center gap-2">
                            <Pencil
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <Input
                              value={displayName}
                              onChange={(event) =>
                                updateProjectDisplayName(
                                  project.id,
                                  event.currentTarget.value,
                                )
                              }
                              onBlur={() =>
                                toast.success("表示名を更新しました")
                              }
                              aria-label={`${project.name} の表示名`}
                              className="h-8"
                            />
                          </div>
                        )}
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
                        <ProjectKindBadge kind={project.kind} />
                      </TableCell>
                      <TableCell>
                        <ActiveTaskCountBadge count={affectedTaskCount} />
                      </TableCell>
                      <TableCell className="min-w-0">
                        <BranchBadge branch={project.defaultBranch} />
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={untrustProject.isPending}
                              aria-label={`${displayName} を削除`}
                            >
                              削除
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {displayName} を削除しますか？
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                このプロジェクトを参照するスケジュール済みタスクは実行できなくなる可能性があります。
                                {affectedTaskCount.toLocaleString("ja-JP")}{" "}
                                件の有効なタスクに影響します。ローカルファイルと実行履歴は削除されません。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>キャンセル</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => removeProject(project)}
                              >
                                削除
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
            title="プロジェクトがまだありません"
            description="Codex に任せるローカルフォルダまたはリポジトリを追加してください。"
            action={{
              label: "プロジェクトを追加",
              onClick: () => void addProjectFromFolder(),
            }}
          />
        )}
      </section>
    </div>
  );
}
