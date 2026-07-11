---
title: プロダクトスコープ
description: Clockhand の実装済み product purpose、user、MVP boundary、既知の implementation gap を定義する。
updated: 2026-07-11
read_when:
  - product behavior、navigation、task creation、run history、scheduler default を変更するとき。
  - 現在の branch が実装済み scope として何を主張しているか確認するとき。
---

# プロダクトスコープ

Clockhand は、ローカル AI agent の作業をスケジュールする macOS、Windows、Linux 向けの desktop app である。現在の実装が起動できる runner は Codex CLI のみである。すでにローカル Git project から Codex を実行しているユーザーが、visible state、local log、一貫した execution profile を持つ recurring または delayed work を実行したい場合を想定している。

app は、汎用 admin dashboard ではなく、AI work の local automation console のように感じられる必要がある。実装済み UI は、project、upcoming work、failed run、execution session、execution setting のために、compact で task-first な surface を使う。

## 実装済みのユーザー価値

現在の branch は次の core flow をサポートする。

- scheduler task の作成、編集、一時停止、再開、削除、手動実行。
- manual、once、cron task の作成。
- chat workspace、または登録済み Git project から実行ごとに作成する isolated worktree を対象にする。project root を直接変更する実行 mode は提供しない。
- task prompt、model、思考レベル、lock、開始状態の設定。timezone は PC の現在値を自動使用する。Codex binary path は Settings の global value を全 task で共有する。
- すべての task を full access、approval request なし、timeout なし、自動 retry なし、全体同時実行数無制限、重複時 skip、未実行分 skip、worktree 保持で実行する。Scheduler CLI は全 action を作成数上限なしで常に利用できる。
- task list、task detail、task-scoped run history、run detail、log tail、artifact、audit event、daemon diagnostics の確認。
- local Git repository を project として追加し、scheduler-owned worktree の source として使う。
- task を lock し、AI エージェントが使う CLI / scheduled-run actor からの edit、delete、pause、resume を防ぐ。desktop UI の user operation は lock 中も利用できる。
- terminal または scheduled Codex session から `codex-schedule` を使い、daemon 経由で task を管理する。

## 現在のプロダクトシェル

desktop app には次の top-level page がある。

- App shell: local date / time、起動予定時刻付きの next-run order task sidebar、archived task entry、その直下の project entry、bottom toolbox settings、icon + number の running count。
- `Projects`: file browser からの project 追加、GitHub `user(org)/repo` display、non-GitHub project name editing、active task count、project removal confirmation。
- `Tasks`: archived list、task detail、初期表示の session history table、creation form と共通の inline settings、task-name header actions、lock / unlock。実行履歴の一覧は task detail だけで提供する。
- Task session detail: task history から開く chat UI、tool usage、prompt/output/log/artifact inspection、cancel support。global run history page は提供しない。
- `Settings`: scheduler switch、notification switch、global Codex path、default model、schema version、固定 local path、diagnostics export。

## MVP 境界

現在の実装は local-only である。

- scheduler daemon は desktop app と同じ macOS、Windows、または Linux ホストで動作する。
- scheduler は local SQLite に state を保存する。
- run は local `codex exec` 経由で起動される。
- repository task は registered project を対象にする。
- cloud execution、multi-user sharing、team permission、hosted scheduler は実装されていない。

この branch には `codex-schedulerd` と `codex-schedule` の release-profile sidecar packaging、macOS / Windows / Linux 向け GitHub Release asset と SHA-256 作成、プラットフォーム別の署名準備も含まれる。対応 target と artifact contract は [プラットフォーム対応](platform-support.md) で定義する。

## 既知の gap と制約

現在の branch では次が見えている。

- notification は failure / timeout の desktop notification として実装されており、完全な event notification matrix ではない。
- run triage state は failed / timed-out / interrupted status、findings count、created schedule count から導出される。persisted reviewed/archive state はない。
- natural-language schedule parsing は実装されていない。UI は preset と explicit date、5-field cron を使う。
- archive は task status と run history から導出され、独立した persisted archive flag はない。
- desktop Settings page は、initial SQL migration で必ずしも seed されていない default key も表示する。daemon が stored value を返すまでは frontend が default を提供する。
- legacy の `docs/RELEASE.md` は front matter を持つ managed document として管理される。
