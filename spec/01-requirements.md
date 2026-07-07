# 要件定義

## 1. ペルソナ

### 1.1 個人開発者

- 複数リポジトリを持つ。
- 毎朝のレビュー、依存関係チェック、リリースノート作成を自動化したい。
- ローカルの未コミット作業を壊されたくない。

### 1.2 AI コーディングワークフロー利用者

- Codex CLI によるタスク実行を日常的に使っている。
- 実行結果をあとから UI で確認したい。
- 実行中の Codex が次回の follow-up を自分でスケジュールできると便利だと考えている。

## 2. ユーザーストーリー

### US-001: 繰り返しタスクを作成する

ユーザーとして、cron 風の繰り返しスケジュールを設定し、指定プロンプトを Codex CLI に渡して定期実行したい。

受け入れ条件:

- UI で cron expression を入力できる。
- cron expression の次回 5 回の実行予定が表示される。
- 最短 `* * * * *` の 1 分間隔を保存できる。
- 保存後、タスク一覧に次回実行時刻が表示される。

### US-002: 1 度きりのタスクを作成する

ユーザーとして、指定日時に 1 回だけ Codex CLI を起動したい。

受け入れ条件:

- UI で日時と timezone を指定できる。
- 実行後、タスクは `completed` または `disabled` になる。
- 同じタスクを再利用する場合は新しい日時を設定して resume できる。

### US-003: 指定リポジトリの dedicated worktree で実行する

ユーザーとして、スケジュール実行が未コミット作業を壊さないよう、毎回別 worktree で Codex を実行したい。

受け入れ条件:

- Git リポジトリを選択できる。
- `Use isolated worktree` を有効化できる。
- 実行ごとに一意の worktree path が作成される。
- run detail から worktree を Finder またはターミナルで開ける。
- cleanup policy に従い、古い worktree を削除または保持できる。

### US-004: チャットのみタスクを実行する

ユーザーとして、リポジトリを指定せずに Codex へ定期的なチャットタスクを投げたい。

受け入れ条件:

- `Target: Chat only` を選べる。
- Codex CLI はアプリ管理下の一時 workspace で起動される。
- repository check が不要になる。
- ファイル変更権限はデフォルトで read-only または app data directory のみに制限される。

### US-005: Codex セッションが新しいスケジュールを作成する

スケジュール実行された Codex として、調査や作業の結果に応じて follow-up タスクを CLI で作成したい。

受け入れ条件:

- scheduled run の PATH に `codex-schedule` が含まれる。
- run environment に `CODEX_SCHEDULER_CURRENT_TASK_ID` と `CODEX_SCHEDULER_CURRENT_RUN_ID` が入る。
- system instructions に CLI の最小限の使い方が含まれる。
- `codex-schedule create ... --json` がタスク ID と次回実行時刻を返す。
- 作成されたタスクは UI に表示され、`created_by_run_id` が記録される。

### US-006: タスクを自分でリスケジュールする

スケジュール実行された Codex として、現在のタスクの次回予定を変更したい。

受け入れ条件:

- `codex-schedule update-current --at ...` または `--cron ...` が使える。
- 現在の run token に `schedule:update-current` capability がある場合のみ成功する。
- UI の task detail に「この run により schedule 更新」と表示される。

### US-007: 実行結果を確認する

ユーザーとして、タスクの実行履歴、ログ、最終メッセージ、エラーを UI で確認したい。

受け入れ条件:

- run list に status、scheduled_for、started_at、duration、exit code が表示される。
- run detail に stdout/stderr/JSONL event、最終メッセージ、変更ファイル一覧が表示される。
- 失敗時は command line、exit code、stderr の末尾、再実行ボタンが表示される。

### US-008: スケジューラーを安全に止める

ユーザーとして、タスク全体または特定タスクを止めたい。

受け入れ条件:

- task detail で pause/resume できる。
- global setting で scheduler enabled を切り替えられる。
- daemon 停止時に running process へ SIGTERM を送り、grace period 後に SIGKILL する。

## 3. 機能要件

### 3.1 タスク管理

- タスク作成、編集、削除。
- pause/resume。
- run now。
- duplicate task。
- name から slug 自動生成。
- task ごとに description、prompt、target、schedule、model、permissions を保存。

### 3.2 スケジューリング

- `manual`、`once`、`cron` をサポート。
- cron は 5-field、minute granularity。
- timezone は IANA timezone name として保存。
- `next_run_at` は UTC で保存。
- missed run policy を選択可能。
- per-task overlap policy を選択可能。
- global concurrency limit と per-project concurrency limit を設定可能。

### 3.3 Codex 実行

- `codex exec` または `codex e` を利用する。
- prompt は stdin で渡せる。
- stdout/stderr をファイルと DB metadata に保存する。
- JSONL 出力が利用できる場合は parse して run events として保存する。
- `--cd` で workspace root を指定する。
- `--model` と sandbox 関連 flag をタスク設定から反映する。
- full access / yolo 相当は advanced warning を表示する。

### 3.4 Git worktree

- worktree root は `~/Library/Application Support/Codex Scheduler/worktrees/`。
- branch name は `codex-scheduler/<task-slug>/<run-short-id>`。
- base ref は task ごとに設定可能。未指定なら repository default branch を使う。
- cleanup policy は `keep`, `delete_on_success`, `delete_after_days`。

### 3.5 CLI

- `codex-schedule` は daemon socket を優先し、daemon 不在時は SQLite に transaction で書き込む。
- すべての write command は audit log に記録する。
- `--json` で機械可読な出力を返す。
- scheduled session 内では run-scoped capability token を使う。
- 通常ターミナルからはローカルユーザー権限で全 task を操作可能。

### 3.6 UI

- Dashboard。
- Task list。
- New/Edit Task wizard。
- Run history / Triage。
- Project management。
- Settings。
- Task detail。
- Run detail。

### 3.7 通知

- run started。
- run succeeded。
- run failed。
- missed run catch-up started。
- permission/sandbox failure。

## 4. 非機能要件

### 4.1 信頼性

- daemon は単一インスタンス lock を取得する。
- run 作成は idempotent に行う。
- app crash 後、次回起動時に running のまま残った run を `interrupted` にする。
- SQLite migration をバージョン管理する。

### 4.2 セキュリティ

- shell command は配列 argv で起動し、文字列結合 shell を使わない。
- repository path は trust されたフォルダのみ。
- symlink escape を検査する。
- capability token は短寿命、DB には hash 保存。
- スケジュール作成 CLI の濫用防止として per-run 作成数上限を持つ。

### 4.3 パフォーマンス

- task 数 1,000、run 履歴 100,000 件程度まで UI が扱える。
- daemon tick は 1 分単位で軽量に動作する。
- run logs は DB に全文保存せず、ファイル保存 + DB には末尾 preview と path を保存する。

### 4.4 macOS 統合

- menu bar 常駐モード。
- optional login item。
- macOS notification。
- Finder で repository/worktree/log folder を開く。
- code signing / notarization を CI で行える構成。

## 5. 制約

- Codex CLI がユーザー環境にインストール済みであること。
- Codex CLI の authentication は Codex CLI 側に委ねる。
- MVP は Mac が sleep している間の scheduled run を保証しない。
- アプリが完全終了している場合、LaunchAgent/helper を有効化していない限り実行されない。
