---
title: S002 Task Wizard
description: Task Wizard の create、follow-up、edit、duplicate flow、field、3 section layout、validation、lock requirement を定義する。
updated: 2026-07-10
read_when:
  - task creation、task editing、task duplication、follow-up task prefill、schedule control、target selection、model control、lock behavior、wizard layout、wizard validation を変更するとき。
---

# S002 Task Wizard

ルートと surface: `/tasks/new`、`/tasks/new?prefillFromTask=<taskId>&sourceRun=<runId>`、task detail 上の edit / duplicate dialog。

目的: 明示的な prompt、target、schedule、Codex model / effort、lock control を持つ scheduled Codex work を作成、follow up、複製、または編集する。

入口: `New task`、task session detail からの follow-up action、task detail の edit / duplicate action。

出口:

- create または follow-up 成功時は `/tasks?task=<newTaskId>` に redirect する。
- duplicate 成功時は複製された task の `/tasks?task=<newTaskId>` に redirect する。
- edit 成功時は dialog を閉じ、task detail を refresh する。
- create、follow-up、duplicate page には cancel button を置かず、sidebar、breadcrumb、browser navigation から離脱する。edit dialog の cancel は dialog を閉じる。

データ依存:

- follow-up prefill には `useTask(prefillFromTask)` を使う。
- project selection には `useProjects()` を使う。
- inline project add には `ipcClient.projectPickFolder()` と project registration mutation を使う。
- save には `useCreateTask()` と `useUpdateTask()` を使う。
- prompt import には `ipcClient.promptImportFile()` を使う。
- schedule validation と next-run calculation には `getCronPreview()`、`getSystemTimezone()`、timezone conversion helper を使う。実行タイミングの preview は画面に表示しない。

レイアウト領域:

- page または dialog header。
- page header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- create、follow-up、duplicate page の `一時停止で作成` と `タスクを作成` は page title と同じ header section の右側に置く。狭い width では title の下に折り返す。
- validation failure 時の error summary alert。
- task name、schedule、model、思考レベル、`チャット` / `プロジェクト` radio cards、Git project selector、Git folder picker、base ref、prompt、lock / pause control を tab 切り替えなしの 1 画面にまとめる。task description field は置かない。
- first section は task name と schedule を等分の 2 column で表示する。schedule selector と schedule-specific control は内容に合う compact width で左寄せし、desktop width で column 幅いっぱいに stretch しない。狭い width では 1 column に戻す。
- second section は model と `思考レベル` を左寄せの compact control として横並びにし、狭い width では折り返す。
- third section は desktop width でおよそ `3:1` の 2 column にする。左側は target と prompt、右側は compact な `オプション` group として lock / pause control を表示する。狭い width では 1 column に戻す。
- prompt textarea は resize 可能なまま compact な初期高にする。実行タイミングの summary、next-five-runs、once preview、manual guidance は表示しない。PC timezone は schedule control 直下の補助文として表示する。
- section は page canvas に直接配置し、separator で区切る。panel surface や固定 execution policy の summary は置かない。
- edit dialog の footer には cancel と save action を置く。create、follow-up、duplicate page には footer action を置かない。

フィールドとコントロール:

- prompt textarea、import prompt button、task name。task の内容は task name と prompt だけで表す。
- target radio cards: `チャット` は app-managed workspace、`プロジェクト` は registered Git project の isolated worktree。
- project selector: registered Git project、または Git repository folder picker から追加した project。folder project は選択肢に出さない。
- repository path は手入力ではなく project selection / Git folder picker によって設定する。project target は常に `repo-worktree` DTO を生成する。
- base ref。
- schedule selector: manual、once、hourly、daily、weekdays、weekly、custom cron。
- once date and time、preset time、weekly day、custom 5-field cron、PC timezone indicator。実行タイミングの preview は表示しない。
- model select と、model が対応する `思考レベル` select。DTO field 名は `reasoningEffort` のままとする。Codex binary path は global setting のため表示しない。
- options: task lock switch と start paused switch。third section の右 column に compact にまとめる。
- lock switch は task を AI / scheduled-run actor からの edit / delete / pause / resume から保護する。create 時の default は unlocked、duplicate 時は unlocked に戻す。

