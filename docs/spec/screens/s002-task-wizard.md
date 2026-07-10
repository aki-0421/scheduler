---
title: S002 Task Wizard
description: Task Wizard の create、follow-up、edit、duplicate flow、field、validation、Codex customization、lock requirement を定義する。
updated: 2026-07-10
read_when:
  - task creation、task editing、task duplication、follow-up task prefill、schedule control、target selection、Codex customization、lock behavior、wizard validation を変更するとき。
---

# S002 Task Wizard

ルートと surface: `/tasks/new`、`/tasks/new?prefillFromTask=<taskId>&sourceRun=<runId>`、task detail 上の edit / duplicate dialog。

目的: 明示的な prompt、target、schedule、Codex model / effort、任意の binary path、lock control を持つ scheduled Codex work を作成、follow up、複製、または編集する。

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
- schedule preview と validation には `getCronPreview()`、`getSystemTimezone()`、timezone conversion helper を使う。

レイアウト領域:

- page または dialog header。
- page header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- validation failure 時の error summary alert。
- tabs: `タスク`、`詳細`。従来の `基本`、`実行先`、`スケジュール` は `タスク` tab に統合する。
- tab list は選択中 content の直上に配置する。横スクロール領域にはせず、利用可能な幅に収まらない場合は複数行へ折り返す。選択中の tab content と footer action は page canvas に直接配置し、外側の bordered panel とその内側 padding を置かない。
- `タスク` tab: task name、prompt、`チャット` / `プロジェクト` radio cards、Git project selector、Git folder picker、base ref、schedule selector、schedule-specific fields、PC timezone indicator、preview を同じ画面にまとめる。task description field は置かない。desktop width では task content と execution condition を 2 column に分け、狭い width では 1 column に戻す。
- prompt textarea は resize 可能なまま compact な初期高にし、next-five-runs preview は複数列で表示できる幅では 2 column にして縦方向の占有を抑える。
- `詳細` tab: 任意の Codex binary path customization、Codex model、reasoning effort、lock / pause controls。field は 2 column の compact layout で表示し、policy 説明や固定値の summary を置かない。
- tab content の先頭には、tab label と同義の section heading や説明文を置かない。
- cancel、save paused、save active の footer action。

フィールドとコントロール:

- prompt textarea、import prompt button、task name。task の内容は task name と prompt だけで表す。
- target radio cards: `チャット` は app-managed workspace、`プロジェクト` は registered Git project の isolated worktree。
- project selector: registered Git project、または Git repository folder picker から追加した project。folder project は選択肢に出さない。
- repository path は手入力ではなく project selection / Git folder picker によって設定する。project target は常に `repo-worktree` DTO を生成する。
- base ref。
- schedule selector: manual、once、hourly、daily、weekdays、weekly、custom cron。
- once date and time、preset time、weekly day、custom 5-field cron、PC timezone indicator、next-five-runs preview。
- advanced settings: `Codex バイナリパスをカスタマイズ` checkbox、checkbox が on の場合だけ表示する path input、model select、model が対応する reasoning effort select、start paused switch。通常は default のままでよいため `詳細` tab に置き、main flow から外す。
- lock switch は task を AI / scheduled-run actor からの edit / delete / pause / resume から保護する。create 時の default は unlocked、duplicate 時は unlocked に戻す。

既定値:

- default cron expression は `0 9 * * 1-5` で、weekdays at 09:00 として推論される。
- timezone は browser が解決した現在の PC timezone を自動使用し、取得できない場合は `UTC` を使う。user-selectable default は持たない。
- default model は `gpt-5.5`。
- model と effort の組み合わせは Codex model catalog に合わせる。`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini` は `low / medium / high / xhigh` に対応し default は `medium`、`gpt-5.3-codex-spark` は同じ effort に対応し default は `high`。内部用の `codex-auto-review` は表示しない。
- task 固有 Codex binary path customization は default off。off の場合は global path または `PATH` を使う。
- Task lock は default off。

