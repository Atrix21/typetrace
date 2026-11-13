#!/usr/bin/env bash
# Experiment 3 agent stage: sequential chain; each step resumes after a usage-limit halt (exit 3) by retrying every 20 min.
# Touch experiments/03-graph-scale/STOP to stop between attempts.
cd "$(dirname "$0")/../.."
export AGENT_EVAL_BILLABLE=1
step() {
  local run=$1; shift
  while :; do
    [ -f experiments/03-graph-scale/STOP ] && { echo "STOP file"; exit 0; }
    echo "=== $(date -Is) $run $*"
    npx tsx scripts/exp3/agent.ts --run "$run" --account personal --run-usd 1 --max-usd 150 "$@"
    rc=$?
    [ $rc -eq 0 ] && break
    if [ $rc -eq 3 ]; then echo "halted (limit?) — sleeping 20 min"; sleep 1200; else echo "exit $rc — stopping chain"; exit $rc; fi
  done
}
step main-L-haiku --repo L --split test --arms A0,A1,A2 --repeats 3 --model claude-haiku-5-5
step main-M-haiku --repo M --split test --arms A0,A1,A2 --repeats 2 --model claude-haiku-5-5
step main-L-sonnet --repo L --split test --arms A0,A2 --repeats 2 --model claude-sonnet-5-5
echo "=== chain done $(date -Is)"
