---
title: Screen Specifications
description: Defines desktop screen specification conventions, the stable screen ID registry, and links to per-screen specs for Codex Scheduler.
updated: 2026-07-08
read_when:
  - Changing desktop app pages, dialogs, task wizard behavior, screen copy, validation, loading or empty states, or navigation.
  - Looking for the stable screen ID assigned to a Codex Scheduler desktop screen.
  - Writing QA checks, user-facing screen documentation, acceptance criteria, or design handoff notes for Codex Scheduler.
---

# Screen Specifications

This document defines the common item set for screen specs and assigns stable `S000`-series IDs. Each actual screen specification lives in its own file under [screens/](screens/).

## Specification Item Set

Each screen spec should include these items when the information applies:

- ID and name: stable `S000`-series ID, route, and user-visible title.
- Purpose: user outcome and product risk the screen addresses.
- Primary users: expected user mindset and permission assumptions.
- Entry points: navigation links, query parameters, dialogs, or related screens that open it.
- Exit points: where successful, canceled, or failure flows lead.
- Data dependencies: frontend queries, IPC commands, DTOs, settings, and refresh cadence.
- Layout regions: header, primary content, detail panes, dialogs, sticky bars, and responsive behavior.
- Fields and controls: labels, control types, defaults, selectable values, disabled conditions, and destructive actions.
- States: loading, empty, populated, selected, filtered, active-running, success, warning, error, and disabled states.
- Validation and errors: inline field validation, summary errors, toast failures, confirmation text, and retry paths.
- Accessibility: keyboard order, focus management, ARIA labels, visible focus, color-independent status, and reduced-motion expectations.
- Security and safety: execution permissions, path trust, destructive confirmations, local filesystem access, and audit expectations.
- Acceptance criteria: concise, testable checks for the implemented behavior.
- Known gaps: intentionally missing behavior or schema-backed limitations.

This item set is based on external UI specification and requirements guidance: UI specs should document logical flow, display contents, access points, fields, defaults, values, and exception cases; acceptance criteria should be testable; error states should be visible and constructive; form validation should stay near fields where possible; accessibility documentation should cover interaction states and inclusive behavior. Sources reviewed: [Bridging the Gap UI specification template](https://www.bridging-the-gap.com/how-to-create-a-user-interface-specification/), [Wikipedia UI specification structure summary](https://en.wikipedia.org/wiki/User_interface_specification), [AltexSoft acceptance criteria guidance](https://www.altexsoft.com/blog/functional-and-non-functional-requirements-specification-and-types/), [NN/g error message guidelines](https://www.nngroup.com/articles/error-message-guidelines/), [NN/g form error guidelines](https://www.nngroup.com/articles/errors-forms-design-guidelines/), and [Stephanie Walter accessibility and interaction documentation guidance](https://stephaniewalter.design/blog/a-designers-guide-to-documenting-accessibility-user-interactions/).

## Screen ID Registry

| ID | Screen | Route or Surface | Spec |
| --- | --- | --- | --- |
| S000 | Today | `/` | [S000 Today](screens/s000-today.md) |
| S001 | Tasks | `/tasks` | [S001 Tasks](screens/s001-tasks.md) |
| S002 | Task Wizard | `/tasks/new`, follow-up mode, and edit dialog body | [S002 Task Wizard](screens/s002-task-wizard.md) |
| S003 | Runs | `/runs` | [S003 Runs](screens/s003-runs.md) |
| S004 | Projects | `/projects` | [S004 Projects](screens/s004-projects.md) |
| S005 | Settings | `/settings` | [S005 Settings](screens/s005-settings.md) |
