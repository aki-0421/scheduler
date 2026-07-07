"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { ipcClient } from "@/lib/ipc";
import {
  defaultSettings,
  settingsToRecord,
  type RunStatus,
  type SchedulerSettings,
  type SettingDto,
  type TaskDto,
  type TaskStatus,
} from "@/lib/types";

type SettingMutationInput = {
  key: keyof SchedulerSettings;
  value: SchedulerSettings[keyof SchedulerSettings];
};

export const queryKeys = {
  health: ["health"] as const,
  tasks: (status?: TaskStatus) => ["tasks", status ?? "all"] as const,
  task: (id?: string) => ["task", id ?? "none"] as const,
  runs: (filter?: { taskId?: string; status?: RunStatus }) =>
    ["runs", filter?.taskId ?? "all", filter?.status ?? "all"] as const,
  run: (id?: string) => ["run", id ?? "none"] as const,
  projects: ["projects"] as const,
  settings: ["settings"] as const,
};

function invalidateSchedulerData(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  void queryClient.invalidateQueries({ queryKey: ["task"] });
  void queryClient.invalidateQueries({ queryKey: ["runs"] });
  void queryClient.invalidateQueries({ queryKey: ["run"] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.health });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => ipcClient.daemonHealth(),
    refetchInterval: 5_000,
  });
}

export function useTasks(status?: TaskStatus) {
  return useQuery({
    queryKey: queryKeys.tasks(status),
    queryFn: () => ipcClient.taskList(status ? { status } : undefined),
  });
}

export function useTask(id?: string) {
  return useQuery({
    queryKey: queryKeys.task(id),
    queryFn: () => ipcClient.taskGet(id ?? ""),
    enabled: Boolean(id),
  });
}

export function useRuns(filter?: { taskId?: string; status?: RunStatus }) {
  return useQuery({
    queryKey: queryKeys.runs(filter),
    queryFn: () => ipcClient.runList(filter),
  });
}

export function useRun(id?: string) {
  return useQuery({
    queryKey: queryKeys.run(id),
    queryFn: () => ipcClient.runGet(id ?? ""),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" || status === "starting"
        ? 3_000
        : false;
    },
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => ipcClient.projectList(),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => settingsToRecord(await ipcClient.settingsGet()),
    initialData: defaultSettings,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: TaskDto) => ipcClient.taskCreate(task),
    onSuccess: () => invalidateSchedulerData(queryClient),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: TaskDto) => ipcClient.taskUpdate(task),
    onSuccess: (task) => {
      invalidateSchedulerData(queryClient);
      queryClient.setQueryData(queryKeys.task(task.id), task);
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipcClient.taskDelete(id),
    onSuccess: () => invalidateSchedulerData(queryClient),
  });
}

export function usePauseTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipcClient.taskPause(id),
    onSuccess: (task) => {
      invalidateSchedulerData(queryClient);
      queryClient.setQueryData(queryKeys.task(task.id), task);
    },
  });
}

export function useResumeTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipcClient.taskResume(id),
    onSuccess: (task) => {
      invalidateSchedulerData(queryClient);
      queryClient.setQueryData(queryKeys.task(task.id), task);
    },
  });
}

export function useRunTaskNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipcClient.taskRunNow(id),
    onSuccess: (run) => {
      invalidateSchedulerData(queryClient);
      queryClient.setQueryData(queryKeys.run(run.id), run);
    },
  });
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipcClient.runCancel(id),
    onSuccess: (run) => {
      invalidateSchedulerData(queryClient);
      queryClient.setQueryData(queryKeys.run(run.id), run);
    },
  });
}

export function useTrustProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => ipcClient.projectTrust(path),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

export function useSetSetting() {
  const queryClient = useQueryClient();
  return useMutation<SettingDto, Error, SettingMutationInput, { previous?: SchedulerSettings }>({
    mutationFn: (input) =>
      ipcClient.settingsSet(
        input.key,
        input.value as SchedulerSettings[typeof input.key],
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings });
      const previous = queryClient.getQueryData<SchedulerSettings>(queryKeys.settings);
      queryClient.setQueryData<SchedulerSettings>(queryKeys.settings, {
        ...(previous ?? defaultSettings),
        [input.key]: input.value,
      });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.settings, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
    },
  });
}
