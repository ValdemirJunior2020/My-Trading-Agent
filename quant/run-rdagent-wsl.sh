#!/usr/bin/env bash
set -euo pipefail

ROOT="$HOME/.my-trading-agent-rdagent"
VENV="$ROOT/.venv"

if [ ! -x "$VENV/bin/rdagent" ]; then
  echo "RD-Agent is not installed in WSL. Run INSTALL-QUANT-ENGINES.bat first." >&2
  exit 1
fi

source "$VENV/bin/activate"
COMMAND="${1:-health}"

case "$COMMAND" in
  health)
    rdagent health_check --no-check-docker --no-check-ports
    ;;
  info)
    rdagent collect_info
    ;;
  fin_quant)
    STEP_N="${2:-1}"
    LOOP_N="${3:-1}"
    rdagent fin_quant --step-n "$STEP_N" --loop-n "$LOOP_N" --no-checkout
    ;;
  fin_factor)
    STEP_N="${2:-1}"
    LOOP_N="${3:-1}"
    rdagent fin_factor --step-n "$STEP_N" --loop-n "$LOOP_N" --no-checkout
    ;;
  *)
    echo "Unknown RD-Agent command: $COMMAND" >&2
    exit 2
    ;;
esac
