#!/usr/bin/env bash
set -euo pipefail

classifier=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/ci-scope.sh
fixture=$(mktemp -d "${TMPDIR:-/tmp}/singdeck-ci-scope-test.XXXXXX")
trap 'rm -rf -- "$fixture"' EXIT
cd "$fixture"
git init --quiet --object-format=sha1
git config user.name 'SingDeck CI fixture'
git config user.email 'ci-fixture@example.invalid'
git config commit.gpgsign false
git config core.hooksPath /dev/null
mkdir -p docs src .github/workflows
printf 'fixture\n' | tee README.md docs/roadmap.md src/app.ts AGENTS.md .github/workflows/ci.yml >/dev/null
git add --all
git commit --quiet -m 'fixture: baseline'
base=$(git rev-parse HEAD)

assert_scope() {
  local expected=$1 label=$2 actual
  shift 2
  actual=$(bash "$classifier" "$@")
  if [[ $actual != "$expected" ]]; then
    printf 'FAIL %s: expected %s, got %s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

check_change() {
  local expected=$1 label=$2
  git add --all
  git commit --quiet -m "fixture: $label"
  assert_scope "$expected" "$label" "$base" "$(git rev-parse HEAD)"
  git reset --hard --quiet "$base"
}

printf 'changed\n' >> README.md
printf 'new\n' > docs/verification.md
check_change docs 'ordinary docs only'

for path in src/app.ts .github/workflows/ci.yml AGENTS.md docs/api-compatibility.md docs/unknown.md; do
  printf 'changed\n' >> "$path"
  check_change full "full coverage for $path"
done

printf 'changed\n' >> README.md
printf 'changed\n' >> src/app.ts
check_change full 'mixed docs and application'

git mv README.md src/readme.md
check_change full 'rename out of allowlist'
git mv src/app.ts README.zh-CN.md
check_change full 'rename into allowlist'
git rm --quiet docs/roadmap.md
check_change docs 'ordinary docs deletion'
git rm --quiet src/app.ts
check_change full 'application deletion'

rm README.md
ln -s AGENTS.md README.md
check_change full 'docs symlink'
printf 'unknown\n' > $'docs/verification.md\nREADME.md'
check_change full 'newline in unknown filename'

assert_scope full 'missing base commit' "$(printf '%040d' 0)" "$base"
assert_scope full 'missing tested commit' "$base" "$(printf '%040d' 0)"
assert_scope full 'malformed SHA' HEAD "$base"
assert_scope full 'missing arguments'
assert_scope full 'empty diff' "$base" "$base"
printf 'CI scope self-check passed\n'
