---
title: S002 Task Wizard
description: Task Wizard の create、follow-up、edit、duplicate flow、field、3 section layout、validation、lock requirement を定義する。
updated: 2026-07-10
read_when:
  - task creation、task editing、task duplication、follow-up task prefill、schedule control、target selection、model control、lock behavior、wizard layout、wizard validation を変更するとき。
---

# S002 Task Wizard

ルートと surface: `/tasks/new`、`/tasks/new?prefillFromTask=<taskId>&sourceRun=<runId>`、task detail の `設定` tab にある inline edit form。

目的: 明示的な prompt、target、schedule、Codex model / effort、lock control を持つ scheduled Codex work を作成、follow up、複製、または編集する。

入口: `New task`、task session detail からの follow-up action、task detail の `設定` tab、duplicate action。

出口:

- create または follow-up 成功時は `/tasks?task=<newTaskId>` に redirect する。
- duplicate 成功時は複製された task の `/tasks?task=<newTaskId>` に redirect する。
- edit 成功時は task detail に留まり、task detail data を refresh する。
- create、follow-up、duplicate page と task detail の inline edit form には cancel button を置かず、sidebar、breadcrumb、browser navigation または tab から離脱する。

データ依存:

- follow-up prefill には `useTask(prefillFromTask)` を使う。
- project selection には `useProjects()` を使う。
- save には `useCreateTask()` と `useUpdateTask()` を使う。
- prompt import には `ipcClient.promptImportFile()` を使う。
- schedule validation と next-run calculation には `getCronPreview()`、`getSystemTimezone()`、timezone conversion helper を使う。実行タイミングの preview は画面に表示しない。

レイアウト領域:

- create、follow-up、duplicate page header。task detail では既存の page header と tabs を使い、wizard 固有 header は置かない。
- page header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- create、follow-up、duplicate page の `一時停止で作成` と `タスクを作成` は page title と同じ header section の右側に置く。狭い width では title の下に折り返す。
- validation failure 時の error summary alert。
- task name、schedule、model、思考レベル、`チャット` / `プロジェクト` radio cards、Git project selector、prompt、lock / pause control を tab 切り替えなしの 1 画面にまとめる。task description field は置かない。
- first section は task name と schedule を等分の 2 column で表示する。schedule selector と schedule-specific control は内容に合う compact width で左寄せし、desktop width で column 幅いっぱいに stretch しない。狭い width では 1 column に戻す。
- second section は model と `思考レベル` を左寄せの compact control として横並びにし、狭い width では折り返す。
- third section は desktop width でおよそ `3:1` の 2 column にする。左側は target と prompt、右側は compact な `オプション` group として lock / pause control を表示する。狭い width では 1 column に戻す。
- prompt textarea は resize 可能なまま compact な初期高にする。実行タイミングの summary、next-five-runs、once preview、manual guidance、PC timezone の補助文は表示しない。
- section は page canvas に直接配置する。task name / schedule と model / 思考レベルの間には separator を置かず、実行内容と options の前だけを separator で区切る。panel surface や固定 execution policy の summary は置かない。
- task detail の inline edit form は末尾に right-aligned save action だけを置く。create、follow-up、duplicate page には footer action を置かない。

フィールドとコントロール:

- prompt textarea、import prompt button、task name。task の内容は task name と prompt だけで表す。
- target radio cards: `チャット` は app-managed workspace、`プロジェクト` は registered Git project の isolated worktree。
- project selector: Projects screen で登録済みの Git project だけを選択する。task wizard には project の追加・設定 action、repository path、base ref input を表示しない。project selection 時に repository path と default branch を draft へ内部設定する。folder project は選択肢に出さない。
- project target は常に `repo-worktree` DTO を生成する。
- schedule selector: manual、once、hourly、daily、weekdays、weekly、custom cron。
- once date and time、preset time、weekly day、custom 5-field cron。実行タイミングの preview と PC timezone indicator は表示しない。
- model select と、model が対応する `思考レベル` select。DTO field 名は `reasoningEffort` のままとする。Codex binary path は global setting のため表示しない。
- options: task lock switch と start paused switch。third section の右 column に compact にまとめる。
- lock switch は task を AI エージェントが使う CLI / scheduled-run actor からの edit / delete / pause / resume から保護する。desktop UI からの編集は制限しない。create 時の default は unlocked、duplicate 時は unlocked に戻す。

既定値:

- default cron expression は `0 9 * * 1-5` で、weekdays at 09:00 として推論される。
- timezone は browser が解決した現在の PC timezone を自動使用し、取得できない場合は `UTC` を使う。user-selectable default は持たない。
- default model は `gpt-5.5`。
- model と effort の組み合わせは Codex model catalog に合わせる。`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini` は `low / medium / high / xhigh` に対応し default は `medium`、`gpt-5.3-codex-spark` は同じ effort に対応し default は `high`。内部用の `codex-auto-review` は表示しない。
- Task lock は default off。

model catalog を更新するときは、bundled version と同等の Codex CLI で `codex debug models` を実行し、各 model の `supported_reasoning_levels` と `default_reasoning_level` を確認する。あわせて OpenAI 公式 model / Codex config reference と照合し、内部用途の model は task wizard に追加しない。

バリデーションとエラー:

