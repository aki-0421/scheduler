---
title: スケジューリングと実行
description: schedule calculation、daemon tick behavior、run lifecycle、Codex runner behavior、log、手動再実行、cleanup を定義する。
updated: 2026-07-11
read_when:
  - cron behavior、missed-run handling、overlap handling、run execution、Codex invocation、log、手動再実行、cleanup を変更するとき。
  - task が実行された理由、または実行されなかった理由を debug するとき。
---

# スケジューリングと実行

scheduler daemon は run をいつ enqueue するか決定する。runner は workspace を準備し、Codex を呼び出し、output を記録し、normalized execution status を daemon に返す。

## スケジュール種別

`manual` task は automatic `nextRunAt` value を受け取らず、明示的な run-now action でのみ実行される。

`once` task は `runAt` を必要とする。next run は保存された timestamp である。daemon が scheduled run を作成した後、その task は automatic scheduling の目的では completed として扱われる。

`cron` task は 5-field cron expression と IANA timezone を必要とする。seconds field と year field は rejected される。range、step、day-of-month / day-of-week OR semantics などの一般的な cron syntax は Rust cron parser 経由でサポートされる。

## Timezone と DST ルール

schedule engine は instant を UTC RFC3339 timestamp として保存・比較し、cron expression は task timezone で評価する。

desktop task wizard は timezone を選択させず、task の作成または更新時に現在の PC から解決した IANA timezone を保存する。すでに保存済みの task は、次に wizard から更新されるまでは保存済み timezone で動作する。CLI の `--timezone` と task DTO の timezone field は automation と schedule engine の明示的な contract として維持する。

test 済み cron behavior:

- `* * * * *` は 1 分粒度で schedule できる。
- seconds をサポートしないため、6-field cron expression は rejected される。
- invalid cron value と `@daily` のような macro-style expression は rejected される。
- spring-forward による存在しない local time は次の valid instant に roll forward する。
- fall-back による ambiguous local time は最初の wall-clock occurrence を使い、recurring preview では繰り返された wall-clock hour を skip する。

## Daemon tick

daemon は startup 時に initial tick を実行し、その後は次の configured tick interval または explicit tick notification まで sleep する。default config は minute-level scheduling を基準にし、test は interval を override できる。`daemon.tickNow` は scheduler loop を起こし、due-run evaluation を即時実行させる。

daemon は scheduled work を queue する前に `scheduler.enabled` を確認する。disabled scheduler は RPC request を処理し続けるが、due task を automatic enqueue しない。

## Missed run

Cron の未実行分は app-wide に `skip` する。catch-up run は enqueue せず、次の future occurrence を `nextRunAt` に設定する。この規則は task や Settings から変更できない。

## Overlap handling

前の run が active のまま task が due になった場合、新しい run は app-wide に `skip` する。reason `previous_run_still_running` で skipped run を作成または記録する。この規則は task や Settings から変更できない。

## 同時実行

全体の同時実行数には上限を設けない。daemon tick は、同一タスクの重複と同一プロジェクト内の既存直列化に抵触しない startable な queued run を、全体件数で打ち切らずすべて開始する。

同一タスクの重複は前述の overlap handling で skip する。同一 Git project を対象にする run は既存の project concurrency に従い、chat target と異なる project の run は互いに待たずに開始できる。旧 `daemon.global_concurrency` setting が database に残っていても daemon は参照しない。

`cargo test -p schedulerd legacy_global_concurrency_setting_does_not_limit_parallel_runs` は、旧 setting が `1` の database でも異なる 3 task の run がすべて同時に running となり、queued run が残らないことを検証する。

## Retry handling

scheduler は失敗した run を自動 retry しない。user は task detail の `今すぐ実行` または失敗した session の `再実行` から新しい manual run を明示的に enqueue できる。

## Codex invocation

runner は Settings の global configured path、`PATH` の順で Codex CLI を検出し、canonical binary path ごとに capability data を cache し、`codex --version` と `codex exec --help` の両方を verify する。binary path は全 task 共通であり、task DTO、task wizard、CLI の task create / update から override できない。

生成される command は `codex exec` を使い、JSON output、supported な場合は no color、working directory、任意の model、任意の reasoning effort、`danger-full-access`、`approval_policy="never"`、`--output-last-message`、stdin prompt input を指定する。reasoning effort の専用 flag がない Codex CLI では `model_reasoning_effort` config を使う。unsupported critical flag は partial run ではなく preflight failure になる。full access と approval request なしは app-wide execution profile であり、task ごとの確認や override は持たない。

## Workspace mode

`chat` は app data 配下に scheduler-owned chat workspace を作成し、project を必要としない。

`repo-worktree` は登録済み Git project から scheduler worktree root 配下に isolated Git worktree を作成し、task または project default から base ref を選択し、scheduler branch を作成し、execution 前後の Git state を capture する。worktree は実行後も保持し、project root で直接 Codex を実行しない。

worktree は task slug directory の下に、実行ごとに新しく生成する `wt-<UUIDv7>` という leaf name で作成する。UUIDv7 は生成 timestamp で順序付け可能な random ID であり、run ID とは独立している。branch name も同じ instance name を含む。path collision 時だけ numeric suffix を付けて retry する。

project mode には registered Git project root が必要である。legacy `repo-local` request が runner に到達した場合も安全側に倒してworktreeとして準備する。worktree directory 配下の symlink escape attempt は rejected される。

## Prompt composition

すべての run prompt は scheduler metadata、Scheduler CLI instruction、user task instruction を含む。run-scoped token は常に発行し、schedule create、current / any task update、current task pause、run-now、list の全 action を許可する。schedule 作成数に上限は設けない。injection event は run events JSONL file に persist される。

## Run environment

runner は current task ID、current run ID、socket path、timezone、app version、run token などの scheduler environment variable を追加する。利用可能な場合は app CLI directory を `PATH` の先頭に追加し、scheduled Codex session から `codex-schedule` を見つけられるようにする。

redacted environment JSON は secret ではない scheduler identifier を保持し、token、API key、password、類似 secret を mask する。

## Log と result

各 run は次を記録する。

- full stdout log
- full stderr log
- stdout から抽出した valid Codex JSONL event
- last-message file
- command JSON
- redacted environment JSON
- stdout と stderr tail
- 任意の Codex session ID
- 2,000 characters に truncate された任意の summary
- runner output から persist された artifact

non-JSON stdout line は stdout log に保持されるが `events.jsonl` からは除外される。run は `invalid_stdout_jsonl` warning を受け取る。

Codex stdout の complete な JSONL event は process 終了時まで buffer せず、検証して `events.jsonl` に追記した行ごとに flush する。これにより active run の `run.tailLog` は process 実行中も complete event を cursor から読み取れる。途中の未完了 JSON line は改変せず、改行まで受信した時点で初めて event log に追加する。

`cargo test -p codex-runner` は slow fixture の process が終了する前に先頭 JSONL event を `events.jsonl` から読めることを検証する。

## Cancellation と実行時間

runner は Codex を process group 内で起動する。最大実行時間は設けず、user が明示的に cancel した場合だけ process group を terminate して `canceled` にする。legacy run history の `timed_out` status は読み取り互換のため残す。

## Cleanup

retention cleanup は initial delay の後に実行され、その後 hourly に実行される。expired capability token、古い terminal run history、success / failure retention window に従った古い log を削除する。task execution が作成した worktree は常に保持し、自動削除しない。
