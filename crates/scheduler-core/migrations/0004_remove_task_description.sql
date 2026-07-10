ALTER TABLE tasks DROP COLUMN description;

UPDATE task_audit_events
SET before_json = json_remove(before_json, '$.description')
WHERE before_json IS NOT NULL
  AND json_valid(before_json)
  AND json_type(before_json, '$.description') IS NOT NULL;

UPDATE task_audit_events
SET after_json = json_remove(after_json, '$.description')
WHERE after_json IS NOT NULL
  AND json_valid(after_json)
  AND json_type(after_json, '$.description') IS NOT NULL;

PRAGMA user_version = 4;
