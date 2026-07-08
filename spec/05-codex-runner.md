# Codex Runner 仕様

## 1. 目的

Codex Runner は scheduled run ごとに workspace を準備し、Codex CLI を安全に起動し、出力と結果を保存する責務を持つ。

## 2. Codex CLI 起動方式

MVP では非対話実行に適した `codex exec` を使う。

基本形:

```bash
codex exec \
  --cd "$WORKSPACE" \
  --json \
  --color never \
  --model "$MODEL" \
  --sandbox "$SANDBOX_MODE" \
  --config 'approval_policy="never"' \
  --output-last-message "$LAST_MESSAGE_PATH" \
  -
```

- 最後の `-` は stdin から prompt を渡す指定。
- `--json` が使用可能な場合、events を `events.jsonl` に保存する。
- `--config 'approval_policy="never"'` を default にし、scheduled run が承認待ちで無期限停止しないようにする。
- 旧 Codex CLI で `codex exec --help` が `--ask-for-approval` を直接サポートする場合のみ、互換 fallback として `--ask-for-approval never` を使える。
- `--dangerously-bypass-approvals-and-sandbox` / `--yolo` は isolated runner 以外では使用しない。
- Codex CLI の flag はバージョン差分がありうるため、起動前に `codex --version` と `codex exec --help` を cache し、未対応 flag は warning にする。

## 3. Prompt composition

Codex に渡す prompt は次の順序で構成する。

```text
<thin scheduler system instructions>

---
Scheduler metadata:
- task_id: ...
- run_id: ...
- scheduled_for: ...
- target_mode: ...
- workspace: ...

---
User task instructions:
<task.prompt_body>
```

Codex CLI が explicit system instruction flag を提供する場合は、thin scheduler instructions を system 側に渡す。提供されない場合は、上記の preamble として initial prompt に挿入する。

## 4. Thin scheduler system instructions

実際の文面は `07-system-instructions.md` を参照。原則:

- Codex の通常能力や coding style は指示しない。
- `codex-schedule` CLI の存在と代表コマンドだけを伝える。
- current task/run ID と capability の範囲を伝える。
- 不確実な follow-up は paused task として作るよう促す。

## 5. Environment variables

Scheduled run には以下を注入する。

```bash
CODEX_SCHEDULER=1
CODEX_SCHEDULER_APP_VERSION=0.1.0
CODEX_SCHEDULER_SOCKET="$SOCKET_PATH"
CODEX_SCHEDULER_CURRENT_TASK_ID="$TASK_ID"
CODEX_SCHEDULER_CURRENT_RUN_ID="$RUN_ID"
CODEX_SCHEDULER_RUN_TOKEN="$RUN_SCOPED_TOKEN"
CODEX_SCHEDULER_TIMEZONE="$TASK_TIMEZONE"
PATH="$APP_CLI_DIR:$PATH"
```

`RUN_SCOPED_TOKEN` は短寿命で、DB には hash のみ保存する。

## 6. Target modes

### 6.1 `chat`

- workspace は app data 配下の一時 folder。
- `--skip-git-repo-check` を付ける。
- sandbox は default `read-only`。必要に応じて app-managed workspace への write を許可。
- 生成ファイルは run artifacts として保存。

Workspace:

```text
~/Library/Application Support/Codex Scheduler/chat-workspaces/<run-id>/
```

### 6.2 `repo-local`

- workspace はユーザーが trust した repository path。
- Codex は現在の working tree に直接アクセスする。
- UI で「未コミット変更を変更する可能性があります」という warning を表示。
- default sandbox は `workspace-write`。
- 実行前後で `git status --porcelain=v1` を保存する。

### 6.3 `repo-worktree`

- 実行ごとに isolated Git worktree を作成する。
- base ref は task 設定値。未指定なら project default branch。
- branch name は一意。

例:

```bash
git -C "$REPO" fetch --all --prune --quiet   # optional setting
git -C "$REPO" worktree add \
  -b "codex-scheduler/daily-review/run_01JABC" \
  "$WORKTREE_PATH" \
  "$BASE_REF"
```

