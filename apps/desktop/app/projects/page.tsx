"use client";

import { FolderGit2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
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
import { useProjects, useTasks, useTrustProject } from "@/lib/queries";
import type { ProjectDto } from "@/lib/types";

export default function ProjectsPage() {
  const [path, setPath] = useState("");
  const projects = useProjects();
  const tasks = useTasks();
  const trustProject = useTrustProject();
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

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-balance">プロジェクト</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          スケジュール実行で使うローカルフォルダーとリポジトリの信頼状態を管理します。
        </p>
      </div>

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
                  <TableHead>kind</TableHead>
                  <TableHead>パス</TableHead>
                  <TableHead>active タスク</TableHead>
                  <TableHead>default branch</TableHead>
                  <TableHead>信頼日時</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectList.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium">{project.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{project.kind}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xl truncate font-mono text-xs">
                      {project.path}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {activeTaskCount(project)}
                    </TableCell>
                    <TableCell>{project.defaultBranch ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatDateTime(project.trustedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* TODO: Enable untrust when a project_untrust IPC command exists. */}
                      <Button variant="outline" size="sm" disabled>
                        信頼解除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
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
