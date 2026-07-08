---
title: プロダクトスコープ
description: Codex Scheduler の実装済み product purpose、user、MVP boundary、既知の implementation gap を定義する。
updated: 2026-07-08
read_when:
  - product behavior、navigation、task creation、run history、scheduler default を変更するとき。
  - 現在の branch が実装済み scope として何を主張しているか確認するとき。
---

# プロダクトスコープ

Codex Scheduler は、ローカル Codex CLI 作業をスケジュールする macOS ファーストの desktop app である。すでにローカル project folder から Codex を実行しているユーザーが、visible state、local log、明示的な execution policy を持つ recurring または delayed work を実行したい場合を想定している。

app は、汎用 admin dashboard ではなく、AI work の local automation console のように感じられる必要がある。実装済み UI は、project、upcoming work、failed run、execution session、execution setting のために、compact で task-first な surface を使う。

## 実装済みのユーザー価値

現在の branch は次の core flow をサポートする。

- scheduler task の作成、編集、一時停止、再開、削除、手動実行。
- manual、once、cron task の作成。
- chat workspace、registered project path、または新しい Git worktree を対象にする。
- task prompt、timezone、model、reasoning effort、sandbox、approval policy、runtime limit、retry count、missed-run handling、overlap handling、schedule CLI capability scope、worktree cleanup policy の設定。
- task list、task detail、run history、run detail、log tail、artifact、audit event、daemon diagnostics の確認。
- local folder または Git repository を project として追加し、project 配下を task execution scope として使う。
- task を lock し、AI / scheduled-run actor からの edit、delete、pause、resume を防ぐ。
- terminal または scheduled Codex session から `codex-schedule` を使い、daemon 経由で task を管理する。

## 現在のプロダクトシェル

desktop app には次の top-level page がある。

- App shell: project entry、next-run order の task sidebar、archived task entry、bottom toolbox settings、icon + number health count。
- `Projects`: file browser からの project 追加、GitHub `user(org)/repo` display、non-GitHub project name editing、active task count、project removal confirmation。
- `Tasks`: archived list、task detail、session history、tabbed prompt / settings / audit inspection、right-column actions、lock / unlock。
- `Runs`: global history preset、status と task filter、task session detail、chat UI、tool usage、prompt/output/log/artifact inspection、cancel support。
- `Settings`: scheduler switch、notification switch、global concurrency、Codex path、default model、default sandbox、default approval policy、worktree cleanup default、schema version、固定 local path、diagnostics export。

## MVP 境界

現在の実装は local-only である。

- scheduler daemon は desktop app と同じ Mac で動作する。
- scheduler は local SQLite に state を保存する。
- run は local `codex exec` 経由で起動される。
- repository task は registered project を対象にする。
- cloud execution、multi-user sharing、team permission、hosted scheduler は実装されていない。

この branch には `codex-schedulerd` と `codex-schedule` の sidecar packaging と、macOS signing / notarization の release note も含まれる。

## 既知の gap と制約

現在の branch では次が見えている。

- notification は failure / timeout の desktop notification として実装されており、完全な event notification matrix ではない。
- run triage state は failed / timed-out / interrupted status、findings count、created schedule count から導出される。persisted reviewed/archive state はない。
- natural-language schedule parsing は実装されていない。UI は preset と explicit date、5-field cron を使う。
- archive は task status と run history から導出され、独立した persisted archive flag はない。
- desktop Settings page は、initial SQL migration で必ずしも seed されていない default key も表示する。daemon が stored value を返すまでは frontend が default を提供する。
- legacy の `docs/RELEASE.md` は front matter を持つ managed document として管理される。
