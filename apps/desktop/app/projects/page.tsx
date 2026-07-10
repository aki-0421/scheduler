"use client";

import {
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  ListChecks,
  SlidersHorizontal,
} from "lucide-react";
import { type MouseEvent, useMemo, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

function ProjectKindIcon({ kind }: { kind: ProjectDto["kind"] }) {
  const Icon = kind === "git" ? GitBranch : Folder;
  return (
    <span
      title={formatProjectKind(kind)}
      className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
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

function folderProjectDisplayName(
  project: ProjectDto,
  localNames: Record<string, string>,
) {
  return localNames[project.id] ?? project.name;
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
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
  const selectedProject = useMemo(
    () => projectList.find((project) => project.id === selectedProjectId),
    [projectList, selectedProjectId],
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
        setSelectedProjectId(null);
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

  async function copyProjectPath(
    project: ProjectDto,
    event?: MouseEvent<HTMLButtonElement>,
  ) {
    event?.stopPropagation();
    try {
      await navigator.clipboard.writeText(project.path);
      toast.success("プロジェクトの場所をコピーしました");
    } catch (error) {
      toast.error("コピーできませんでした", {
        description:
          error instanceof Error
            ? error.message
            : "クリップボードへアクセスできませんでした。",
      });
    }
  }

  function openProjectSettings(project: ProjectDto) {
    setSelectedProjectId(project.id);
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

  function validateProjectDisplayName(project: ProjectDto) {
    const value = folderProjectDisplayName(project, localNames).trim();
    if (!value) {
      updateProjectDisplayName(project.id, project.name);
      toast.error("表示名は空にできません");
      return;
    }
    if (value !== folderProjectDisplayName(project, localNames)) {
      updateProjectDisplayName(project.id, value);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col gap-6">
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

      <section className="flex min-h-0 flex-1 flex-col gap-3">
        {sortedProjects.length ? (
          <div className="overflow-x-auto overflow-y-hidden rounded-lg border bg-surface/70">
            <Table className="min-w-[640px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>プロジェクト</TableHead>
                  <TableHead className="w-[5rem] text-center">
                    フォルダ
                  </TableHead>
                  <TableHead className="w-[8rem]">有効なタスク</TableHead>
                  <TableHead className="w-[9rem]">既定ブランチ</TableHead>
                  <TableHead className="w-[5rem] text-right">設定</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedProjects.map((project) => {
                  const githubName = githubRepositoryName(project.gitRemoteUrl);
                  const affectedTaskCount = activeTaskCount(project);
                  const displayName = projectDisplayName(project, localNames);
                  return (
                    <TableRow
                      key={project.id}
                      className="cursor-pointer"
                      onClick={() => openProjectSettings(project)}
                    >
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <ProjectKindIcon kind={project.kind} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {displayName}
                            </div>
                            {githubName ? (
                              <div className="truncate text-xs text-muted-foreground">
                                GitHub remote
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`${displayName} の場所をコピー`}
                          title="場所をコピー"
                          onClick={(event) => void copyProjectPath(project, event)}
                        >
                          <FolderOpen className="size-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                      <TableCell>
                        <ActiveTaskCountBadge count={affectedTaskCount} />
                      </TableCell>
                      <TableCell className="min-w-0">
                        <BranchBadge branch={project.defaultBranch} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`${displayName} の設定を開く`}
                          title="設定を開く"
                          onClick={(event) => {
                            event.stopPropagation();
                            openProjectSettings(project);
                          }}
                        >
                          <SlidersHorizontal
                            className="size-4"
                            aria-hidden="true"
                          />
                        </Button>
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
            className="flex-1"
            action={{
              label: "プロジェクトを追加",
              onClick: () => void addProjectFromFolder(),
            }}
          />
        )}
      </section>

      <Dialog
        open={Boolean(selectedProject)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedProjectId(null);
          }
        }}
      >
        {selectedProject ? (
          <DialogContent className="max-h-[90dvh] overflow-auto">
            <DialogHeader>
              <DialogTitle>
                {projectDisplayName(selectedProject, localNames)}
              </DialogTitle>
              <DialogDescription className="sr-only">
                プロジェクト設定
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5">
              {githubRepositoryName(selectedProject.gitRemoteUrl) ? (
                <div className="grid gap-1.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    表示名
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                    {projectDisplayName(selectedProject, localNames)}
                  </div>
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <label
                    htmlFor="project-display-name"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    表示名
                  </label>
                  <Input
                    id="project-display-name"
                    value={folderProjectDisplayName(selectedProject, localNames)}
                    onChange={(event) =>
                      updateProjectDisplayName(
                        selectedProject.id,
                        event.currentTarget.value,
                      )
                    }
                    onBlur={() => validateProjectDisplayName(selectedProject)}
                    aria-label={`${selectedProject.name} の表示名`}
                  />
                </div>
              )}

              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    場所
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 text-xs">
                      {selectedProject.path}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="場所をコピー"
                      onClick={() => void copyProjectPath(selectedProject)}
                    >
                      <FolderOpen className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {selectedProject.gitRoot ? (
                  <div className="grid gap-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      Git root
                    </div>
                    <code className="truncate rounded bg-background px-2 py-1.5 text-xs">
                      {selectedProject.gitRoot}
                    </code>
                  </div>
                ) : null}

                {selectedProject.gitRemoteUrl ? (
                  <div className="grid gap-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      Remote
                    </div>
                    <code className="truncate rounded bg-background px-2 py-1.5 text-xs">
                      {selectedProject.gitRemoteUrl}
                    </code>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <ProjectKindBadge kind={selectedProject.kind} />
                <ActiveTaskCountBadge count={activeTaskCount(selectedProject)} />
                <BranchBadge branch={selectedProject.defaultBranch} />
              </div>
            </div>

            <DialogFooter className="items-center justify-between sm:justify-between">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={untrustProject.isPending}
                    aria-label={`${projectDisplayName(
                      selectedProject,
                      localNames,
                    )} を削除`}
                  >
                    削除
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {projectDisplayName(selectedProject, localNames)}{" "}
                      を削除しますか？
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      このプロジェクトを参照するスケジュール済みタスクは実行できなくなる可能性があります。
                      {activeTaskCount(selectedProject).toLocaleString("ja-JP")}{" "}
                      件の有効なタスクに影響します。ローカルファイルと実行履歴は削除されません。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => removeProject(selectedProject)}
                    >
                      削除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
