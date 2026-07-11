#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--version" ]]; then
  echo "codex 999.0.0-test"
  exit 0
fi

if [[ "${1:-}" == "exec" && "${2:-}" == "--help" ]]; then
  cat <<'HELP'
Usage: codex exec [OPTIONS] -
      --cd <DIR>
      --json
      --color <WHEN>
      --model <MODEL>
      --sandbox <MODE>
      --config <key=value>
      --output-last-message <PATH>
      --skip-git-repo-check
HELP
  exit 0
fi

if [[ "${1:-}" == "exec" ]]; then
  cat >/dev/null
  echo '{"type":"message","content":"early"}'
  sleep 10
  echo '{"type":"message","content":"late"}'
  exit 0
fi

echo "unexpected arguments: $*" >&2
exit 64
