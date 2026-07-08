---
title: S004 Projects
description: Projects screen の file-browser-based project registration、GitHub repository display、editable folder project name を定義する。
updated: 2026-07-09
read_when:
  - Projects page、project registration、folder picker、project naming、repository display、project task impact messaging を変更するとき。
---

# S004 Projects

ルート: `/projects`

目的: scheduled task の実行先として使う local folder または Git repository を登録、確認、編集できるようにする。project は追加された時点でユーザーが自由に編集してよい scope とみなし、`Trusted Project` という別概念は UI から排除する。

入口: sidebar 先頭の `プロジェクト` item、task wizard の project selector、root route redirect。

出口: project list、project edit action、task wizard、project removal confirmation。

データ依存:

- project record には `useProjects()` を使う。
- project add は desktop folder picker command を呼び出し、選択された directory を project として登録する。
- project update は display name と project metadata を保存する。
- project remove で影響を受ける active task count には `useTasks()` を使う。

レイアウト領域:

- `プロジェクト` title と `プロジェクトを追加` action を持つ header。header の補足説明文は表示しない。
- registered project table。`プロジェクト一覧` のような title と同義の section heading や count 説明文は表示しない。
- project edit inline row または dialog。
- remove project confirmation dialog。

フィールドとコントロール:

- `プロジェクトを追加`: file browser UI から directory を選択する。直接 path input は表示しない。
- Project display name: GitHub remote を検出できる場合は `user(org)/repo` を既定表示にする。GitHub ではない folder project は任意の project name を編集できる。
- Project metadata: kind、local path、Git root、default branch、GitHub remote。
- Active tasks count: project を対象にする active task count。
- Actions: edit name、open in Finder、remove project。

状態:

- folder picker canceled は error ではなく neutral toast または no-op とする。
- empty project list は `プロジェクトがまだありません` を表示し、file browser action を提供する。
- GitHub remote detected: name は `owner/repo` または `org/repo` として表示する。
- Non-GitHub folder: editable project name を表示し、未設定時は folder basename を使う。
- project remove success toast は affected active task count を含む。

バリデーションとエラー:

- selected directory が取得できない場合、mutation は送信しない。
- project display name は non-GitHub project では empty にできない。GitHub project は remote-derived display name を既定値に戻せる。
- add / update / remove failure は利用可能な detail を含む error toast を表示する。
- remove は confirmation を必要とし、project を参照する active task が実行できなくなる可能性を説明する。

アクセシビリティ:

- folder picker trigger は project-specific ではない明確な label を持つ。
- edit name control は project-specific `aria-label` を含む。
- remove project button は project-specific `aria-label` を含む。
- confirmation dialog は clear cancel action と destructive action を持つ。

セキュリティと安全性:

- project 追加は explicit かつ file browser selection based である。
- project 追加後は、その directory 配下を scheduler task が編集可能な user-owned scope とみなす。別途 `Trusted Project` badge や trust timestamp を表示しない。
- project removal は local file や run history を削除しない。
- active task impact は removal 前に計算・表示される。

受け入れ条件:

- Projects page に path text input が表示されず、directory selection は file browser UI から開始される。
- GitHub remote がある project は `user(org)/repo` 形式で表示される。
- GitHub remote がない project は display name を編集できる。
- project が追加された後、別途 trust / untrust action または `信頼済み` badge が表示されない。
- project removal が confirmed された場合、affected active task count が success toast に表示される。

既知の gap:

- GitHub 以外の remote hosting service は folder project として扱い、display name は user-editable にする。
