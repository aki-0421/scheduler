# Codex Scheduler for Mac: 仕様概要

作成日: 2026-07-07  
対象: macOS デスクトップアプリ / Tauri v2 + Next.js + shadcn/ui / Codex CLI 実行スケジューラー

## 1. 目的

このアプリは、macOS 上で Codex CLI を指定時刻または cron 風スケジュールで自動起動するローカルスケジューラーである。ユーザーは UI からタスクを作成し、タスクごとにプロンプト、対象フォルダ、Git worktree 利用有無、モデル、権限、繰り返し条件を管理できる。

また、スケジュール実行された Codex セッション自身が、専用 CLI を通じて新しいスケジュールを作成・更新できる。アプリが起動する Codex セッションには、専用 CLI の使い方だけを説明する薄い system instructions を挿入する。

## 2. 参考にした製品仕様

この仕様は、2026-07-07 時点で確認できる公式ドキュメントをもとに、以下の設計方針を採用する。

- Codex App Automations は、プロジェクト、プロンプト、cadence、実行環境を選ぶ背景タスクとして扱う。
- Codex App の project-scoped automation は、ローカルアプリと対象プロジェクトが実行時に利用可能である必要があるため、本アプリも MVP では「Mac が起動中、アプリまたはデーモンが実行中」であることを前提にする。
- Codex App と同様、Git リポジトリではローカル作業ツリー直接実行と dedicated worktree 実行を選べるようにする。
- Claude Code Desktop scheduled tasks の仕様を参考に、ローカル実行、最短 1 分単位、単発タスク、missed run、タスク履歴、タスク自身による schedule 更新を取り入れる。

参照元の詳細は `11-references.md` を参照。

## 3. MVP のスコープ

MVP は「ローカル Mac で Codex CLI を安全に、繰り返し、または一度だけ実行する」ことに集中する。

### MUST

- macOS デスクトップアプリとして起動できる。
- アプリ起動時にスケジューラーデーモンを開始する。
- タスクを UI から作成、編集、削除、pause/resume、run now できる。
- cron 風の繰り返しタスクを作成できる。
- 1 度きりのタスクを作成できる。
- 最短 1 分単位のスケジュールを扱える。
- Codex CLI にプロンプトを渡して非対話実行できる。
- チャットのみタスクと、指定 Git リポジトリのワークツリー実行タスクをサポートする。
- スケジュール実行中の Codex セッションから専用 CLI で任意のタスクを作成できる。
- 実行ログ、終了ステータス、最終出力、作業ディレクトリを UI で確認できる。

### SHOULD

- Git worktree を使って、未コミットのローカル作業から自動実行の変更を隔離できる。
- missed run は最新 1 件だけ catch-up できる。
- タスクごとに sandbox / approval / model / reasoning effort を設定できる。
- macOS 通知でタスク開始、終了、失敗を知らせる。
- CLI は JSON 出力に対応し、Codex セッションから安全に呼び出せる。
- タスクが自分自身の次回スケジュールを変更できる。

### COULD

- ログイン時自動起動をサポートする。
- menu bar 常駐モードを用意する。
- natural language schedule parser を UI/CLI に追加する。
- 複数プロジェクト横断のタスクを作成できる。
- MCP 経由の schedule tool を提供する。

### WON'T for MVP

- クラウド上で Mac がオフでも実行されるスケジューラーは提供しない。
- Codex App 公式 Automations API との同期は行わない。
- 複数ユーザー・チーム共有・権限管理は提供しない。
- GitHub Actions などクラウド CI での実行は対象外にする。

## 4. アプリ名とバイナリ名

仮称:

- アプリ名: `Codex Scheduler`
- スケジューラーデーモン: `codex-schedulerd`
- セッション内 CLI: `codex-schedule`
- アプリ bundle identifier: `com.local.codex-scheduler`

## 5. 実行モード

| mode | 説明 | 主な用途 |
| --- | --- | --- |
| `chat` | Git リポジトリを対象にせず、プロンプトだけで Codex CLI を実行する | リマインダー、調査、サマリー、スケジュール作成補助 |
| `repo-local` | 指定 Git リポジトリの現在の working tree で実行する | ローカル状態を直接見てほしいタスク |
| `repo-worktree` | 実行ごとに dedicated Git worktree を作成して実行する | 変更を隔離したいレビュー、修正、PR 準備 |

## 6. スケジュール種別

| 種別 | 指定形式 | 例 | 挙動 |
| --- | --- | --- | --- |
| Manual | schedule なし | `manual` | UI/CLI の run now のみで実行 |
| Once | RFC3339 timestamp | `2026-07-08T09:00:00+09:00` | 1 回実行後に `completed` へ遷移 |
| Cron | 5-field cron | `*/15 * * * *` | 1 分単位で繰り返し実行 |
| Preset | UI 表示用 | hourly / daily / weekdays / weekly | 内部的には cron に正規化 |

Cron は 5-field POSIX 形式を MVP の標準とする。秒 field はサポートしない。

## 7. 重要な設計判断

1. **実行基盤は Codex CLI**  
   アプリは Codex 自体を再実装しない。タスク実行時に `codex exec` を起動し、stdout/stderr/JSONL を収集する。

2. **ローカルファースト**  
   タスク、履歴、ログ、worktree 情報は `~/Library/Application Support/Codex Scheduler/` 配下の SQLite とファイルに保存する。

3. **スケジューラーは Rust daemon**  
   Tauri アプリ起動時に Rust の sidecar daemon を開始する。UI、Tauri backend、CLI は同じ daemon または SQLite を介して状態を共有する。

4. **Codex セッションからのスケジュール作成は CLI 経由**  
   セッション内に `codex-schedule` を PATH 追加し、薄い system instructions で使い方を教える。CLI は JSON 出力を基本とする。

5. **安全側のデフォルト**  
   Git 変更を伴うタスクは worktree 実行を推奨し、`danger-full-access` 相当は advanced 設定に隠す。MVP の scheduled run は非対話実行を原則とし、承認待ちで無限停止しないようにする。
