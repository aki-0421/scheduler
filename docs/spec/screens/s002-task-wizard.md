---
title: S002 Task Wizard
description: Task Wizard の create、follow-up、edit、duplicate flow、field、validation、lock、safety requirement を定義する。
updated: 2026-07-09
read_when:
  - task creation、task editing、task duplication、follow-up task prefill、schedule control、target selection、advanced policy、lock behavior、wizard validation を変更するとき。
---

# S002 Task Wizard

ルートと surface: `/tasks/new`、`/tasks/new?prefillFromTask=<taskId>&sourceRun=<runId>`、task detail 上の edit / duplicate dialog。

目的: 明示的な prompt、target、schedule、execution、permission、retry、cleanup、lock control を持つ scheduled Codex work を作成、follow up、複製、または編集する。

入口: `New task`、task session detail からの follow-up action、task detail の edit / duplicate action。

出口:

- create または follow-up 成功時は `/tasks?task=<newTaskId>` に redirect する。
- duplicate 成功時は複製された task の `/tasks?task=<newTaskId>` に redirect する。
- edit 成功時は dialog を閉じ、task detail を refresh する。
- cancel は `/tasks` または task detail に戻るか edit dialog を閉じる。

データ依存:

- follow-up prefill には `useTask(prefillFromTask)` を使う。
- project selection には `useProjects()` を使う。
- inline project add には `ipcClient.projectPickFolder()` と project registration mutation を使う。
- save には `useCreateTask()` と `useUpdateTask()` を使う。
- prompt import には `ipcClient.promptImportFile()` を使う。
- schedule preview と validation には `getCronPreview()` と timezone helper を使う。

レイアウト領域:

- page または dialog header。
- validation failure 時の error summary alert。
- tabs: `基本`、`実行先`、`スケジュール`、`詳細`。
- `基本` tab: required main flow。prompt、task name、任意の description を同じ画面にまとめる。
- `実行先` tab: target mode、project selector、folder picker、base ref、local modification warning。
- `スケジュール` tab: schedule selector、schedule-specific fields、timezone、preview。
- `詳細` tab: Codex model、permission、retry、cleanup、scheduler CLI、lock / pause safety controls。
- tab content の先頭には、tab label と同義の section heading や説明文を置かない。
- cancel、save paused、save active の footer action。

フィールドとコントロール:

- prompt textarea、import prompt button、task name、任意の description。
- target mode: chat workspace、existing repository、fresh worktree。
- project selector: registered project または folder picker から追加した project。
- repository path は手入力ではなく project selection / folder picker によって設定する。
- base ref。
- schedule selector: manual、once、hourly、daily、weekdays、weekly、custom cron。
- once date and time、preset time、weekly day、custom 5-field cron、timezone、next-five-runs preview。
- advanced settings: Codex path display、model、reasoning effort、sandbox、approval policy、max runtime、retries、overlap、missed runs、cleanup、schedule CLI switch、scheduler instruction switch、capability checkbox、max created schedules、start paused switch。通常は default のままでよいため `詳細` tab に置き、main flow から外す。
- full filesystem access confirmation checkbox は `danger-full-access` の場合にのみ表示される。
- lock switch は task を AI / scheduled-run actor からの edit / delete / pause / resume から保護する。create 時の default は unlocked、duplicate 時は unlocked に戻す。

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
- Task lock は default off。

バリデーションとエラー:

- required: prompt、task name、timezone、model、reasoning effort。
- repository target には registered project が必要。
- once schedule には selected timezone に対して valid な date and time が必要。
- custom cron は valid な 5-field expression である必要がある。seconds は rejected。
- max runtime は少なくとも 60 seconds。
- retries は negative にできない。
- max created schedules は 1 through 100。
- locked task の edit は unlock されるまで blocked される。
- full filesystem access には explicit confirmation が必要。
- validation failure は clickable field link を含む destructive summary を表示し、first error がある tab へ切り替えてから focus する。

状態:

- follow-up prefill loading は skeleton content を表示する。
- project selection state は registered project name と local path を表示する。
- existing repository かつ workspace-write の場合、local change が変更され得る warning を表示する。
- locked task edit は lock badge と unlock guidance を表示する。
- cron preview は valid な場合に next five runs、once schedule の場合に once preview、manual task の場合に manual guidance、invalid な場合に fix-schedule guidance を表示する。
- hidden tab の field に validation error がある場合、対象 tab は自動で選択される。

アクセシビリティ:

- field error は field component または `aria-invalid` で関連付けられる。
- error summary button は target field へ scroll and focus する。
- switch と checkbox は label と description を含む。
- lock switch は lock が AI / scheduled-run actor に対して何を防ぐかを説明する。
- dangerous access confirmation は inline field-level error を含む。

セキュリティと安全性:

- repository task は save 前に project scope を surface する。
- `danger-full-access` は単なる dropdown value ではない。warning と required confirmation を開く。
- Schedule CLI capability は explicit であり、`maxCreatedSchedulesPerRun` によって capped される。
- locked task は scheduled Codex session による edit / delete / pause / resume を拒否するため、lock / unlock は audit に記録する。

受け入れ条件:

- prompt または name が empty の場合、save は error summary を表示し、`基本` tab 内の最初の invalid field に focus する。
- repository、schedule、advanced field に error がある場合、save は対象 tab を開いて field に focus する。
- repository target に project がない場合、save は blocked される。
- locked task を edit しようとした場合、unlock なしでは save できない。
- `danger-full-access` に confirmation がない場合、save は blocked される。
- valid cron schedule の場合、preview は next five runs を list する。
- create が成功した場合、user は `/tasks?task=<newTaskId>` に遷移する。
- duplicate が成功した場合、lock state は unlocked で作成される。
- edit が成功した場合、edit dialog は閉じ、task detail data は refresh する。

既知の gap:

- UI は explicit schedule control と cron を使う。natural-language schedule parsing は実装されていない。
