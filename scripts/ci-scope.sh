#!/usr/bin/env bash
set -uo pipefail

docs_only() (
  local sha_pattern='^[0-9a-f]{40}$'
  [[ $# == 2 && $1 =~ $sha_pattern && $2 =~ $sha_pattern ]] || return 1
  [[ $(git cat-file -t "$1" 2>/dev/null) == commit &&
    $(git cat-file -t "$2" 2>/dev/null) == commit ]] || return 1

  local changed
  changed=$(mktemp "${TMPDIR:-/tmp}/singdeck-ci-scope.XXXXXX") || return 1
  trap 'rm -f -- "$changed"' EXIT
  git diff --raw -z --no-ext-diff --no-renames --no-relative --ignore-submodules=none \
    "$1" "$2" -- > "$changed" 2>/dev/null || return 1
  [[ -s $changed ]] || return 1

  local ordinary_file='^:(100644|000000) (100644|000000) [0-9a-f]+ [0-9a-f]+ [AMD]$'
  local entry path
  while IFS= read -r -d '' entry || [[ -n $entry ]]; do
    [[ $entry =~ $ordinary_file ]] && IFS= read -r -d '' path || return 1
    case $path in
      README.md | README.zh-CN.md | docs/roadmap.md | docs/verification.md) ;;
      *) return 1 ;;
    esac
  done < "$changed"
)

if docs_only "$@"; then
  printf 'docs\n'
else
  printf 'full\n'
fi
