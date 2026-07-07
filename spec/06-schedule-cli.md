# `codex-schedule` CLI 仕様

## 1. 目的

`codex-schedule` は、人間ユーザーと scheduled Codex セッションの両方がタスクを管理するための CLI である。特に、Codex セッション内から follow-up タスクを作成・更新できることを重視する。

## 2. 基本設計

- すべての command は非対話で完結できる。
- `--json` を付けると機械可読 JSON を返す。
- prompt は `--prompt` または `--prompt-file` で指定する。
- schedule は `--at`、`--cron`、`--manual` のいずれかで指定する。
- target は `--chat`、`--repo PATH`、`--worktree` で指定する。
- scheduled run 内では `CODEX_SCHEDULER_RUN_TOKEN` を自動使用する。

## 3. コマンド一覧

```text
codex-schedule create
codex-schedule update
codex-schedule update-current
codex-schedule list
codex-schedule show
codex-schedule pause
codex-schedule resume
codex-schedule delete
codex-schedule run-now
codex-schedule history
codex-schedule next
codex-schedule validate-cron
codex-schedule doctor
```

## 4. `create`

### 4.1 単発タスク

```bash
codex-schedule create \
  --name "check deploy" \
  --at "2026-07-08T15:00:00+09:00" \
  --chat \
  --prompt "Check whether the deploy finished and summarize next actions." \
  --json
```

Response:

```json
{
  "ok": true,
  "task": {
    "id": "task_01J...",
    "slug": "check-deploy",
    "kind": "once",
    "status": "active",
    "nextRunAt": "2026-07-08T06:00:00Z"
  }
}
```

### 4.2 cron タスク

```bash
codex-schedule create \
  --name "daily PR review" \
  --cron "0 9 * * 1-5" \
  --timezone "Asia/Tokyo" \
  --repo "/Users/alice/src/my-app" \
  --worktree \
  --prompt-file ./prompts/daily-pr-review.md \
  --model "gpt-5-codex" \
  --sandbox workspace-write \
  --json
```

### 4.3 manual タスク

```bash
codex-schedule create \
  --name "release note draft" \
  --manual \
  --repo "/Users/alice/src/my-app" \
  --worktree \
  --prompt "Draft release notes from commits since last tag." \
  --json
```

## 5. `update`

```bash
codex-schedule update task_01J... \
  --cron "*/30 * * * *" \
  --prompt-file ./prompts/new.md \
  --json
```

Patch semantics:

- 指定された field のみ変更。
- schedule を変更したら `next_run_at` を即再計算。
- `--clear-run-at`、`--clear-cron` のような明示 clear flag を用意する。

## 6. `update-current`

Scheduled run 内で現在のタスクを変更する専用 command。

### 6.1 現在タスクを明日 9 時へ変更

```bash
codex-schedule update-current \
  --at "2026-07-08T09:00:00+09:00" \
  --reason "Need to re-check after today's release window" \
  --json
```

### 6.2 現在タスクを一時停止

```bash
codex-schedule update-current \
  --pause \
  --reason "No further follow-up required" \
  --json
```

### 6.3 権限

`CODEX_SCHEDULER_RUN_TOKEN` に `schedule:update-current` capability が必要。

## 7. `list`

```bash
codex-schedule list --status active --json
```

Response:

```json
{
  "ok": true,
  "tasks": [
    {
      "id": "task_01J...",
      "name": "daily PR review",
      "kind": "cron",
      "status": "active",
      "nextRunAt": "2026-07-08T00:00:00Z"
    }
  ]
}
```

## 8. `next`

cron や task の次回実行予定を確認する。

```bash
codex-schedule next --cron "*/15 * * * *" --timezone "Asia/Tokyo" --count 5 --json
```

Response:

```json
{
  "ok": true,
  "times": [
    "2026-07-07T12:15:00+09:00",
    "2026-07-07T12:30:00+09:00",
    "2026-07-07T12:45:00+09:00",
    "2026-07-07T13:00:00+09:00",
    "2026-07-07T13:15:00+09:00"
  ]
}
```

## 9. `run-now`

```bash
codex-schedule run-now task_01J... --json
```

Response:

```json
{
  "ok": true,
  "run": {
    "id": "run_01J...",
    "status": "queued"
  }
}
```

## 10. Common flags

