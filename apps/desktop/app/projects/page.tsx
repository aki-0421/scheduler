"use client";

import { FolderGit2, Plus } from "lucide-react";
import { useState } from "react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  return kind === "git" ? "Git" : "フォルダー";
}

export default function ProjectsPage() {
  const [path, setPath] = useState("");
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
      return;
    }

    trustProject.mutate(trimmed, {
      onSuccess: () => {
        setPath("");
        toast.success("プロジェクトを信頼しました");
      },
      onError: (error) =>
        toast.error("プロジェクトを信頼できませんでした", {
          description:
            error instanceof Error ? error.message : "プロジェクトコマンドに失敗しました。",
        }),
    });
  }

  function untrust(project: ProjectDto) {
    untrustProject.mutate(project.id, {
      onSuccess: (result) => {
        toast.success("プロジェクトの信頼を解除しました", {
          description: `影響タスク ${result.affectedTaskCount.toLocaleString("ja-JP")} 件`,
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
    <div className="grid gap-5">
      <PageHeader
        title="プロジェクト"
        description="スケジュール実行で使うローカルフォルダーとリポジトリの信頼状態を管理します。"
      />

      <Card>
        <CardHeader>
          <CardTitle>プロジェクトパスを信頼</CardTitle>
          <CardDescription>
            リポジトリ付きタスクで Codex Scheduler が使用できる絶対パスを追加します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              value={path}
              onChange={(event) => setPath(event.currentTarget.value)}
              placeholder="/Users/alice/src/my-app"
            />
            <Button disabled={trustProject.isPending} onClick={trust}>
              <Plus className="size-4" aria-hidden="true" />
              信頼
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>プロジェクト一覧</CardTitle>
          <CardDescription>
            {projectList.length.toLocaleString("ja-JP")} 件のプロジェクト
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projectList.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名前</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>パス</TableHead>
                  <TableHead>有効タスク</TableHead>
                  <TableHead>既定 branch</TableHead>
                  <TableHead>信頼状態</TableHead>
                  <TableHead>信頼日時</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectList.map((project) => {
                  const affectedTaskCount = activeTaskCount(project);
                  return (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">{project.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{formatProjectKind(project.kind)}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xl truncate font-mono text-xs">
                        {project.path}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {affectedTaskCount.toLocaleString("ja-JP")}
                      </TableCell>
                      <TableCell>{project.defaultBranch ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={project.trustedAt ? "success" : "warning"}>
                          {project.trustedAt ? "信頼済み" : "未信頼"}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateTime(project.trustedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!project.trustedAt || untrustProject.isPending}
                            >
                              信頼解除
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                プロジェクトの信頼を解除しますか？
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                このプロジェクトを信頼解除すると、参照中のタスクは実行時に失敗します
                                （影響タスク {affectedTaskCount.toLocaleString("ja-JP")} 件）。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>キャンセル</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => untrust(project)}
                              >
                                信頼解除
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
          ) : (
            <EmptyState
              icon={FolderGit2}
              title="プロジェクトはまだありません"
              description="リポジトリ付きタスクを作成する前に、ローカルパスを信頼してください。"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