- Codex は worktree path で実行。
- 実行後、`git diff --stat`、`git status`、`git rev-parse HEAD` を保存。
- cleanup policy に従い、worktree を保持または削除。

## 7. Worktree cleanup

### 7.1 `keep`

- すべて保持。
- UI から手動削除。

### 7.2 `delete_on_success`

- succeeded run の worktree を削除。
- failed run は調査用に保持。

### 7.3 `delete_after_days`

- succeeded/failed にかかわらず指定日数経過後に削除候補。
- 削除前に `git status --porcelain` が clean でない場合は warning を残し削除しない。

## 8. Output capture

Files:

```text
logs/<run-id>/stdout.log
logs/<run-id>/stderr.log
logs/<run-id>/events.jsonl
logs/<run-id>/last-message.md
logs/<run-id>/command.json
logs/<run-id>/environment.redacted.json
```

DB:

- stdout/stderr の tail preview。
- exit code。
- Codex session ID が抽出できる場合は保存。
- 最終メッセージ先頭 2,000 文字を summary candidate として保存。

## 9. Result classification

MVP:

- exit code 0: `succeeded`。
- exit code non-zero: `failed`。
- timeout: `timed_out`。
- user cancel: `canceled`。

Optional:

タスク prompt の末尾に structured summary を依頼する mode を追加する。

```text
At the end, include a short section:
Scheduler Result:
- outcome: success|needs_review|no_findings|failed
- findings_count: <number>
- summary: <one paragraph>
```

ただし、Codex の本来タスクを邪魔しないよう default では強制しない。

## 10. Security

### 10.1 argv-safe execution

禁止:

```rust
Command::new("sh").arg("-c").arg(format!("codex exec --cd {} ...", path))
```

必須:

```rust
Command::new(codex_path)
  .arg("exec")
  .arg("--cd")
  .arg(workspace)
  .arg("--json")
  .arg("-")
```

### 10.2 Path validation

- workspace path は canonicalize する。
- trust された project root 配下か検査する。
- symlink escape を検出する。
- app data 配下の log/worktree path は random/UUID path を使う。

### 10.3 Secrets redaction

`environment.redacted.json` では以下を mask する。

```text
*_TOKEN
*_KEY
*_SECRET
PASSWORD
OPENAI_API_KEY
CODEX_*
```

ただし `CODEX_SCHEDULER_CURRENT_TASK_ID` など ID は保存してよい。

## 11. Preflight checks

Run 開始前:

1. Codex binary exists。
2. `codex --version` が成功する。
3. target project path exists。
4. Git repository mode では `git rev-parse --show-toplevel` が成功する。
5. worktree mode では base ref が解決できる。
6. disk free space が 1 GB 以上。
7. max runtime / sandbox / approval policy が valid。

## 12. Command examples

### Chat only

```bash
printf '%s' "$PROMPT" | codex exec \
  --skip-git-repo-check \
  --cd "$CHAT_WORKSPACE" \
  --json \
  --sandbox read-only \
  --config 'approval_policy="never"' \
  --output-last-message "$LAST_MESSAGE" \
  -
```

### Repo worktree

```bash
printf '%s' "$PROMPT" | codex exec \
  --cd "$WORKTREE_PATH" \
  --json \
  --sandbox workspace-write \
  --config 'approval_policy="never"' \
  --model "$MODEL" \
  --output-last-message "$LAST_MESSAGE" \
  -
```

## 13. Failure examples

### Codex CLI not found

```json
{
  "status": "failed",
  "statusReason": "codex_binary_not_found",
  "message": "Codex CLI was not found. Configure the path in Settings > Codex CLI."
}
```

### Worktree setup failed

```json
{
  "status": "failed",
  "statusReason": "git_worktree_add_failed",
  "stderrTail": "fatal: invalid reference: main"
}
```

## 14. Compatibility strategy

Codex CLI は更新されるため、runner は以下を実装する。

- `codex exec --help` を parse し、利用可能 flag を cache。
- 未対応 flag は使わず、run warning に記録。
- critical flag が未対応の場合は run を失敗させる。
- docs と実装に差分が出た場合に備え、Settings > Diagnostics で CLI capability を表示する。
