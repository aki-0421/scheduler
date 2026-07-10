---
title: データモデル
description: Codex Scheduler の現在の SQLite entity、DTO contract、enum、setting、retention record を定義する。
updated: 2026-07-10
read_when:
  - migration、scheduler-core model、IPC DTO、frontend schema、setting、retention behavior を変更するとき。
  - 永続化された task、run、project、audit、token state を debug するとき。
---

# データモデル

schema version は `6` である。SQLite は database constraint 付きの textual enum value を保存し、Rust / TypeScript は強く validate された DTO と Zod schema を通じて同じ値を公開する。

## 主要エンティティ

`projects` は scheduler task の実行先としてユーザーが追加した Git repository を記録する。project は stable ID、display name、canonical path、`git` kind、Git root、任意の remote URL、任意の GitHub owner/repository display、default branch、timestamp を含む。daemon は選択 directory から Git root を検出できない場合に登録を拒否する。default branch が未設定なら `origin/main`、`origin/master`、local `main`、local `master` の順に検出して保存する。`folder` kind は既存 database の読み取り互換にだけ残し、新規登録や task target には使わない。

`tasks` は scheduled work を記録する。task は identity、schedule kind and state、prompt、target、Codex configuration、固定 execution profile、lock state、creator metadata、soft-delete metadata を保存する。既存 schema との互換用 policy column は残すが、public contract には公開せず固定値だけを保存する。

`runs` は 1 回の execution attempt を記録する。run は task ID、trigger type、scheduled time、attempt number、status、queue / start / end timestamp、duration、target mode、workspace / worktree / branch / base information、Git snapshot、command metadata、process metadata、log path、output tail、summary、findings count、created schedule count、timestamp を保存する。

`run_events` は daemon、Codex JSONL stdout、stdout、stderr から得た structured progress event を記録する。各 event は run 内の `event_index` で順序付けられる。

`run_artifacts` は run が生成または参照した file、diff、patch、log、last message、worktree を記録する。

`task_audit_events` は actor type、action、任意の before / after JSON、reason、timestamp とともに task / project mutation を記録する。

`schedule_capability_tokens` は、scheduled Codex session がすべての scheduler action を実行できるようにする hashed run-scoped token を記録する。token は run-scoped であり、schedule 作成数は制限しない。

`settings` は key ごとに JSON value を保存する。

## Task contract

Task DTO は camelCase field を使う。

- `id`, `slug`, `name`, `status`
- `kind`: `manual`, `once`, `cron`
- `cronExpr`, `runAt`, `timezone`, `nextRunAt`
- `target`: `chat` または `repo-worktree` mode、Git project ID、repository path、base ref。project target は登録済み Git project ID を必須とする。
- `codex`: model、reasoning effort。Codex binary path は task contract に含めず、global setting だけで管理する。
- `prompt`: prompt body
- `locked`: CLI / scheduled-run actor による edit、delete、pause、resume を拒否し、desktop UI の user actor は制限しない user-controlled lock flag

DTO が stored task になるとき、空の ID は generated task ID に置き換えられ、prompt hash は prompt body から計算される。execution profile は入力値ではなく次の app-wide invariant を受け取る。

- sandbox: `danger-full-access`
- approval policy: `never`
- scheduler instruction injection と Scheduler CLI access: 常に有効
- schedule capabilities: `schedule:create`, `schedule:update-current`, `schedule:update-any`, `schedule:pause-current`, `schedule:run-now`, `schedule:list`
- max created schedules per run: 無制限。DB と token では `0` を unlimited sentinel とする。
- missed-run policy: `skip`
- overlap policy: `skip`
- max runtime: 無制限。DB では `0` を no-timeout sentinel とする。
- automatic retries: `0`
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

共有 enum vocabulary は次のとおり。sandbox、approval、missed-run、overlap、cleanup の複数値は既存 DB の読み取り互換用であり、新規 task は前述の app-wide invariant だけを保存する。

