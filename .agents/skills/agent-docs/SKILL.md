---
name: agent-docs
description: Use the installed agent-docs CLI when reading, writing, updating, auditing, or planning AI-agent-oriented repository documentation, especially managed Markdown.
---

# agent-docs

Use this skill when working on repository documentation that is meant for AI agents, especially managed Markdown documents with `agent-docs` front matter.

Trigger broadly for tasks that involve:

- Reading or discovering agent-facing docs.
- Writing or updating instructions, specs, plans, README guidance, or managed Markdown.
- Auditing documentation coverage, freshness, size, or metadata.
- Planning documentation changes that should remain easy for agents to find and read.

Rely on the installed `agent-docs` CLI for repository-specific guidance instead of duplicating reference material in this skill:

```bash
agent-docs help
agent-docs help workflow
agent-docs help frontmatter
agent-docs help diagnostics
agent-docs help config
agent-docs help skills
```

Default workflow:

1. Run `agent-docs list [directory]` to find managed documents.
2. Run `agent-docs read <file>` to inspect document metadata before reading the full body.
3. Run `agent-docs read <file> --body` only when the metadata shows the document is relevant.
4. When editing or creating managed Markdown, keep leading YAML front matter valid for the CLI. Required fields are `title` as a non-empty string, `description` as a non-empty string, `updated` as a `YYYY-MM-DD` date, and `read_when` as a non-empty YAML string array. Update these fields when the body changes their meaning, and preserve unknown fields unless the user explicitly asks to edit them.
5. Run `agent-docs lint` before finishing documentation changes.

Use `--no-user-config` in CI and other deterministic automation unless user-level configuration is explicitly intended. Keep normal command output as Markdown so other agents can consume it directly.

Before editing managed Markdown, check `agent-docs help frontmatter`. When lint output reports issues, check `agent-docs help diagnostics`. For command order and discovery behavior, check `agent-docs help workflow`.

Install this skill with:

```bash
npx skills add aki-0421/agent-docs --skill agent-docs
```
