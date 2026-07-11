---
title: 画面仕様
description: Clockhand の desktop screen specification convention、stable screen ID registry、静的配布時の画面検証、per-screen spec link を定義する。
updated: 2026-07-11
read_when:
  - desktop app page、dialog、task wizard behavior、screen copy、validation、loading state、empty state、navigation を変更するとき。
  - Clockhand desktop screen に割り当てられた stable screen ID を探すとき。
  - Clockhand の QA check、user-facing screen documentation、acceptance criteria、design handoff note を書くとき。
  - Next.js static export または Tauri bundle が各画面を HTML document として配布できることを検証するとき。
---

# 画面仕様

このドキュメントは screen spec の共通 item set を定義し、stable な `S000` series ID を割り当てる。実際の各 screen specification は [screens/](screens/) 配下の個別 file に置く。

## 仕様項目セット

情報が該当する場合、各 screen spec は次の item を含めるべきである。

- ID and name: stable `S000` series ID、route、user-visible title。
- Purpose: screen が解決する user outcome と product risk。
- Primary users: expected user mindset と permission assumption。
- Entry points: navigation link、query parameter、dialog、または関連 screen。
- Exit points: successful、canceled、failure flow の遷移先。
- Data dependencies: frontend query、IPC command、DTO、setting、refresh cadence。
- Layout regions: header、primary content、detail pane、dialog、sticky bar、responsive behavior。
- Fields and controls: label、control type、default、selectable value、disabled condition、destructive action。
- States: loading、empty、populated、selected、filtered、active-running、success、warning、error、disabled state。
- Validation and errors: inline field validation、summary error、toast failure、confirmation text、retry path。
- Accessibility: keyboard order、focus management、ARIA label、visible focus、color-independent status、reduced-motion expectation。
- Security and safety: execution permission、project scope、task lock、destructive confirmation、local filesystem access、audit expectation。
- Acceptance criteria: 実装済み behavior の concise で testable な check。
- Known gaps: 意図的に未実装の behavior または schema-backed limitation。

この item set は外部の UI specification と requirements guidance に基づく。UI spec は logical flow、display contents、access points、fields、defaults、values、exception cases を document すべきであり、acceptance criteria は testable であるべきで、error state は visible かつ constructive であるべきで、form validation は可能な限り field の近くに置くべきであり、accessibility documentation は interaction state と inclusive behavior を含めるべきである。review した source: [Bridging the Gap UI specification template](https://www.bridging-the-gap.com/how-to-create-a-user-interface-specification/)、[Wikipedia UI specification structure summary](https://en.wikipedia.org/wiki/User_interface_specification)、[AltexSoft acceptance criteria guidance](https://www.altexsoft.com/blog/functional-and-non-functional-requirements-specification-and-types/)、[NN/g error message guidelines](https://www.nngroup.com/articles/error-message-guidelines/)、[NN/g form error guidelines](https://www.nngroup.com/articles/errors-forms-design-guidelines/)、[Stephanie Walter accessibility and interaction documentation guidance](https://stephaniewalter.design/blog/a-designers-guide-to-documenting-accessibility-user-interactions/)。

## 共通レイアウト規約

- sidebar の右側は page background が連続する 1 枚の content canvas とする。page-level section、list、table、form、tab content を、装飾目的の rounded border、別背景、shadow、内側 padding を組み合わせた panel で囲まない。
- content の階層は page header、section heading、spacing、separator、table header、row divider で示す。外枠を外しても section と row の境界、hover / selected state、keyboard focus は判別できる状態を保つ。
- tab list は選択中 content の直上に配置し、tab content 自体には外側の bordered panel を置かない。nested tabs も同じ規約を使う。
- input、selectable radio card、code / log block、chat bubble、status / alert、popover、dialog など、操作または内容の識別に surface が必要な局所要素はこの規約の対象外とする。

## 静的配布規約

- `/`、`/projects`、`/tasks`、`/tasks/new`、`/runs`、`/settings` は、Next.js static export でそれぞれ独立した HTML document を生成する。
- 各 HTML document は `<!DOCTYPE html>`、日本語の root document、Clockhand の title、route 固有の描画 marker を持つ。React Server Component の `.txt` payload、Next.js error document、`NEXT_REDIRECT` payload を画面 document として配布してはならない。
- `/` は server redirect を static export せず、通常の HTML fallback から client navigation で `/projects` を開く。Tauri の main window は `/projects/` を直接開く。
- desktop production build は、上記すべての route output が存在し、error marker を含まず、route 固有の marker を含むことを bundle 作成前に検証する。1画面でも違反した場合は build を失敗させる。
- route query によって表示を切り替える `/tasks` と `/runs` も、基底 route の HTML document 自体は root layout と client-side loading / navigation fallback を描画できる状態にする。

## Screen ID registry

| ID | Screen | Route or Surface | Spec |
| --- | --- | --- | --- |
| S000 | App Shell | global shell、`/` redirect | [S000 App Shell](screens/s000-app-shell.md) |
| S001 | Tasks | `/tasks`, `/tasks?task=<taskId>`, `/tasks?view=archived` | [S001 Tasks](screens/s001-tasks.md) |
| S002 | Task Wizard | `/tasks/new`, follow-up mode, edit dialog body | [S002 Task Wizard](screens/s002-task-wizard.md) |
| S003 | Task Sessions | `/runs?run=<runId>` | [S003 Task Sessions](screens/s003-runs.md) |
| S004 | Projects | `/projects` | [S004 Projects](screens/s004-projects.md) |
| S005 | Settings | `/settings` | [S005 Settings](screens/s005-settings.md) |
