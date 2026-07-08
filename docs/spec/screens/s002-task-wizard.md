---
title: S002 Task Wizard
description: Task Wizard の create、follow-up、edit flow、field、validation、safety requirement を定義する。
updated: 2026-07-08
read_when:
  - task creation、task editing、follow-up task prefill、schedule control、target selection、advanced policy、wizard validation を変更するとき。
---

# S002 Task Wizard

ルートと surface: `/tasks/new`、`/tasks/new?prefillFromTask=<taskId>&sourceRun=<runId>`、`/tasks` 上の edit dialog。

目的: 明示的な prompt、target、schedule、execution、permission、retry、cleanup control を持つ scheduled Codex work を作成、follow up、または編集する。

入口: `New task`、run detail からの follow-up action、task edit action。

出口:

- create または follow-up 成功時は `/tasks?task=<newTaskId>` に redirect する。
- edit 成功時は dialog を閉じる。
- cancel は `/tasks` に戻るか edit dialog を閉じる。

データ依存:

- follow-up prefill には `useTask(prefillFromTask)` を使う。
- trusted project selection には `useProjects()` を使う。
- inline project trust には `useTrustProject()` を使う。
- save には `useCreateTask()` と `useUpdateTask()` を使う。
- folder picker には `ipcClient.projectPickFolder()` を使う。
- prompt import には `ipcClient.promptImportFile()` を使う。
- schedule preview と validation には `getCronPreview()` と timezone helper を使う。

レイアウト領域:

- page または dialog header。
- wizard purpose copy を持つ card header。
- validation failure 時の error summary alert。
- main prompt and identity column。
- target and schedule side column。
- advanced settings details panel。
- cancel、save paused、save active の footer action。

フィールドとコントロール:

- prompt textarea、import prompt button、task name、任意の description。
- target mode: chat workspace、existing repository、fresh worktree。
- project selector: trusted project または custom path。
- repository path、browse button、base ref、repository target 向け inline trust button。
- schedule selector: manual、once、hourly、daily、weekdays、weekly、custom cron。
- once date and time、preset time、weekly day、custom 5-field cron、timezone、next-five-runs preview。
- advanced settings: Codex path display、model、reasoning effort、sandbox、approval policy、max runtime、retries、overlap、missed runs、cleanup、schedule CLI switch、scheduler instruction switch、capability checkbox、max created schedules、start paused switch。
- full filesystem access confirmation checkbox は `danger-full-access` の場合にのみ表示される。

既定値:

- default cron expression は `0 9 * * 1-5` で、weekdays at 09:00 として推論される。
- default timezone は browser-resolved timezone または `Asia/Tokyo`。
- default model は `gpt-5-codex`。
- default reasoning effort は `default`。
- default sandbox は `read-only`。
- default approval policy は `never`。
- default max runtime は `7200` seconds。
- default missed policy は `latest_within_window`。
- default overlap policy は `skip`。
- default cleanup は `keep`。
- Schedule CLI は create、update-current、list capability 付きで default allowed。

バリデーションとエラー:

- required: prompt、task name、timezone、model、reasoning effort。
- repository target には repository path が必要。
- once schedule には selected timezone に対して valid な date and time が必要。
- custom cron は valid な 5-field expression である必要がある。seconds は rejected。
- max runtime は少なくとも 60 seconds。
- retries は negative にできない。
- max created schedules は 1 through 100。
- full filesystem access には explicit confirmation が必要。
- validation failure は clickable field link を含む destructive summary を表示し、first error に focus する。

状態:

- follow-up prefill loading は skeleton content を表示する。
- repository trust state は `Trusted` または `Not trusted` を表示する。
- existing repository かつ workspace-write の場合、local change が変更され得る warning を表示する。
- cron preview は valid な場合に next five runs、once schedule の場合に once preview、manual task の場合に manual guidance、invalid な場合に fix-schedule guidance を表示する。
- advanced field に validation error がある場合、advanced panel は自動で開く。

アクセシビリティ:

- field error は field component または `aria-invalid` で関連付けられる。
- error summary button は target field へ scroll and focus する。
- switch と checkbox は label と description を含む。
- dangerous access confirmation は inline field-level error を含む。

セキュリティと安全性:

- repository task は save 前に trust を surface する。
- `danger-full-access` は単なる dropdown value ではない。warning と required confirmation を開く。
- Schedule CLI capability は explicit であり、`maxCreatedSchedulesPerRun` によって capped される。

受け入れ条件:

- prompt または name が empty の場合、save は error summary を表示し、最初の invalid field に focus する。
- repository target に path がない場合、save は blocked される。
- `danger-full-access` に confirmation がない場合、save は blocked される。
- valid cron schedule の場合、preview は next five runs を list する。
- create が成功した場合、user は作成された task detail に遷移する。
- edit が成功した場合、edit dialog は閉じ、task detail data は refresh する。

既知の gap:

- UI は explicit schedule control と cron を使う。natural-language schedule parsing は実装されていない。
