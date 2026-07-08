# データベースマイグレーション

正規の SQLite migration は `crates/scheduler-core/migrations` にあり、`scheduler-core` が `sqlx::migrate!` で埋め込む。

desktop の Tauri backend、daemon、CLI は scheduler-core の migration runner を呼び出す必要がある。これにより、すべての binary が同じ forward-only schema を適用する。