- required: task name、schedule、frontier model、選択 model が対応する思考レベル、prompt。required field の label には必須表示を付け、native control と custom select の両方へ required semantics を設定する。timezone は PC から自動設定される内部必須値である。
- create、follow-up、duplicate の `一時停止で作成` と `タスクを作成`、edit の `変更を保存` は、全 required field と選択中 schedule の固有 field が valid になるまで disabled にする。save handler でも同じ validation を再実行する。
- project target には Git root を持つ registered Git project が必要。
- once schedule には現在の PC timezone に対して valid な date and time が必要。
- daily、weekdays、weekly schedule には valid な time が必要で、weekly schedule には day of week も必要。
- custom cron は valid な 5-field expression である必要がある。seconds は rejected。
- save handler が validation failure を検出した場合は clickable field link を含む destructive summary を表示し、同じ画面内の first error へ scroll して focus する。

状態:

- follow-up prefill loading は skeleton content を表示する。
- follow-up prefill は source run ID の文脈を prompt 冒頭に追加し、元 task の prompt を続ける。duplicate は元 task の prompt をそのまま複製する。
- project selection state は registered project name を Select に表示する。local path や project registration action は表示しない。
- locked task edit も task detail 側の form controls と save action を利用できる。settings 内に lock warning や unlock guidance は表示せず、detail header の unlock action は lock state の変更手段として表示する。
- schedule control は実行タイミングの preview、timezone selector、PC timezone の補助文を表示しない。現在の PC timezone は内部で自動使用する。

アクセシビリティ:

- field error は field component または `aria-invalid` で関連付けられる。
- error summary button は target field へ scroll and focus する。
- switch と checkbox は label と description を含む。
- lock switch は lock が AI エージェントと CLI / scheduled-run actor に対して何を防ぎ、desktop UI の編集は制限しないことを説明する。

検証:

- `pnpm --filter desktop exec vitest run test/task-wizard.test.tsx` は required field、schedule validation、create action の disabled / enabled 遷移、保存 DTO を検証する。
- UI を変更した場合は `agent-browser` で `/tasks/new/` を開き、required field が空または schedule が invalid な状態では両 create action が disabled、すべて valid な状態では enabled になることを accessibility snapshot と screenshot で確認する。project target では登録済み project の Select だけが表示され、project 追加 action、base ref input、PC timezone の補助文がないことも確認する。

セキュリティと安全性:

- project task は save 前に Git project scope と isolated worktree execution を surface する。
- full access、approval request なし、timeout なし、自動 retry なし、重複時 skip、未実行分 skip、worktree 保持、Scheduler CLI の全 action と作成数無制限は app-wide invariant として UI に表示しない。
- locked task は CLI / scheduled Codex session による edit / delete / pause / resume を拒否する。desktop UI の user actor は lock 中も編集でき、lock / unlock は audit に記録する。

受け入れ条件:

- task name、schedule、model、思考レベル、prompt のいずれか、または選択中 schedule の固有 field が未入力・invalid な間は create action が disabled で、すべて valid になると enabled になる。`一時停止で作成` と edit の `変更を保存` も同じ条件を使う。
- save handler が prompt、name、repository、schedule、advanced field の error を検出した場合は error summary を表示し、同じ画面内の最初の invalid field に focus する。
- project target に registered Git project がない場合、save は blocked される。
- task wizard では project の追加・設定ができず、Projects screen で登録済みの Git project を Select で選ぶだけにする。repository path、base ref input、PC timezone の補助文は表示しない。
- 実行先は `チャット` / `プロジェクト` の keyboard-operable radio cards で選択でき、`プロジェクト` を保存した DTO は `repo-worktree` になる。
- locked task も desktop UI では unlock せずに edit と save ができる。
- create、follow-up、duplicate、edit のいずれにも Codex binary path field は表示されず、保存 DTO に task 固有 path を含めない。
- model を変更すると思考レベルはその model の default に切り替わり、その後 user が対応 level から変更できる。
- valid schedule でも実行タイミングの preview は表示しない。custom cron の invalid state は field error として即時表示する。
- create、follow-up、duplicate、edit では timezone selector を表示せず、保存時点の PC timezone を task DTO に設定する。
- create が成功した場合、user は `/tasks?task=<newTaskId>` に遷移する。
- duplicate が成功した場合、lock state は unlocked で作成される。
- edit が成功した場合、task detail に留まり、task detail data は refresh する。
- create、follow-up、duplicate、edit のすべてで、基本設定、model 設定、実行内容と options が wizard 内の tab 切り替えなしで 1 画面に表示される。task detail 自体の `設定` tab 内でも同じ section order と controls を再利用する。
- create、follow-up、duplicate page では cancel button が表示されず、`一時停止で作成` と `タスクを作成` が page title と同じ header section の右側に表示される。
- task detail の inline edit form では cancel button が表示されず、`変更を保存` が form 末尾の右側に表示される。
- desktop width では first section が task name / schedule の等分 2 column、second section が左寄せの model / 思考レベル、third section が target・prompt / options のおよそ `3:1` になる。
- task name / schedule と model / 思考レベルは separator なしで連続して表示し、model / 思考レベルと実行内容の間だけに separator を表示する。
- create、follow-up、duplicate、edit のいずれにも task description input は表示されず、保存 DTO に description field を含めない。

既知の gap:

- UI は explicit schedule control と cron を使う。natural-language schedule parsing は実装されていない。
