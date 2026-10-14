#!/usr/bin/env bash
set -euo pipefail

# Exit 0 for identical website inputs, 1 for changes, and fail on invalid revisions.
# Root prose is not consumed by the website build; all other tracked inputs count.
git diff --quiet "$1" "$2" -- . \
  ':(top,exclude)README.md' \
  ':(top,exclude)AGENTS.md' \
  ':(top,exclude)CONTRIBUTING.md' \
  ':(top,exclude)SECURITY.md' \
  ':(top,exclude)LICENSE' \
  ':(top,exclude)improvement.md' \
  ':(top,exclude)improvements.md'
