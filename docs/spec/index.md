---
title: Codex Scheduler 仕様インデックス
description: 実装ベースの Codex Scheduler 仕様への入口。
updated: 2026-07-08
read_when:
  - 現在の実装ベース仕様セットを探すとき。
  - 次に読むべき Codex Scheduler 仕様ドキュメントを判断するとき。
---

# Codex Scheduler 仕様インデックス

これらのドキュメントは、現在の branch における Codex Scheduler の実装を説明する。legacy の `spec/` directory からコピーしたものではなく、code、test、product policy から書き直している。

## ドキュメント

- [プロダクトスコープ](product-scope.md): product intent、user value、MVP 境界、現在の gap。
- [アーキテクチャ](architecture.md): process layout、crate、desktop shell、sidecar、persistence、runtime path。
- [データモデル](data-model.md): 永続化 entity、DTO、enum、settings、retention record。
- [スケジューリングと実行](scheduling-and-execution.md): schedule calculation、daemon tick、run lifecycle、Codex runner behavior、log、手動再実行、固定 cleanup。
- [インターフェース](interfaces.md): desktop UI、Tauri command、daemon JSON-RPC、`codex-schedule` CLI surface。
- [画面仕様](screens.md): desktop screen ID、screen-level requirement、state、control、validation、accessibility、acceptance criteria。
- [セキュリティと運用](security-and-operations.md): local trust boundary、project scope、task lock、capability token、固定 execution profile、diagnostics、release artifact、verification。

## 読む順序

user-facing behavior を変更するときは [プロダクトスコープ](product-scope.md) から始める。desktop screen、dialog、form behavior、loading state、screen copy を変更する前には [画面仕様](screens.md) を使う。Rust または IPC contract を変更する前には [アーキテクチャ](architecture.md) と [データモデル](data-model.md) を使う。scheduler、daemon、runner behavior を変更する前には [スケジューリングと実行](scheduling-and-execution.md) を使う。desktop app、CLI、RPC method を変更する前には [インターフェース](interfaces.md) を使う。permission、path access、token handling、diagnostics、sidecar packaging、cleanup を変更する前には [セキュリティと運用](security-and-operations.md) を使う。
