"use client";

import { useRouter } from "next/navigation";

import { TaskWizard } from "@/components/task-wizard";
import type { TaskDto } from "@/lib/types";

export default function NewTaskPage() {
  const router = useRouter();

  function handleSaved(task: TaskDto) {
    router.push(`/tasks?task=${task.id}`);
  }

  return <TaskWizard onSaved={handleSaved} cancelHref="/tasks" />;
}