既定値:

- default cron expression は `0 9 * * 1-5` で、weekdays at 09:00 として推論される。
- timezone は browser が解決した現在の PC timezone を自動使用し、取得できない場合は `UTC` を使う。user-selectable default は持たない。
- default model は `gpt-5.5`。
- model と effort の組み合わせは Codex model catalog に合わせる。`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini` は `low / medium / high / xhigh` に対応し default は `medium`、`gpt-5.3-codex-spark` は同じ effort に対応し default は `high`。内部用の `codex-auto-review` は表示しない。
- Task lock は default off。

model catalog を更新するときは、bundled version と同等の Codex CLI で `codex debug models` を実行し、各 model の `supported_reasoning_levels` と `default_reasoning_level` を確認する。あわせて OpenAI 公式 model / Codex config reference と照合し、内部用途の model は task wizard に追加しない。

バリデーションとエラー:

- required: prompt、task name、frontier model、選択 model が対応する思考レベル。timezone は PC から自動設定される内部必須値である。
- project target には Git root を持つ registered Git project が必要。
- once schedule には現在の PC timezone に対して valid な date and time が必要。
- custom cron は valid な 5-field expression である必要がある。seconds は rejected。
- locked task の edit は unlock されるまで blocked される。
- validation failure は clickable field link を含む destructive summary を表示し、同じ画面内の first error へ scroll して focus する。

状態:

- follow-up prefill loading は skeleton content を表示する。
- follow-up prefill は source run ID の文脈を prompt 冒頭に追加し、元 task の prompt を続ける。duplicate は元 task の prompt をそのまま複製する。
- project selection state は registered project name と local path を表示する。
- project target は実行ごとに isolated worktree を作成し、登録した project root を直接変更しないことを表示する。
- locked task edit は lock badge と unlock guidance を表示する。
- schedule control は実行タイミングの preview を表示しない。manual 以外では、現在の PC timezone を自動使用することと IANA timezone 名だけを補助文として表示する。

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

- prompt、name、repository、schedule、advanced field に error がある場合、save は error summary を表示し、同じ画面内の最初の invalid field に focus する。
- project target に registered Git project がない場合、save は blocked される。
- 実行先は `チャット` / `プロジェクト` の keyboard-operable radio cards で選択でき、`プロジェクト` を保存した DTO は `repo-worktree` になる。
- locked task を edit しようとした場合、unlock なしでは save できない。
- create、follow-up、duplicate、edit のいずれにも Codex binary path field は表示されず、保存 DTO に task 固有 path を含めない。
- model を変更すると思考レベルはその model の default に切り替わり、その後 user が対応 level から変更できる。
- valid schedule でも実行タイミングの preview は表示しない。custom cron の invalid state は field error として即時表示する。
- create、follow-up、duplicate、edit では timezone selector を表示せず、保存時点の PC timezone を task DTO に設定する。
- create が成功した場合、user は `/tasks?task=<newTaskId>` に遷移する。
- duplicate が成功した場合、lock state は unlocked で作成される。
- edit が成功した場合、edit dialog は閉じ、task detail data は refresh する。
- create、follow-up、duplicate、edit のすべてで、基本設定、model 設定、実行内容と options が tab 切り替えなしの 1 画面に表示される。
- create、follow-up、duplicate page では cancel button が表示されず、`一時停止で作成` と `タスクを作成` が page title と同じ header section の右側に表示される。
- desktop width では first section が task name / schedule の等分 2 column、second section が左寄せの model / 思考レベル、third section が target・prompt / options のおよそ `3:1` になる。
- create、follow-up、duplicate、edit のいずれにも task description input は表示されず、保存 DTO に description field を含めない。

既知の gap:

- UI は explicit schedule control と cron を使う。natural-language schedule parsing は実装されていない。
