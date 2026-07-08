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

app は、汎用 admin dashboard ではなく、AI work の local automation console のように感じられる必要がある。実装済み UI は、health、upcoming work、failed run、trusted project、execution setting のために、compact で task-first な surface を使う。

## 実装済みのユーザー価値

現在の branch は次の core flow をサポートする。

- scheduler task の作成、編集、一時停止、再開、削除、手動実行。
- manual、once、cron task の作成。
- chat workspace、trusted repository path の直接指定、または新しい Git worktree を対象にする。
- task prompt、timezone、model、reasoning effort、sandbox、approval policy、runtime limit、retry count、missed-run handling、overlap handling、schedule CLI capability scope、worktree cleanup policy の設定。
- task list、task detail、run history、run detail、log tail、artifact、audit event、daemon diagnostics の確認。
- repository-backed run を許可する前に、local folder または Git repository を trust / untrust する。
- terminal または scheduled Codex session から `codex-schedule` を使い、daemon 経由で task を管理する。

## 現在のプロダクトシェル

desktop app には次の top-level page がある。

- `Today`: scheduler health、running count、過去 1 日の failed run、review count、Codex CLI readiness、next run、recent activity、global pause/resume control。
- `Tasks`: filterable task list、selected task detail、edit dialog、prompt/policy/audit/run inspection、row action。
- `Runs`: recent/failed/review preset、status と task filter、selected run detail、prompt/output/log/artifact inspection、cancel support。
- `Projects`: project trust entry、trusted path list、trust status、active task count、untrust confirmation。
- `Settings`: scheduler switch、notification switch、global concurrency、Codex path、default model、default sandbox、default approval policy、worktree cleanup default、schema version、固定 local path、diagnostics export。

## MVP 境界

現在の実装は local-only である。

- scheduler daemon は desktop app と同じ Mac で動作する。
- scheduler は local SQLite に state を保存する。
- run は local `codex exec` 経由で起動される。
- repository task には local path trust が必要である。
- cloud execution、multi-user sharing、team permission、hosted scheduler は実装されていない。

この branch には `codex-schedulerd` と `codex-schedule` の sidecar packaging と、macOS signing / notarization の release note も含まれる。

## 既知の gap と制約

現在の branch では次が見えている。

- notification は failure / timeout の desktop notification として実装されており、完全な event notification matrix ではない。
- run triage state は failed / timed-out / interrupted status、findings count、created schedule count から導出される。persisted reviewed/archive state はない。
- natural-language schedule parsing は実装されていない。UI は preset と explicit date、5-field cron を使う。
- desktop Settings page は、initial SQL migration で必ずしも seed されていない default key も表示する。daemon が stored value を返すまでは frontend が default を提供する。
- legacy の `docs/RELEASE.md` は front matter を持つ managed document として管理される。
