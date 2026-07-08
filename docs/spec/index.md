---
title: Codex Scheduler Specification Index
description: Entry point for implementation-based Codex Scheduler specifications.
updated: 2026-07-08
read_when:
  - Looking for the current implementation-based specification set.
  - Deciding which Codex Scheduler spec document to read next.
---

# Codex Scheduler Specification Index

These documents describe the current branch implementation of Codex Scheduler. They are rewritten from code, tests, and product policy rather than copied from the legacy `spec/` directory.

## Documents

- [Product Scope](product-scope.md): product intent, user value, MVP boundary, and current gaps.
- [Architecture](architecture.md): process layout, crates, desktop shell, sidecars, persistence, and runtime paths.
- [Data Model](data-model.md): persisted entities, DTOs, enums, settings, and retention records.
- [Scheduling And Execution](scheduling-and-execution.md): schedule calculation, daemon ticks, run lifecycle, Codex runner behavior, logs, retry, and cleanup.
- [Interfaces](interfaces.md): desktop UI, Tauri commands, daemon JSON-RPC, and `codex-schedule` CLI surface.
- [Security And Operations](security-and-operations.md): local trust boundaries, project trust, capability tokens, sandbox policy, diagnostics, release artifacts, and verification.

## Reading Order

Start with [Product Scope](product-scope.md) when changing user-facing behavior. Use [Architecture](architecture.md) and [Data Model](data-model.md) before changing Rust or IPC contracts. Use [Scheduling And Execution](scheduling-and-execution.md) before changing scheduler, daemon, or runner behavior. Use [Interfaces](interfaces.md) before changing the desktop app, CLI, or RPC methods. Use [Security And Operations](security-and-operations.md) before changing permissions, path access, token handling, diagnostics, sidecar packaging, or cleanup.

