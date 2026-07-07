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
import { useProjects, useTrustProject } from "@/lib/queries";

export default function ProjectsPage() {
  const [path, setPath] = useState("");
  const projects = useProjects();
  const trustProject = useTrustProject();
  const projectList = projects.data ?? [];

  function trust() {
    const trimmed = path.trim();
    if (!trimmed) {
      toast.error("Enter a project path.");
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
            error instanceof Error ? error.message : "Project command failed.",
        }),
    });
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-balance">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Manage trusted local folders and repositories for scheduled runs.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trust project path</CardTitle>
          <CardDescription>
            Add an absolute path that Codex Scheduler may use for repo-backed tasks.
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
              Trust
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trusted projects</CardTitle>
          <CardDescription>
            {projectList.length.toLocaleString()} trusted path
            {projectList.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projectList.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Default branch</TableHead>
                  <TableHead>Trusted at</TableHead>
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
                    <TableCell>{project.defaultBranch ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatDateTime(project.trustedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={FolderGit2}
              title="No trusted projects"
              description="Trust a local path before creating repository-backed tasks."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
