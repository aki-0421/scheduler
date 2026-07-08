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
  return kind === "git" ? "Git" : "Folder";
}

function TrustBadge({ trustedAt }: { trustedAt?: string }) {
  return (
    <Badge variant={trustedAt ? "success" : "warning"}>
      {trustedAt ? "Trusted" : "Untrusted"}
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
      toast.error("Enter a project path.");
      pathInputRef.current?.focus();
      return;
    }

    trustProject.mutate(trimmed, {
      onSuccess: () => {
        setPath("");
        toast.success("Project trusted");
      },
      onError: (error) =>
        toast.error("Could not trust project", {
          description:
            error instanceof Error ? error.message : "The project command failed.",
        }),
    });
  }

  function untrust(project: ProjectDto) {
    untrustProject.mutate(project.id, {
      onSuccess: (result) => {
        toast.success("Project trust removed", {
          description: `${result.affectedTaskCount.toLocaleString("en-US")} affected active tasks`,
        });
      },
      onError: (error) =>
        toast.error("Could not remove project trust", {
          description:
            error instanceof Error ? error.message : "The project command failed.",
        }),
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Projects"
        description="Manage the local folders and repositories that scheduled Codex runs are allowed to use."
      />

      <section className="grid gap-3 rounded-lg border bg-surface/70 p-4">
        <div>
          <h2 className="text-base font-semibold text-balance">Trust a project path</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Add an absolute local path before repository-based tasks can run against it.
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
            aria-label="Project path"
          />
          <Button type="submit" disabled={trustProject.isPending}>
            <Plus className="size-4" aria-hidden="true" />
            Trust path
          </Button>
        </form>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
          <div>
            <h2 className="text-base font-semibold text-balance">Trusted paths</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {projectList.length.toLocaleString("en-US")}{" "}
              {projectList.length === 1 ? "project" : "projects"} available for scheduled runs.
            </p>
          </div>
        </div>

        {projectList.length ? (
          <div className="overflow-hidden rounded-lg border bg-surface/70">
            <Table className="min-w-[880px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[17rem]">Project</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead className="w-[10rem]">Trust</TableHead>
                  <TableHead className="w-[8rem]">Active tasks</TableHead>
                  <TableHead className="w-[9rem]">Default branch</TableHead>
                  <TableHead className="w-[8rem] text-right">Actions</TableHead>
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
                          {project.gitRoot ? <span className="truncate">Git root</span> : null}
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
                              : "Not trusted"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {affectedTaskCount.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="truncate">
                        {project.defaultBranch ?? "Not set"}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!project.trustedAt || untrustProject.isPending}
                              aria-label={`Remove trust for ${project.name}`}
                            >
                              Remove trust
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Remove trust for {project.name}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Scheduled tasks will no longer be allowed to use this path.{" "}
                                {affectedTaskCount.toLocaleString("en-US")} active{" "}
                                {affectedTaskCount === 1 ? "task" : "tasks"} may fail until
                                you trust the path again or move them to another trusted
                                project. Local files and run history are not deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep trusted</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => untrust(project)}
                              >
                                Remove trust
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
            title="No trusted projects"
            description="Trust a local path before creating repository-based scheduled tasks."
            action={{
              label: "Add a project path",
              onClick: () => pathInputRef.current?.focus(),
            }}
          />
        )}
      </section>
    </div>
  );
}