```text
--json                         JSON output
--name TEXT                    task name
--description TEXT             task description
--prompt TEXT                  prompt body
--prompt-file PATH             prompt body file
--at RFC3339                   one-off timestamp
--cron EXPR                    5-field cron expression
--timezone TZ                  IANA timezone, default local timezone
--manual                       no schedule
--chat                         chat-only target
--repo PATH                    repository/folder target
--worktree                     use isolated worktree
--local                        use repository working tree directly
--base-ref REF                 base branch/ref for worktree
--model MODEL                  Codex model override
--reasoning-effort VALUE       reasoning effort override, if supported
--sandbox MODE                 read-only | workspace-write | danger-full-access
--approval-policy VALUE        never | on-request | untrusted
--allow-schedule-cli BOOL      scheduled session can create/update schedules
--paused                       create as paused
--max-runtime-sec N            max runtime
--missed-policy VALUE          skip | latest_within_window | run_all_capped
--overlap-policy VALUE         skip | queue | cancel_previous
```

## 11. Exit codes

| code | 意味 |
| --- | --- |
| 0 | success |
| 1 | generic error |
| 2 | invalid arguments |
| 3 | daemon unavailable |
| 4 | permission denied / missing capability |
| 5 | validation failed |
| 6 | task not found |
| 7 | database error |
| 8 | schedule parse error |

## 12. Capability model

### 12.1 Human terminal

通常の macOS user が自分の terminal で実行する場合、そのユーザーのローカル権限で全 task を操作できる。

### 12.2 Scheduled Codex session

Scheduled run 内では token により権限を制限する。

Capability:

```text
schedule:list
schedule:create
schedule:update-current
schedule:update-any
schedule:pause-current
schedule:run-now
```

Default for scheduled run:

```json
[
  "schedule:list",
  "schedule:create",
  "schedule:update-current",
  "schedule:pause-current"
]
```

安全制限:

- 1 run あたり create は default 5 件まで。
- `danger-full-access` task の作成は default で不可。
- repo path は現在 task の project または trusted project に限定。
- untrusted path を指定した create は paused 状態で保存し、UI で review required にする。

## 13. Input validation

- `--at` は RFC3339 のみ必須対応。
- `--cron` は 5-field のみ。
- `--timezone` は IANA DB に存在すること。
- `--repo` は absolute path に正規化。
- prompt は最大 200 KB。
- name は 1-120 文字。
- slug は lowercase kebab-case に正規化し、衝突時は suffix を付ける。

## 14. CLI が生成する audit event

例:

```json
{
  "actorType": "scheduled-run",
  "actorId": "run_01J...",
  "action": "task.create",
  "reason": "Follow-up after deploy monitoring",
  "after": {
    "taskId": "task_01J...",
    "kind": "once",
    "runAt": "2026-07-08T09:00:00+09:00"
  }
}
```

## 15. Error response format

```json
{
  "ok": false,
  "error": {
    "code": "schedule_parse_error",
    "message": "Cron expression must have exactly 5 fields.",
    "details": {
      "input": "*/10 * * * * *"
    }
  }
}
```

## 16. `doctor`

```bash
codex-schedule doctor --json
```

Checks:

- daemon socket reachable。
- SQLite readable/writable。
- Codex CLI path configured。
- `codex --version` succeeds。
- app data directories writable。
- timezone DB available。
- notification permission state。

## 17. Codex セッション向け推奨使用例

### Follow-up を 1 回だけ作る

```bash
cat > /tmp/followup.md <<'EOF'
Check whether the release branch has been merged. If merged, summarize the diff and suggest cleanup tasks.
EOF
codex-schedule create \
  --name "release branch follow-up" \
  --at "2026-07-08T10:00:00+09:00" \
  --repo "$PWD" \
  --worktree \
  --prompt-file /tmp/followup.md \
  --json
```

### 現在タスクを次週へ延期する

```bash
codex-schedule update-current \
  --at "2026-07-14T09:00:00+09:00" \
  --reason "No changes to review this week" \
  --json
```

### 不確実なタスクを paused で作る

```bash
codex-schedule create \
  --name "investigate flaky test follow-up" \
  --cron "0 9 * * 1" \
  --repo "$PWD" \
  --worktree \
  --prompt "Investigate whether the flaky test still fails. If yes, propose a minimal fix." \
  --paused \
  --json
```
