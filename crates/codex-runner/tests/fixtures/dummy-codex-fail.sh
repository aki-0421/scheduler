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
      --ask-for-approval <POLICY>
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
      --cd|--color|--model|--sandbox|--ask-for-approval)
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
  echo '{"type":"message","content":"failed"}'
  echo 'dummy failure' >&2
  if [[ -n "$last_message" ]]; then
    printf 'failed\n' > "$last_message"
  fi
  exit 42
fi

echo "unexpected arguments: $*" >&2
exit 64
