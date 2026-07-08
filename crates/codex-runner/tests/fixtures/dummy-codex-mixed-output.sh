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
  shift
  last_message=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output-last-message)
        last_message="$2"
        shift 2
        ;;
      --cd|--color|--model|--sandbox|--config)
        shift 2
        ;;
      --json|--skip-git-repo-check|-)
        shift
        ;;
      *)
        shift
        ;;
    esac
  done

  cat >/dev/null
  echo 'this is not json'
  echo '{"type":"session","id":"sess_mixed_output"}'
  echo '{"type":"message","content":"done"}'
  if [[ -n "$last_message" ]]; then
    printf 'done\n' > "$last_message"
  fi
  exit 0
fi

echo "unexpected arguments: $*" >&2
exit 64
