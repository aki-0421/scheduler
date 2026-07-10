---
title: S004 Projects
description: Projects screen の file-browser-based project registration、read-only project table、project settings dialog を定義する。
updated: 2026-07-10
read_when:
  - Projects page、project registration、folder picker、project naming、repository display、project task impact messaging を変更するとき。
---

# S004 Projects

ルート: `/projects`

目的: scheduled task の isolated worktree source として使う Git repository を登録、確認、編集できるようにする。project は追加された時点でユーザーが worktree source として使うことを許可した scope とみなし、`Trusted Project` という別概念は UI から排除する。

入口: sidebar 先頭の `プロジェクト` item、task wizard の project selector、root route redirect。

出口: project list、project settings dialog、task wizard、project removal confirmation。

データ依存:

- project record には `useProjects()` を使う。
- project add は desktop folder picker command を呼び出し、選択された directory の Git root を project として登録する。Git root を検出できない directory は拒否する。default branch が未設定の場合、daemon は `origin/main`、`origin/master`、local `main`、local `master` の順に検出して保存する。
- project update は display name と project metadata を保存する。
- project remove で影響を受ける active task count には `useTasks()` を使う。

レイアウト領域:

- `プロジェクト` title と `Gitプロジェクトを追加` action を持つ header。header の文脈説明は title 右の `?` tooltip に置き、subtitle として常時表示しない。
- registered project table。`プロジェクト一覧` のような title と同義の section heading や count 説明文は表示しない。
- registered project table は page canvas に直接配置し、rounded border、別背景、shadow、内側 padding を組み合わせた外側 panel で囲まない。table header と row divider は維持する。
- project table row は読み取り専用で、row click または settings icon から project settings dialog を開く。
- project settings dialog。
- remove project confirmation dialog。

フィールドとコントロール:

- `Gitプロジェクトを追加`: file browser UI から directory を選択する。直接 path input は表示しない。
- Project display name: GitHub remote を検出できる場合は `user(org)/repo` を既定表示にする。GitHub ではない Git project は project settings dialog で任意の project name を編集できる。
- Project metadata: local path、Git root、default branch、Git remote。
- Project kind は table の種類 column ではなく、project title の先頭 icon で表示する。
- Active task count と default branch は icon と semantic color を持つ compact token で表示する。文字だけの cell にしない。
- Active tasks count: project を対象にする active task count。zero は muted、active count は success tone で表示する。
- Project table の local path は文字列として表示しない。folder icon button で path を clipboard にコピーする。
- Actions: copy local path、open project settings、edit name、remove project。

状態:

- folder picker canceled は error ではなく neutral toast または no-op とする。
- empty project list は表示領域を埋める高さで `プロジェクトがまだありません` を表示し、file browser action を提供する。
- GitHub remote detected: name は `owner/repo` または `org/repo` として表示する。
- Non-GitHub Git project: table では project name を読み取り専用で表示し、project settings dialog で編集する。未設定時は repository basename を使う。
- project remove success toast は affected active task count を含む。

バリデーションとエラー:

- selected directory が取得できない場合、mutation は送信しない。
- selected directory から Git root を検出できない場合、project は作成せず、Git repository が必要であることを error toast で説明する。
- project display name は non-GitHub project では empty にできない。GitHub project は remote-derived display name を既定値に戻せる。
- add / update / remove failure は利用可能な detail を含む error toast を表示する。
- remove は confirmation を必要とし、project を参照する active task が実行できなくなる可能性を説明する。

アクセシビリティ:

- folder picker trigger は project-specific ではない明確な label を持つ。
- settings icon button は keyboard で project settings dialog を開ける。
- path copy button は project-specific `aria-label` を含み、row click と衝突しない。
- edit name control は project-specific `aria-label` を含む。
- remove project button は project-specific `aria-label` を含む。
- confirmation dialog は clear cancel action と destructive action を持つ。

セキュリティと安全性:

- project 追加は explicit かつ file browser selection based である。
- project 追加後は、その Git repository を scheduler-owned worktree の source として利用可能な user-owned scope とみなす。project root 自体をCodexの作業 directory にしない。別途 `Trusted Project` badge や trust timestamp を表示しない。
- project removal は local file や run history を削除しない。
- active task impact は removal 前に計算・表示される。

受け入れ条件:

- Projects page に path text input が表示されず、directory selection は file browser UI から開始される。
- Git repository ではない directory を追加しようとすると登録は拒否される。
- Projects table に local path 文字列は表示されず、folder icon button から path をコピーできる。
- Projects table に `種類` column は表示されず、project kind は project title 先頭の icon で判別できる。
- Projects table の row または settings icon を押すと project settings dialog が開く。
- Projects table は読み取り専用で、display name 編集と削除は project settings dialog から行う。
- GitHub remote がある project は `user(org)/repo` 形式で表示される。
- GitHub remote がない project は display name を編集できる。
- project が追加された後、別途 trust / untrust action または `信頼済み` badge が表示されない。
- project removal が confirmed された場合、affected active task count が success toast に表示される。
- Projects table と empty state は page-level panel surface を持たない。

既知の gap:

- GitHub 以外の remote hosting service は remote-derived display name を持たず、local display name を user-editable にする。
