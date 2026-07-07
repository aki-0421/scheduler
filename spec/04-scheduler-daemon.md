# スケジューラーデーモン仕様

## 1. 目的

`codex-schedulerd` は、タスクの due 判定、queue 管理、Codex CLI process の監視、履歴保存を担当するローカル daemon である。

## 2. 起動条件

MVP:

- Codex Scheduler.app 起動時に自動開始。
- menu bar 常駐が有効な場合、window を閉じても継続。
- app 完全終了時は daemon も停止。

将来:

- macOS LaunchAgent によりログイン時に headless daemon を起動。
- UI は既存 daemon に接続するだけにする。

## 3. Single-instance lock

同時に複数 daemon が同じ DB を操作しないよう、起動時に lock file を取得する。

```text
~/Library/Application Support/Codex Scheduler/scheduler.lock
```

- lock 取得成功: daemon 起動。
- lock 取得失敗: 既存 daemon に health check。
- health check 成功: 新 process は終了。
- health check 失敗: stale lock とみなし、pid 確認後に lock を奪取。

## 4. Scheduler loop

### 4.1 Tick

- 基本 tick: 60 秒。
- task create/update/resume 後は即 tick を要求できる。
- tick は wall-clock minute boundary に近いタイミングへ寄せる。
- due 判定は `next_run_at <= now + due_grace_sec`。
- `due_grace_sec` 初期値は 5 秒。

### 4.2 Pseudocode

```rust
loop {
  wait_until_next_tick_or_signal();
  if !settings.scheduler_enabled { continue; }

  let now = utc_now();
  let due_tasks = db.find_active_tasks_due(now);

  for task in due_tasks {
    db.transaction(|tx| {
      if should_enqueue(task, now, tx) {
        create_run(task, scheduled_for, trigger_type);
        update_task_next_run(task);
      }
    });
  }

  runner_pool.start_available_runs();
  cleanup_finished_processes();
}
```

## 5. Schedule semantics

### 5.1 Manual

- `next_run_at = NULL`。
- scheduler loop では enqueue しない。
- UI/CLI の run now のみで実行。

### 5.2 Once

- `run_at` に RFC3339 timestamp を保存。
- `next_run_at = run_at`。
- due になったら 1 run を作成。
- run 作成後、task status は `completed` に変更する。
- run が失敗しても、one-off はデフォルトで再実行しない。retry は run 単位でのみ行う。

### 5.3 Cron

- 5-field cron: `minute hour day-of-month month day-of-week`。
- 最短間隔: 1 分。
- 秒指定は reject。
- timezone は task の `timezone` で評価する。
- `next_run_at` は次回 local time を UTC に変換したもの。

例:

```text
* * * * *        every minute
*/15 * * * *     every 15 minutes
0 9 * * 1-5      weekdays 09:00
0 10 1 * *       first day of month 10:00
```

## 6. Timezone / DST

- task は IANA timezone name を保存する。
- UI 既定値は macOS の現在 timezone。
- DST で存在しない local time は、その日の次に存在する時刻へ繰り下げる。
- DST で重複する local time は最初の occurrence のみ実行する。
- run の `scheduled_for` は常に UTC で保存する。

## 7. Missed run policy

アプリが起動していない、Mac が sleep している、daemon が停止している期間の扱い。

### 7.1 `skip`

- missed run は作成しない。
- 次回 future run のみ計算する。

### 7.2 `latest_within_window` default

- `missed_window_days` 初期値 7 日。
- 期間内に missed run が 1 つ以上ある場合、最新 1 件だけ catch-up run を作成する。
- それより古い missed run は `skipped` audit event として記録する。

### 7.3 `run_all_capped`

- missed run を古い順に enqueue する。
- 上限は `max_catchup_runs` setting。初期値 5。
- 1 分間隔タスクで大量 run が発生しないよう UI で warning を表示する。

## 8. Overlap policy

同一 task の前回 run がまだ running のときの扱い。

### 8.1 `skip` default

- 新しい scheduled run は `skipped` として記録。
- reason: `previous_run_still_running`。

### 8.2 `queue`

- 新しい run を queued にする。
- 同一 task の running が終わってから実行する。

### 8.3 `cancel_previous`

- 前回 run に SIGTERM。
- grace period 後に SIGKILL。
- 新 run を実行。

## 9. Concurrency

Settings:

```json
{
  "daemon.globalConcurrency": 2,
  "daemon.perProjectConcurrency": 1,
  "daemon.perTaskConcurrency": 1
}
```

- global concurrency を超える run は queued のまま。
- worktree 作成中も concurrency slot を消費する。
- Codex process 起動後から終了まで running とする。

## 10. Retry

- retry は run の failure に対する自動再試行。
- `max_retries` 初期値 0。
- retry run は同じ `scheduled_for`、`attempt + 1`。
- retry backoff は `retry_backoff_sec * attempt`。
- timeout / Codex non-zero / transient Git error は retry 対象。
- validation failure や bad cron など設定エラーは retry しない。

## 11. Run lifecycle

```text
queued
  └─ starting
       ├─ failed            # setup failure
       └─ running
            ├─ succeeded
            ├─ failed
            ├─ timed_out
            ├─ canceled
            └─ interrupted  # daemon crash/app quit
```

## 12. Process supervision

- process group を作成し、child process もまとめて終了できるようにする。
- `max_runtime_sec` 超過で SIGTERM。
- 30 秒 grace period 後 SIGKILL。
- stdout/stderr は line buffer せず byte stream として保存する。
- 末尾 8 KB を DB の preview に保存する。

## 13. Notifications

Daemon event から Tauri backend へ通知 request を送る。

Events:

- `run.started`
- `run.succeeded`
- `run.failed`
- `run.timed_out`
- `run.catchup_started`
- `task.schedule_invalid`

通知は global setting と task setting の両方で抑制可能。

## 14. Health check

Socket method:

```json
{"method":"daemon.health","params":{}}
```

Response:

```json
{
  "ok": true,
  "version": "0.1.0",
  "dbSchemaVersion": 1,
  "schedulerEnabled": true,
  "runningCount": 1,
  "queuedCount": 3
}
```

## 15. Daemon API

主要 method:

```text
daemon.health
task.list
task.get
task.create
task.update
task.delete
task.pause
task.resume
task.runNow
run.list
run.get
run.cancel
run.tailLog
project.list
project.trust
settings.get
settings.set
```

## 16. Failure handling

| Failure | 対応 |
| --- | --- |
| bad cron | task.schedule_status = invalid、UI warning |
| Codex binary missing | run failed、Settings で path 設定 CTA |
| Codex auth expired | run failed、`codex doctor` または login CTA |
| repository removed | run failed、project unavailable |
| worktree path exists | unique suffix で retry |
| DB locked | short retry、失敗時 daemon degraded mode |
| app sleep | wake/start 時 missed policy を適用 |

## 17. Observability

- daemon log: `logs/daemon.log`。
- run event: DB + `events.jsonl`。
- crash report: `logs/crashes/`。
- UI に diagnostic export ボタンを用意する。