model catalog を更新するときは、bundled version と同等の Codex CLI で `codex debug models` を実行し、各 model の `supported_reasoning_levels` と `default_reasoning_level` を確認する。あわせて OpenAI 公式 model / Codex config reference と照合し、内部用途の model は task wizard に追加しない。

バリデーションとエラー:

- required: prompt、task name、frontier model、選択 model が対応する reasoning effort。timezone は PC から自動設定される内部必須値である。
- Codex binary path customization が on の場合、空ではない path が必要。
- project target には Git root を持つ registered Git project が必要。
- once schedule には現在の PC timezone に対して valid な date and time が必要。
- custom cron は valid な 5-field expression である必要がある。seconds は rejected。
- locked task の edit は unlock されるまで blocked される。
- validation failure は clickable field link を含む destructive summary を表示し、first error がある tab へ切り替えてから focus する。

状態:

- follow-up prefill loading は skeleton content を表示する。
- follow-up prefill は source run ID の文脈を prompt 冒頭に追加し、元 task の prompt を続ける。duplicate は元 task の prompt をそのまま複製する。
- project selection state は registered project name と local path を表示する。
- project target は実行ごとに isolated worktree を作成し、登録した project root を直接変更しないことを表示する。
- locked task edit は lock badge と unlock guidance を表示する。
- cron preview は valid な場合に next five runs、once schedule の場合に once preview、manual task の場合に manual guidance、invalid な場合に fix-schedule guidance を表示する。
- manual 以外の schedule summary は、現在の PC timezone を自動使用することと IANA timezone 名を表示する。
- hidden tab の field に validation error がある場合、対象 tab は自動で選択される。

アクセシビリティ:

- field error は field component または `aria-invalid` で関連付けられる。
- error summary button は target field へ scroll and focus する。
- switch と checkbox は label と description を含む。
- lock switch は lock が AI / scheduled-run actor に対して何を防ぐかを説明する。

セキュリティと安全性:

- project task は save 前に Git project scope と isolated worktree execution を surface する。
- full access、approval request なし、timeout なし、自動 retry なし、重複時 skip、未実行分 skip、worktree 保持、Scheduler CLI の全 action と作成数無制限は app-wide invariant として UI に表示しない。
- locked task は scheduled Codex session による edit / delete / pause / resume を拒否するため、lock / unlock は audit に記録する。

受け入れ条件:

- prompt、name、repository、schedule field に error がある場合、save は error summary を表示し、`タスク` tab 内の最初の invalid field に focus する。
- advanced field に error がある場合、save は `詳細` tab を開いて field に focus する。
- project target に registered Git project がない場合、save は blocked される。
- 実行先は `チャット` / `プロジェクト` の keyboard-operable radio cards で選択でき、`プロジェクト` を保存した DTO は `repo-worktree` になる。
- locked task を edit しようとした場合、unlock なしでは save できない。
- Codex binary path customization を on にすると path input が表示され、off に戻すと task 固有 path を保存 DTO から削除する。
- model を変更すると reasoning effort はその model の default に切り替わり、その後 user が対応 effort から変更できる。
- valid cron schedule の場合、preview は next five runs を list する。
- create、follow-up、duplicate、edit では timezone selector を表示せず、保存時点の PC timezone を task DTO に設定する。
- create が成功した場合、user は `/tasks?task=<newTaskId>` に遷移する。
- duplicate が成功した場合、lock state は unlocked で作成される。
- edit が成功した場合、edit dialog は閉じ、task detail data は refresh する。
- create、follow-up、duplicate、edit のすべてで、`タスク` / `詳細` の tab content と footer action は page-level panel surface なしで表示される。
- tab list は横方向にスクロールせず、狭い幅でもすべての tab が表示される。
- desktop width の `タスク` tab は主要フィールドを 2 column に分け、既定の chat / weekdays state を過度な縦スクロールなしで確認できる。
- create、follow-up、duplicate、edit のいずれにも task description input は表示されず、保存 DTO に description field を含めない。

既知の gap:

- UI は explicit schedule control と cron を使う。natural-language schedule parsing は実装されていない。
