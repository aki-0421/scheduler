---
title: S004 Projects
description: Projects screen の trust path entry、trusted project list、untrust confirmation、active task impact requirement を定義する。
updated: 2026-07-08
read_when:
  - Projects page、project trust、project untrust、trusted path display、active task impact messaging を変更するとき。
---

# S004 Projects

ルート: `/projects`

目的: repository-backed scheduled run を実行できるようにする前に、local folder または Git repository を明示的に trust / untrust できるようにする。

入口: `Projects` navigation item と task wizard trust guidance。

出口: trusted path list、inline empty-state focus action、untrust confirmation。

データ依存:

- trusted path record には `useProjects()` を使う。
- trust change で影響を受ける active task count には `useTasks()` を使う。
- mutation には `useTrustProject()` と `useUntrustProject()` を使う。

レイアウト領域:

- page purpose を持つ header。
- trust project path form。
- trusted paths table または empty state。
- remove-trust confirmation dialog。

フィールドとコントロール:

- placeholder `/Users/alice/src/my-app` を持つ project path input。
- `Trust path` submit button。
- table columns: project、path、trust、active tasks、default branch、actions。
- `Remove trust` action は project がすでに untrusted の場合、または mutation pending の場合 disabled になる。

状態:

- empty input submit は `Enter a project path.` toast を表示し、path input に focus する。
- empty project list は `No trusted projects` を表示し、action 使用時に path input に focus する。
- trusted / untrusted badge は trust status と timestamp、または `Not trusted` を表示する。
- remove-trust success toast は affected active task count を含む。

バリデーションとエラー:

- path は trust mutation 前に trim 後 non-empty でなければならない。
- trust / untrust failure は利用可能な detail を含む error toast を表示する。
- untrust は confirmation を必要とし、trust が restored されるか task が移動されるまで active task が fail し得ることを説明する。

アクセシビリティ:

- path input は `aria-label="Project path"` を持つ。
- remove-trust button は project-specific `aria-label` を含む。
- confirmation dialog は clear cancel action と destructive action を持つ。

セキュリティと安全性:

- trust は explicit かつ local-path based である。
- trust 削除は local file や run history を削除しない。
- active task impact は untrust 前に計算・表示される。

受け入れ条件:

- blank path の場合、trust mutation は送信されず、focus は input に戻る。
- trust が成功した場合、input は clear され、project list は refresh する。
- untrust が confirmed された場合、affected active task count が success toast に表示される。
- project に active task がある場合、confirmation は failure risk を説明する。

既知の gap:

- Projects page は typed path を受け付ける。folder picking は task wizard でのみ exposed される。
