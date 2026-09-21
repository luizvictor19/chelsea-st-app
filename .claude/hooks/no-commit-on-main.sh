#!/usr/bin/env bash
#
# PreToolUse hook for Bash: deny a git commit while the branch is main.
#
# The deny list in settings.json can only block or allow a command whole; it
# cannot say "only on main". On 2026-09-19 a delivery was committed straight
# on main and its commits never left it. This hook is the "only on main".
#
# Reads the hook input from stdin. Denies by printing a PreToolUse decision;
# in every other case exits 0 with no output, which lets the call through.

set -euo pipefail

input="$(cat)"
command="$(jq -r '.tool_input.command // empty' <<<"$input")"
cwd="$(jq -r '.cwd // empty' <<<"$input")"

# git, optionally with global options (-C path, -c key=value, --no-pager, ...),
# then the commit subcommand. Anchored at the start or after a separator, so a
# chained "git add . && git commit" is caught as well.
commit='(^|[;&|(`{]|\$\()[[:space:]]*git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|-[^[:space:]]+))*[[:space:]]+commit([[:space:]]|$)'

grep -Eq "$commit" <<<"$command" || exit 0

branch="$(git -C "${cwd:-.}" branch --show-current 2>/dev/null || true)"
[[ "$branch" == "main" ]] || exit 0

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Never commit on main. Create a branch first (git checkout -b feat/<scope>, fix/<scope>, chore/<scope> or docs/<scope>), then commit there."
  }
}'
