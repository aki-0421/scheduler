UPDATE task_audit_events
SET before_json = json_remove(before_json, '$.codex.codexPath')
WHERE before_json IS NOT NULL
  AND json_valid(before_json);

UPDATE task_audit_events
SET after_json = json_remove(after_json, '$.codex.codexPath')
WHERE after_json IS NOT NULL
  AND json_valid(after_json);

ALTER TABLE tasks DROP COLUMN codex_path;

PRAGMA user_version = 6;