- Task kinds: `manual`, `once`, `cron`
- Task statuses: `active`, `paused`, `completed`, `deleted`
- Schedule statuses: `valid`, `invalid`
- Trigger types: 新規 run は `schedule`, `manual`, `cli`, `catchup`。`retry` は既存 run history の読み取り互換にだけ残す。
- Run statuses: `queued`, `starting`, `running`, `succeeded`, `failed`, `canceled`, `skipped`, `interrupted`, `timed_out`
- Target modes: 新規・更新可能な値は `chat`, `repo-worktree`。`repo-local` は既存 database と run history の読み取り互換にだけ残す。
- Sandbox modes: `read-only`, `workspace-write`, `danger-full-access`
- Approval policies: `never`, `on-request`, `untrusted`
- Missed-run policies: `skip`, `latest_within_window`, `run_all_capped`
- Overlap policies: `skip`, `queue`, `cancel_previous`
- Cleanup policies: `keep`, `delete_on_success`, `delete_after_days`
- Project kinds: 新規登録可能な値は `git`。`folder` は既存 database の読み取り互換にだけ残す。
- Run event sources: `daemon`, `codex-jsonl`, `stdout`, `stderr`
- Run artifact kinds: `file`, `diff`, `patch`, `log`, `last-message`, `worktree`
- Audit actor types: `user`, `daemon`, `cli`, `scheduled-run`

schema version 3 migration は、Git project に紐づく既存 `repo-local` task を `repo-worktree` へ変換し、既存 `repo-worktree` task を含む project target の `repo_path` を登録済み Git root に正規化する。有効な Git project に紐づかない project target は自動実行を防ぐため pause し、invalid schedule reason を保存する。

schema version 4 migration は `tasks.description` と既存 task audit snapshot の top-level `description` key を削除する。task の内容は `name` と `prompt.body` を唯一の source of truth とし、Task DTO、desktop schema、daemon RPC、CLI は task description field を公開しない。

schema version 5 migration は `tasks.codex_path` を追加する。既存 task の execution profile を app-wide invariant へ正規化し、active capability token の作成数上限を unlimited sentinel へ変更する。task audit snapshot から旧 `codex.sandboxMode`、`codex.approvalPolicy`、`prompt.injectSchedulerInstructions`、`policies` を削除し、obsolete な sandbox / approval / cleanup default setting を削除する。

schema version 6 migration は obsolete になった `tasks.codex_path` column と task audit snapshot の `codex.codexPath` key を削除する。Codex binary path は `runner.codex_path` setting を唯一の persisted source とし、すべての task に共通適用する。

## Lock behavior

task lock は task 自体の persisted boolean として保存する。lock は user-facing safety control であり、AI が `codex-schedule` または scheduled-run capability token を使ってタスクを削除・編集・停止できないようにする。

lock が有効な task に対し、actor type が `cli` または `scheduled-run` の場合、daemon は次を拒否する。

- task update
- task delete
- task pause
- task resume

desktop UI の user actor は unlock せずに変更できる。lock / unlock は `task_audit_events` に記録し、before / after JSON に lock state を含める。

## Settings

Rust settings module は次の persisted key を定義する。

- `scheduler.enabled`
- `runner.codex_path`
- `retention.run_history_days`
- `retention.succeeded_run_logs_days`
- `retention.failed_run_logs_days`
- `retention.capability_token_delete_after_hours`

migration は retention setting を seed する。frontend はさらに `daemon.global_concurrency`、`runner.default_model`、`notifications.enabled` の default を理解する。`runner.codex_path` は全 task 共通で、task 固有 override は持たない。値がないか `codex` の場合は `PATH` lookup を使い、それ以外の custom path は Settings の global customization から保存する。sandbox、approval policy、worktree cleanup の setting は持たない。

## Retention default

実装済みの retention default は次のとおり。

- Run history: `90` days。
- Succeeded run logs: `30` days。
- Failed run logs: `180` days。
- Expired capability token deletion: `24` hours。
- Worktree は task execution 後も保持する。
