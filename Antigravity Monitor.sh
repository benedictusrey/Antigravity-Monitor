#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node /snap/bin/node "$HOME/.volta/bin/node" "$HOME/.local/share/fnm/aliases/default/bin/node"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  for nvm_node in "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$nvm_node" ]; then
      found="$nvm_node"
    fi
  done
  if [ -n "${found:-}" ]; then
    printf '%s\n' "$found"
    return 0
  fi
  return 1
}

if ! NODE_BIN=$(find_node); then
  echo "Antigravity Monitor requires Node.js 22 or newer (https://nodejs.org/)." >&2
  exit 1
fi

exec "$NODE_BIN" "$script_dir/tools/monitor-server.mjs" "$@"
