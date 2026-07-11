---
title: セキュリティと運用
description: local trust boundary、project scope、task lock、capability token、固定 execution profile、diagnostics、cleanup、release operations を定義する。
updated: 2026-07-11
read_when:
  - project scope、task lock、path opening、scheduler token、execution profile、diagnostics export、cleanup、signing、sidecar release flow を変更するとき。
  - scheduled Codex run の local execution risk を review するとき。
---

# セキュリティと運用

Clockhand は local file に対して local AI work を実行する。実装は scheduling、project scope、task lock、run-scoped capability token、audit log を product-visible safety control として扱う。Codex execution は full access と approval request なしの固定 profile を使う。

## 信頼境界

trusted component:

- app を実行している user account。
- Tauri app bundle。
- bundled `codex-schedulerd` sidecar。
- bundled `codex-schedule` sidecar。
- app data directory 配下の SQLite database。

user-approved component:

- user-added project path。
- configured Codex binary。
- Git。

untrusted input:

- prompt と model-generated follow-up request。
- scheduled Codex session が生成した CLI argument。
- run 中に消費される repository content、command output、external data。

## Project scope

project-backed task は registered Git project でのみ許可され、project root ではなく scheduler-owned isolated worktree で実行される。project 登録は selected directory から Git root を検出できなければ拒否する。project は canonical path、Git root、利用可能な Git metadata、detect 可能な GitHub `user(org)/repo` display、default branch を保存する。default branch が未設定の場合、project 登録時に `origin/main`、`origin/master`、local `main`、local `master` の順に検出して保存し、worktree task の base ref fallback に使う。

project を削除すると project record が inactive になり、audit event が記録される。既存 task は削除も自動 pause もされないが、有効な project が再び存在するまで fail する可能性がある。

scheduled Codex session は project を add / update / remove できない。

## Task lock

user は task を lock できる。lock は AI エージェントが使う CLI / scheduled-run actor が task を編集、削除、一時停止、再開することを防ぐための persisted safety control である。desktop UI からの user operation を制限する機能ではない。

lock が有効な task に対して、daemon は scheduled-run actor または CLI actor からの `task.update`、`task.delete`、`task.pause`、`task.resume` を拒否する。desktop UI の user actor は unlock せずに同じ操作を実行できる。

lock / unlock は audit event として記録する。lock は Codex の filesystem access を制限するものではなく、スケジュール自体の破壊的変更を止める control である。

## Path opening policy

desktop backend は `open_path` を scheduler-owned log、scheduler-owned worktree、scheduler-owned chat workspace、registered project root に制限する。これにより、UI-provided string から任意 path を開くことを防ぐ。

## Capability token

scheduled run は常に run-scoped token を受け取る。database は raw token value ではなく token hash を保存する。

token record は次を含む。

- run ID
- task ID
- capability list JSON
- expiration
- max create count
- current create count
- revocation timestamp

daemon は scheduled-run RPC call に対して token capability check を enforce する。token は schedule creation、current-task update、any-task update、current-task pause、run-now、list を許可し、schedule create count は制限しない。project mutation と settings write は許可しない。

## 固定 execution profile

すべての run は `danger-full-access` と `approval_policy="never"` で実行する。task DTO、task wizard、CLI、Settings には sandbox / approval policy の選択肢を公開しない。これは filesystem access を制限しない profile であるため、project task は registered Git project から作る run 固有 isolated worktree で実行し、user は prompt と project selection を信頼できる内容に保つ必要がある。

## Audit

task create / update / duplicate / delete / pause / resume / lock / unlock / run-now と project add / update / remove action は、actor type、任意の actor ID、action name、reason、該当する場合の before / after JSON を持つ audit event を記録する。

actor type は user、daemon、CLI、scheduled-run action を区別する。

## Diagnostics

daemon は RPC 経由で health と diagnostics を公開する。diagnostics には app version、schema version、data directory、socket path、DB / log size、task / run count、scheduler enabled state、Codex path existence、tick interval、last tick time が含まれる。

desktop app は daemon health、daemon diagnostics、redacted daemon log tail、OS version、timestamp を含む diagnostics を export できる。log tail export は API key や run token などの sensitive pattern を redact する。

## Notifications

desktop backend は run status snapshot を poll し、notification が enabled の場合に failed run と timed-out run の desktop notification を送る。

## Cleanup と retention

retention cleanup は expired capability token、古い terminal run history、eligible な古い log を削除する。running run は old history として削除されない。task execution が作成した worktree は常に保持し、自動 cleanup の対象にしない。

## Release operation

release artifact は sidecar binary を含む Tauri `.app` bundle である。release build は packaging 前に sidecar を準備し、sidecar を含む app bundle 全体を sign / notarize する必要がある。

release build 後の推奨 verification:

```bash
codesign --verify --deep --strict --verbose=2 apps/desktop/src-tauri/target/release/bundle/macos/Codex\ Scheduler.app
spctl --assess --type execute --verbose apps/desktop/src-tauri/target/release/bundle/macos/Codex\ Scheduler.app
```

macOS signing と notarization の full checklist は release document を使う。

## Pull request operation

この repository で GitHub pull request を作成または更新するときは、必須の body structure として `.github/PULL_REQUEST_TEMPLATE.md` を使う。template heading を保持し、ad hoc summary で置き換えずに各 section を埋める。

`gh pr create` で PR を作成する場合は、GitHub に template を適用させるか、template と同じ構造の body を渡す。後から body を修正する必要がある場合は、handoff 前に同じ構造へ更新する。

## Verification command

implementation change 後は次の check を使う。

```bash
cargo test --workspace
pnpm lint
pnpm test
pnpm --filter desktop build
```

UI behavior verification には `agent-browser` を使い、screenshot は `/tmp` または ignored local `tmp/` directory に保存する。
