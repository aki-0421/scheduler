---
title: スケジューリングと実行
description: schedule calculation、daemon tick behavior、run lifecycle、Codex runner behavior、log、retry、cleanup を定義する。
updated: 2026-07-08
read_when:
  - cron behavior、missed-run handling、overlap handling、run execution、Codex invocation、log、retry、cleanup を変更するとき。
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

Cron missed-run handling は policy-driven である。

- `skip`: catch-up run を enqueue しない。
- `latest_within_window`: task window 内の eligible missed occurrence のうち最新だけを enqueue する。
- `run_all_capped`: configured cap まで missed occurrence を enqueue する。

実装は occurrence limit で scan を保護し、missed run handling 後に次の `nextRunAt` を計算する。

## Overlap handling

前の run が active のまま task が due になった場合、overlap policy が結果を決める。

- `skip`: reason `previous_run_still_running` で skipped run を作成または記録する。
- `queue`: later queued run を許可する。
- `cancel_previous`: active run の cancellation を要求し、次の run を継続する。

## Retry handling

task に retry 残数がある場合、scheduler は transient failure に対して retry attempt を作成できる。retry timing は `retry_backoff_sec` と次の attempt number に基づく。permanent failure は retry しない。

## Codex invocation

runner は configured path または `PATH` で Codex CLI を検出し、canonical binary path ごとに capability data を cache し、`codex --version` と `codex exec --help` の両方を verify する。

生成される command は `codex exec` を使い、JSON output、supported な場合は no color、working directory、任意の model、任意の reasoning effort、sandbox mode、`--output-last-message`、stdin prompt input を指定する。scheduled run は現在 `approval_policy="never"` を `--config` 経由で渡す。task value が `never` 以外の場合は warning として記録され、execution では override される。unsupported critical flag は partial unsafe run ではなく preflight failure になる。

`danger-full-access` には run request の `allow_danger_full_access=true` が必要である。

## Workspace mode

`chat` は app data 配下に scheduler-owned chat workspace を作成し、project を必要としない。

`repo-local` は registered project path で直接実行する。

`repo-worktree` は scheduler worktree root 配下に isolated Git worktree を作成し、task または project default から base ref を選択し、scheduler branch を作成し、execution 前後の Git state を capture し、task cleanup policy を適用する。

repository mode には registered project root が必要である。worktree directory 配下の symlink escape attempt は rejected される。

## Prompt composition

すべての run prompt は scheduler metadata と user task instruction を含む。Scheduler CLI instruction は、次のすべてが true の場合にだけ inject される。

- task が scheduler instruction injection を許可している。
- task が schedule CLI access を許可している。
- run-scoped token が利用可能である。

inject される instruction は capability-sensitive である。たとえば run が `schedule:update-current` だけを持つ場合、prompt は update-current usage を説明し、schedule creation example を省略する。injection event も run events JSONL file に persist される。

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

## Cancellation と timeout

runner は Codex を process group 内で起動する。cancellation と timeout は group を terminate する。timeout は `timed_out`、cancellation は `canceled` になる。

## Cleanup

retention cleanup は initial delay の後に実行され、その後 hourly に実行される。expired capability token、古い terminal run history、success / failure retention window に従った古い log、eligible な `delete_after_days` worktree を削除する。

Worktree cleanup は dirty worktree の削除を拒否する。`delete_on_success` cleanup は successful run の直後に successful isolated worktree を削除し、created branch は保持する。
