---
title: データモデル
description: Codex Scheduler の現在の SQLite entity、DTO contract、enum、setting、retention record を定義する。
updated: 2026-07-08
read_when:
  - migration、scheduler-core model、IPC DTO、frontend schema、setting、retention behavior を変更するとき。
  - 永続化された task、run、project、audit、token state を debug するとき。
---

# データモデル

schema version は `2` である。SQLite は database constraint 付きの textual enum value を保存し、Rust / TypeScript は強く validate された DTO と Zod schema を通じて同じ値を公開する。

## 主要エンティティ

`projects` は scheduler task の実行先としてユーザーが追加した local folder または Git repository を記録する。project は stable ID、display name、canonical path、`git` または `folder` kind、任意の Git root、任意の remote URL、任意の GitHub owner/repository display、任意の default branch、timestamp を含む。project は追加された時点でユーザーが編集を許可した scope とみなし、UI と DTO は `Trusted Project` という別状態を持たない。

`tasks` は scheduled work を記録する。task は identity、schedule kind and state、prompt、target、Codex configuration、scheduler CLI permission、missed / overlap / retry / runtime / cleanup policy、lock state、creator metadata、soft-delete metadata を保存する。

`runs` は 1 回の execution attempt を記録する。run は task ID、trigger type、scheduled time、attempt number、status、queue / start / end timestamp、duration、target mode、workspace / worktree / branch / base information、Git snapshot、command metadata、process metadata、log path、output tail、summary、findings count、created schedule count、timestamp を保存する。

`run_events` は daemon、Codex JSONL stdout、stdout、stderr から得た structured progress event を記録する。各 event は run 内の `event_index` で順序付けられる。

`run_artifacts` は run が生成または参照した file、diff、patch、log、last message、worktree を記録する。

`task_audit_events` は actor type、action、任意の before / after JSON、reason、timestamp とともに task / project mutation を記録する。

`schedule_capability_tokens` は、scheduled Codex session が bounded capability set と create count の範囲内で schedule を作成または更新できるようにする hashed run-scoped token を記録する。

`settings` は key ごとに JSON value を保存する。

## Task contract

Task DTO は camelCase field を使う。

- `id`, `slug`, `name`, `description`, `status`
- `kind`: `manual`, `once`, `cron`
- `cronExpr`, `runAt`, `timezone`, `nextRunAt`
- `target`: target mode、project ID、repository path、base ref
- `codex`: model、reasoning effort、sandbox mode、approval policy
- `prompt`: prompt body、scheduler-instruction injection flag
- `policies`: schedule CLI access、missed-run policy、overlap policy、runtime limit、create limit、capability list、retry setting、cleanup setting
- `locked`: AI / scheduled-run actor による edit、delete、pause、resume を拒否する user-controlled lock flag

DTO が stored task になるとき、空の ID は generated task ID に置き換えられ、prompt hash は prompt body から計算され、省略された policy field は implementation default を受け取る。

- schedule capabilities: `schedule:create`, `schedule:update-current`, `schedule:list`
- max created schedules per run: `5`、`1..=100` に clamp
- missed window: `7` days
- retries: `0`
- retry backoff: `300` seconds
- cleanup policy: `keep`

## Run contract

Run DTO は UI が使う run lifecycle と inspection data を公開する。

- trigger、schedule、attempt、status、status reason
- queue / start / end timestamp と duration
- target / workspace / worktree / branch / base data
- process exit code、signal、Codex session ID
- stdout / stderr / events / last-message path
- stdout / stderr tail と result summary
- findings と created-schedule counter
- single run を load するときの artifact list

Run history は start、schedule、queue timestamp で sort できる。active status は `queued`、`starting`、`running` であり、terminal status には `succeeded`、`failed`、`canceled`、`skipped`、`interrupted`、`timed_out` が含まれる。

## Enum

共有 enum vocabulary は次のとおり。

- Task kinds: `manual`, `once`, `cron`
- Task statuses: `active`, `paused`, `completed`, `deleted`
- Schedule statuses: `valid`, `invalid`
- Trigger types: `schedule`, `manual`, `cli`, `catchup`, `retry`
- Run statuses: `queued`, `starting`, `running`, `succeeded`, `failed`, `canceled`, `skipped`, `interrupted`, `timed_out`
- Target modes: `chat`, `repo-local`, `repo-worktree`
- Sandbox modes: `read-only`, `workspace-write`, `danger-full-access`
- Approval policies: `never`, `on-request`, `untrusted`
- Missed-run policies: `skip`, `latest_within_window`, `run_all_capped`
- Overlap policies: `skip`, `queue`, `cancel_previous`
- Cleanup policies: `keep`, `delete_on_success`, `delete_after_days`
- Project kinds: `git`, `folder`
- Run event sources: `daemon`, `codex-jsonl`, `stdout`, `stderr`
- Run artifact kinds: `file`, `diff`, `patch`, `log`, `last-message`, `worktree`
- Audit actor types: `user`, `daemon`, `cli`, `scheduled-run`

## Lock behavior

task lock は task 自体の persisted boolean として保存する。lock は user-facing safety control であり、AI が `codex-schedule` または scheduled-run capability token を使ってタスクを削除・編集・停止できないようにする。

lock が有効な task に対し、actor type が `scheduled-run` または AI-originated CLI action の場合、daemon は次を拒否する。

- task update
- task delete
- task pause
- task resume

user actor は UI から unlock してから変更できる。lock / unlock は `task_audit_events` に記録し、before / after JSON に lock state を含める。

## Settings

Rust settings module は次の persisted key を定義する。

- `scheduler.enabled`
- `runner.codex_path`
- `retention.run_history_days`
- `retention.succeeded_run_logs_days`
- `retention.failed_run_logs_days`
- `retention.capability_token_delete_after_hours`

migration は retention setting と `worktree.default_cleanup_policy` を seed する。frontend はさらに `daemon.global_concurrency`、`runner.default_model`、`runner.default_sandbox_mode`、`runner.default_approval_policy`、`notifications.enabled`、`worktree.default_cleanup_policy` の default を理解する。

## Retention default

実装済みの retention default は次のとおり。

- Run history: `90` days。
- Succeeded run logs: `30` days。
- Failed run logs: `180` days。
- Expired capability token deletion: `24` hours。
- Worktree cleanup default: `keep`。
