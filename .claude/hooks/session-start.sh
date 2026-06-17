#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# The repo's local toolchain is bootstrapped via mise (.devcontainer + mise.toml),
# but the web remote environment does not build the devcontainer or run its
# postCreateCommand, so node_modules is never populated. This hook restores that
# step using the environment's own Node, guaranteeing the openspec CLI, the
# Worker, and the build tooling are runnable before the session begins.
set -euo pipefail

# Only needed in the remote (web) environment; local devcontainers handle setup
# via mise's postCreateCommand.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Idempotent: npm install is a no-op when node_modules is already in sync, and is
# preferred over `npm ci` so the cached container state speeds up later sessions.
npm install --no-audit --no-fund
