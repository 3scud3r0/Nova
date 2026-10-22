#!/usr/bin/env bash
# ETHERSIM — run it locally, no git or build tools needed.
#
#   curl -fsSL https://ethersim.ai/run.sh | bash
#
# This downloads the source, installs the bun runtime if you don't have it, and starts ETHERSIM at
# http://localhost:5173. It only touches a folder named "ethersim" in your current directory and
# (if needed) installs bun to ~/.bun. Read it first if you like — it's short. macOS / Linux (on
# Windows use WSL or Git Bash).
set -euo pipefail

REPO="macncrash/realethersim"
DIR="${ETHERSIM_DIR:-ethersim}"
PORT=5173 # vite's default dev port

say() { printf '\033[36m▸ %s\033[0m\n' "$1"; }

say "ETHERSIM local runner"

# 1. bun — fast all-in-one JS runtime. Install it (official one-liner) only if missing.
if ! command -v bun >/dev/null 2>&1; then
  say "Installing the bun runtime (https://bun.sh) …"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# 2. Source — download + extract the tarball (no git required). Skipped if the folder exists.
if [ ! -d "$DIR" ]; then
  say "Downloading ETHERSIM source …"
  tmp="$(mktemp -t ethersim.XXXXXX.tgz)"
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" -o "$tmp"
  mkdir -p "$DIR"
  tar -xzf "$tmp" -C "$DIR" --strip-components=1
  rm -f "$tmp"
else
  say "Using existing ./$DIR (delete it for a fresh copy)"
fi
cd "$DIR"

# 3. Install deps + run.
say "Installing dependencies …"
bun install

say "Starting ETHERSIM → http://localhost:$PORT   (Ctrl+C to stop)"
# Open the browser shortly after the dev server comes up (best-effort, cross-platform).
(
  sleep 2
  url="http://localhost:$PORT"
  if command -v open >/dev/null 2>&1; then open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"
  fi
) >/dev/null 2>&1 &

exec bun run dev
