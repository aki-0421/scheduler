---
name: post-implementation-knowledge-capture
description: Use this skill after implementing, modifying, refactoring, moving, or deleting code when the change creates or changes knowledge that future contributors need to understand, verify, debug, extend, or safely modify the system.
---

# Post Implementation Knowledge Capture

Use this skill after code implementation.

The goal is to leave only the durable knowledge a new repository member needs to understand the changed area on day one and make a safe first PR without relying on chat history, tribal knowledge, or reverse-engineering.

## When To Document

Update documentation after implementation when the change affects durable contributor knowledge, such as:

* how to run, test, debug, or verify the changed area
* how a feature, workflow, API, job, route, schema, or integration now behaves
* where related code lives and which files are safe or unsafe to change together
* non-obvious constraints, invariants, tradeoffs, or failure modes
* setup requirements, local services, fixtures, mocks, seed data, or generated artifacts
* security, auth, permissions, privacy, secrets handling, or data access behavior
* operational behavior, deployment assumptions, rollback, observability, or incident response
* contributor workflow for adding another similar feature, test, migration, integration, or UI state

Do not document trivial changes that are obvious from names, types, tests, and nearby code.

## Documentation Decision

After implementation, choose the smallest useful documentation action:

| Situation                                 | Action                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Existing docs remain accurate             | Do not change docs.                                                           |
| Existing docs are stale                   | Correct the stale section.                                                    |
| Existing docs are incomplete              | Add the missing contributor-facing detail.                                    |
| The change introduces a durable new topic | Create a focused document for that topic.                                     |
| The change replaces old behavior          | Remove or rewrite the old documentation; do not append contradictory notes.   |
| The change is temporary work context      | Record it as a plan or execution note, not permanent reference documentation. |
| The change encodes a long-lived decision  | Record the decision in the repository’s decision-document format.             |

Prefer one accurate source of truth over multiple overlapping explanations.

## Good Post-Implementation Documentation

Good post-implementation documentation helps the next contributor answer:

1. What exists now?
2. Why does it exist this way?
3. When should I care about it?
4. Which code paths are involved?
5. How do I run or verify it?
6. How do I debug common failures?
7. What must I not break?
8. What is intentionally out of scope?

Write for someone making their first safe PR in this area.

## Choose The Right Shape

Use the reader’s task to choose the document shape:

| Reader need                                                         | Document shape                     |
| ------------------------------------------------------------------- | ---------------------------------- |
| Learn an unfamiliar area from zero                                  | Tutorial or onboarding walkthrough |
| Complete a concrete task                                            | How-to guide                       |
| Look up exact commands, fields, options, APIs, schemas, or behavior | Reference                          |
| Understand rationale, tradeoffs, constraints, or mental model       | Explanation                        |
| Preserve a durable decision                                         | Decision record                    |
| Track active implementation work                                    | Plan or execution log              |

Do not mix all shapes into one large document. Split the content when the reader’s task changes.

## Minimum Useful Content

When documentation is needed, include only the useful durable parts:

* current behavior after the implementation
* affected paths, packages, routes, commands, services, or systems
* how to run the relevant local workflow
* how to verify the change
* how to add or modify similar behavior safely
* known constraints, invariants, edge cases, and failure modes
* debugging hints for failures a new contributor is likely to hit

Avoid long narratives, chat history, implementation diary entries, or duplicated code explanations.

## Verification Knowledge

When changing tests or validation, document both:

* the command or workflow to run
* what that verification proves

Example:

```md
Run `pnpm test --filter web` after changing checkout behavior. This verifies route-level behavior, form validation, and mocked payment-provider responses for the web app.
```

If contributors must add similar tests in the future, document the pattern, fixture location, mock boundary, and expected assertion style.

## Writing Rules

* Write for the next contributor, not for the original implementer.
* Prefer concrete paths, commands, examples, and invariants.
* Explain behavior at the level needed to make a safe change.
* Keep setup and verification steps executable.
* Delete stale information instead of adding corrections below it.
* Do not document secrets, credentials, machine-local state, or private chat context.
* Do not repeat information that is already clearer in code, types, tests, or generated output.
* Do not create broad “miscellaneous notes” documents.

## Completion Checklist

Before considering implementation complete, check:

* Would a new member know where to start changing this area?
* Would they know how to run and verify the relevant behavior?
* Would they understand the main constraints and failure modes?
* Did this change make any existing documentation stale?
* Is there one clear source of truth for the new behavior?
* Is any undocumented knowledge still only available from chat or memory?
