---
title: 画面仕様
description: Codex Scheduler の desktop screen specification convention、stable screen ID registry、per-screen spec link を定義する。
updated: 2026-07-08
read_when:
  - desktop app page、dialog、task wizard behavior、screen copy、validation、loading state、empty state、navigation を変更するとき。
  - Codex Scheduler desktop screen に割り当てられた stable screen ID を探すとき。
  - Codex Scheduler の QA check、user-facing screen documentation、acceptance criteria、design handoff note を書くとき。
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
- Security and safety: execution permission、path trust、destructive confirmation、local filesystem access、audit expectation。
- Acceptance criteria: 実装済み behavior の concise で testable な check。
- Known gaps: 意図的に未実装の behavior または schema-backed limitation。

この item set は外部の UI specification と requirements guidance に基づく。UI spec は logical flow、display contents、access points、fields、defaults、values、exception cases を document すべきであり、acceptance criteria は testable であるべきで、error state は visible かつ constructive であるべきで、form validation は可能な限り field の近くに置くべきであり、accessibility documentation は interaction state と inclusive behavior を含めるべきである。review した source: [Bridging the Gap UI specification template](https://www.bridging-the-gap.com/how-to-create-a-user-interface-specification/)、[Wikipedia UI specification structure summary](https://en.wikipedia.org/wiki/User_interface_specification)、[AltexSoft acceptance criteria guidance](https://www.altexsoft.com/blog/functional-and-non-functional-requirements-specification-and-types/)、[NN/g error message guidelines](https://www.nngroup.com/articles/error-message-guidelines/)、[NN/g form error guidelines](https://www.nngroup.com/articles/errors-forms-design-guidelines/)、[Stephanie Walter accessibility and interaction documentation guidance](https://stephaniewalter.design/blog/a-designers-guide-to-documenting-accessibility-user-interactions/)。

## Screen ID registry

| ID | Screen | Route or Surface | Spec |
| --- | --- | --- | --- |
| S000 | Today | `/` | [S000 Today](screens/s000-today.md) |
| S001 | Tasks | `/tasks` | [S001 Tasks](screens/s001-tasks.md) |
| S002 | Task Wizard | `/tasks/new`, follow-up mode, edit dialog body | [S002 Task Wizard](screens/s002-task-wizard.md) |
| S003 | Runs | `/runs` | [S003 Runs](screens/s003-runs.md) |
| S004 | Projects | `/projects` | [S004 Projects](screens/s004-projects.md) |
| S005 | Settings | `/settings` | [S005 Settings](screens/s005-settings.md) |
