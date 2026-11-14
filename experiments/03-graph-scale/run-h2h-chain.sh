#!/usr/bin/env bash
# Amendment D head-to-head queue: strictly sequential. Agent steps resume after a usage-limit halt (exit 3) every 20 min.
# Touch experiments/03-graph-scale/STOP to stop between steps.
cd "$(dirname "$0")/../.."
export AGENT_EVAL_BILLABLE=1
while ps -eo args | grep -q "[s]tage1.ts --repo"; do sleep 30; done
agent() {
  local run=$1; shift
  while :; do
    [ -f experiments/03-graph-scale/STOP ] && { echo "STOP file"; exit 0; }
    echo "=== $(date -Is) $run $*"
    npx tsx scripts/exp3/agent.ts --run "$run" --account personal --run-usd 1 --max-usd 150 "$@" 2>&1 | grep --line-buffered -v -e ExperimentalWarning -e trace-warnings
    rc=${PIPESTATUS[0]}
    [ $rc -eq 0 ] && break
    if [ $rc -eq 3 ]; then echo "halted (limit?) — sleeping 20 min"; sleep 1200; else echo "exit $rc — stopping chain"; exit $rc; fi
  done
}
retrieval() {
  [ -f experiments/03-graph-scale/STOP ] && { echo "STOP file"; exit 0; }
  echo "=== $(date -Is) retrieval h2h-$1 $2"
  npx tsx scripts/exp3/stage1.ts --repo $1 --split $2 --out experiments/03-graph-scale/results/h2h-$1 --methods graphify,code_review_graph,code_review_graph_emb 2>&1 | grep --line-buffered -v -e ExperimentalWarning -e trace-warnings
  [ ${PIPESTATUS[0]} -eq 0 ] || { echo "retrieval $1 failed — stopping chain"; exit 1; }
}
agent h2h-L-haiku --repo L --split test --arms A0,A2,A5,A6 --repeats 3 --model claude-haiku-5-5
retrieval S all
retrieval M test
retrieval L test
agent h2h-M-haiku --repo M --split test --arms A0,A2,A5,A6 --repeats 3 --model claude-haiku-5-5
agent h2h-L-sonnet --repo L --split test --arms A0,A2,A5,A6 --repeats 2 --model claude-sonnet-5-5
echo "=== h2h chain done $(date -Is)"
