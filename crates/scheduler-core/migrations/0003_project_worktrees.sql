UPDATE tasks
SET target_mode = 'repo-worktree',
    repo_path = (SELECT git_root FROM projects WHERE projects.id = tasks.project_id)
WHERE target_mode IN ('repo-local', 'repo-worktree')
  AND project_id IN (
    SELECT id
    FROM projects
    WHERE kind = 'git' AND git_root IS NOT NULL AND trim(git_root) <> ''
  );

UPDATE tasks
SET status = 'paused',
    next_run_at = NULL,
    schedule_status = 'invalid',
    schedule_error = 'project target requires a registered Git project and isolated worktree'
WHERE target_mode = 'repo-local'
   OR (
     target_mode = 'repo-worktree'
     AND (
       project_id IS NULL
       OR project_id NOT IN (
         SELECT id
         FROM projects
         WHERE kind = 'git' AND git_root IS NOT NULL AND trim(git_root) <> ''
       )
     )
   );

PRAGMA user_version = 3;
