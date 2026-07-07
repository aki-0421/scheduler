# 参照情報

確認日: 2026-07-07

このファイルは仕様作成時に参照した公式ドキュメントの要点メモである。実装時にはリンク先の最新内容を再確認すること。

## 1. OpenAI Codex App / CLI

### Codex App Automations

URL: https://developers.openai.com/codex/app/automations

要点:

- Codex App は recurring Codex tasks を background で自動化できる。
- automation は prompt と schedule/cadence を持つ。
- project-scoped automation は、ローカル Codex app が起動していて、machine が powered on で、project が disk 上で利用可能である必要がある。
- Git repository では local project 直接実行と dedicated worktree 実行を選べる。
- worktree は automation の変更を未完了のローカル作業から隔離する。
- sandbox 設定は重要で、full access の background automation は elevated risk を持つ。

仕様への反映:

- MVP はローカル Mac が起動中、app/daemon 実行中を前提にする。
- repo-local と repo-worktree を両方サポートする。
- worktree を推奨 default にする。
- sandbox / permission 設定を task ごとに持つ。

### Codex App Features

URL: https://developers.openai.com/codex/app/features

要点:

- Codex App は parallel threads、worktree support、automations、Git functionality を持つ desktop experience。
- project は CLI で特定 directory から session を開始する感覚に近い。

仕様への反映:

- Sidebar で project と task/run を横断管理する。
- 指定 repository の worktree 実行を中核機能にする。

### Codex CLI Reference

URL: https://developers.openai.com/codex/cli/reference

要点:

- `codex exec` は scripted / CI-style の非対話実行向け。
- `codex exec` は `--cd`、`--json`、`--model`、`--sandbox`、`--output-last-message`、stdin prompt `-` などを持つ。
- `--dangerously-bypass-approvals-and-sandbox` は isolated runner 以外で危険。

仕様への反映:

- scheduled run は `codex exec` を利用する。
- prompt は stdin から渡す。
- output/log を保存する。
- full bypass は advanced dangerous setting にする。

### Codex Best Practices

URL: https://developers.openai.com/codex/learn/best-practices

要点:

- repeatable workflow は skill と automation に分ける設計が推奨される。
- automation は project、prompt、cadence、execution environment を選択する。
- 良い候補は log triage、release notes、PR review、CI failure check、standup summary など。

仕様への反映:

- task prompt は skills を呼び出せる前提で自由 text にする。
- UI の example templates に PR review、release notes、CI check を含める。

## 2. Anthropic Claude Code

### Claude Code Desktop scheduled tasks

URL: https://code.claude.com/docs/en/desktop-scheduled-tasks

要点:

- local scheduled tasks は Desktop app が開いていて computer が awake のときに実行される。
- recurring work と one-off work を扱える。
- 最短 interval は Desktop tasks と `/loop` で 1 minute。
- fresh session を scheduled section に作成する。
- worktree toggle により isolated Git worktree を使える。
- missed runs は起動/復帰時に確認し、過去 7 日以内の最新 1 件だけ catch-up する。
- permissions は task ごとに設定し、許可が必要な場合は run が stall しうる。
- scheduled task は `update_scheduled_task` MCP tool で自分の schedule/prompt を変更できる。

仕様への反映:

- 最短 1 分単位。
- once task。
- latest missed run catch-up policy。
- worktree toggle。
- task 自身が CLI で schedule update できる設計。
- run history / skipped reason / permission design。

### Claude Code Routines

URL: https://code.claude.com/docs/en/routines

要点:

- CLI の `/schedule` で conversational に scheduled routine を作れる。
- `/schedule list`、`/schedule update`、`/schedule run` で管理できる。
- cloud routine は local computer が off でも動くが、custom cron minimum は 1 hour。
- one-off schedule は指定 timestamp に 1 回実行され、実行後に auto-disable される。

仕様への反映:

- `codex-schedule` CLI で create/list/update/run-now を実装する。
- one-off は実行後 completed/disabled にする。
- cloud scheduler は MVP 対象外にする。

### Claude Code Common Workflows / Overview

URL: https://code.claude.com/docs/en/overview  
URL: https://code.claude.com/docs/en/common-workflows

要点:

- CLI は Unix philosophy に沿って pipe/script/automation に使える。
- schedule は recurring work、morning PR reviews、overnight CI failure analysis、weekly dependency audits などに使える。
- worktree で parallel sessions を実行し、同時編集の衝突を避ける。

仕様への反映:

- Codex CLI の stdin prompt / JSON output を重視する。
- worktree isolation を標準 UX にする。

## 3. Tauri / Next.js / shadcn/ui

### Tauri v2 Next.js guide

URL: https://v2.tauri.app/start/frontend/nextjs/

要点:

- Tauri v2 で Next.js frontend を使う場合の設定ガイド。
- static output を Tauri に bundle する構成が基本。

仕様への反映:

- Next.js は static export で使う。
- Tauri backend が OS/daemon/DB 連携を担当する。

### Next.js Static Exports

URL: https://nextjs.org/docs/app/guides/static-exports

要点:

- `next.config` の `output: 'export'` で static export が有効化される。
- server runtime が必要な機能は使わない前提にする。

仕様への反映:

- UI から backend 操作は Next.js API route ではなく Tauri command を使う。

### shadcn/ui Next.js installation

URL: https://ui.shadcn.com/docs/installation/next

要点:

- shadcn/ui は Next.js project に追加できる。
- Tailwind CSS と import alias が前提になる。

仕様への反映:

- shadcn/ui components を UI の基本部品として使う。
