---
title: ブランド
description: Clockhand の名称、App Icon、表示上のブランド境界、互換性のため維持する内部名を定義する。
updated: 2026-07-11
read_when:
  - product name、window title、notification、App Icon、brand copy を変更するとき。
  - Codex 以外の runner を追加し、provider-neutral な表現を検討するとき。
  - bundle identifier、Application Support path、sidecar、CLI の rename を検討するとき。
---

# ブランド

## 名称

ユーザー向け product name は `Clockhand` とする。capitalization は `Clockhand` に統一し、`ClockHand`、`Clock Hand` は使わない。

category descriptor は `Local Agent Scheduler`、英語 tagline は `Local agents, right on time.` とする。product name 自体には Codex、OpenAI、特定 model、特定 provider の名称を含めない。

現在の実装が起動できる runner は Codex CLI のみである。Clockhand という名称は将来の runner 追加に備えるための product brand であり、現時点で複数 provider 対応を主張するものではない。

## ブランドパーソナリティ

Clockhand は落ち着いていて、技術的で、正確に感じられる必要がある。ローカルAI作業を時間どおりに起動し、状態と結果を見守れることを中心価値として扱う。

copy と visual は次を避ける。

- robot head、brain、sparkle などの汎用 AI 表現。
- OpenAI knot、Codex glyph、provider color など、特定 provider に見える表現。
- calendar page、gear + clock の組み合わせなど、既視感の強い scheduler 表現。
- marketing page 風の gradient、neon、重い shadow、過度な装飾。

## App Icon

App Icon は graphite の macOS squircle に、off-white の open clock dial と terminal chevron を一体化した glyph を置く。ring 上の signal-blue dot は次に実行される task を表す。

palette は次を基準にする。

| Role | Color |
| --- | --- |
| Graphite | `#18181B` |
| Off white | `#FAFAFA` |
| Signal blue | `#3B9CFF` |

glyph は 16 px でも clock、right-facing execution、active run marker を判別できる太さと negative space を保つ。wordmark や provider logo を App Icon 内に入れない。menu bar など monochrome surface へ展開する場合は、dial と chevron の silhouette だけで成立させる。

desktop bundle が参照する icon asset は `apps/desktop/src-tauri/icons/` に置く。`icon-master.png` を生成元とし、Tauri config が参照する PNG、macOS `icon.icns`、Windows `icon.ico` を同じ master から生成する。

## 表示名と内部互換名の境界

window title、desktop metadata、notification title、diagnostics heading、user-facing error、README、product documentation では `Clockhand` を使う。

次は今回 rename しない。

- bundle identifier `com.local.codex-scheduler`。
- OS 標準 data root 配下の application directory 名 `Codex Scheduler`。macOS の既存 path は `~/Library/Application Support/Codex Scheduler`。
- sidecar binary `codex-schedulerd`。
- session CLI `codex-schedule`。
- Codex runner crate name と runner-specific type / setting name。
- workspace package name、`CODEX_SCHEDULER_*` environment variable。

これらは update continuity、既存 data の発見、current runner contract に関わる内部互換名である。変更する場合は data migration、process discovery、release/update behavior を含む別仕様として扱う。UI に実 path を表示する箇所では legacy directory name を実値のまま表示してよいが、説明文の product name は Clockhand とする。

## 検証

brand change では次を確認する。

- `rg "Codex Scheduler"` の残存箇所が、この文書で維持すると定義した内部互換名か current Codex runner 文脈である。
- 32 px と 16 px 相当で glyph、blue marker、squircle の境界が潰れない。
- light / dark desktop surface 上で icon silhouette が判別できる。
- desktop frontend build、Rust test、repository document lint が成功する。
- local app shell の title と Settings の説明文が Clockhand を使い、実 path は既存 data directory と一致する。
