# AGENTS.md

## 言語

* ドキュメント、GitHub の PR 本文、`README.md` は日本語を既定にする。
* コード内コメントは英語にする。

## ドキュメント

[PRODUCT.md](PRODUCT.md) のプロダクトポリシーを読む。
[docs/](docs/) からリポジトリドキュメントをたどる。

`agent-docs list docs` でリポジトリ管理ドキュメントを探し、必要なドキュメントを `agent-docs read <file>` で確認する。
本文が必要な場合にだけ `agent-docs read <file> --body` を使う。

実装を始める前に、仕様を書面で記録する。

## 作業成果物

UI と挙動の検証には `agent-browser` を使う。
`agent-browser` で作成した検証スクリーンショットは `/tmp`、またはリポジトリ内の ignore 済み `tmp/` ディレクトリに保存し、コミットに含めない。
