#!/usr/bin/env bash
set -euo pipefail

ROOT="$HOME/.my-trading-agent-rdagent"
VENV="$ROOT/.venv"
mkdir -p "$ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y python3 python3-venv python3-pip git
fi

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi

source "$VENV/bin/activate"
python -m pip install --upgrade pip wheel setuptools
python -m pip install -U rdagent

echo "RD-Agent installed in $VENV"
rdagent collect_info || true
