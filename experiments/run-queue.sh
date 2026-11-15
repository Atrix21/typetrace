#!/usr/bin/env bash
# The ONE work queue for this machine: strictly sequential, each step gated on free memory (>= 8 GB available).
# Agent steps resume after a usage-limit halt (exit 3). Touch experiments/03-graph-scale/STOP to stop between steps.
cd "$(dirname "$0")/.."
export AGENT_EVAL_BILLABLE=1
F=grep; FILT() { grep --line-buffered -v -e ExperimentalWarning -e trace-warnings; }
stop() { [ -f experiments/03-graph-scale/STOP ] && { echo "STOP file"; exit 0; }; }
waitmem() { while [ "$(awk '/MemAvailable/ {print int($2/1048576)}' /proc/meminfo)" -lt 8 ]; do echo "[$(date +%T)] waiting for >= 8 GB free"; sleep 120; done; }
clean() { for r in immich twenty; do [ -z "$(git -C targets/exp3/$r status --porcelain)" ] || { echo "snapshot $r dirty — stopping"; exit 1; }; done; }
step() { stop; waitmem; clean; echo "=== $(date -Is) $*"; }
agent() {
  local run=$1; shift
  while :; do
    step agent "$run" "$@"
    npx tsx scripts/exp3/agent.ts --run "$run" --account personal --run-usd 1 --max-usd 150 "$@" 2>&1 | FILT
    rc=${PIPESTATUS[0]}
    [ $rc -eq 0 ] && break
    if [ $rc -eq 3 ]; then echo "halted (limit?) — sleeping 20 min"; sleep 1200; else echo "agent exit $rc — stopping queue"; exit $rc; fi
  done
}
retr() { # repo split out methods [env...]
  step retrieval "$@"
  env ${5:-} npx tsx scripts/exp3/stage1.ts --repo $1 --split $2 --out $3 --methods $4 2>&1 | FILT
  [ ${PIPESTATUS[0]} -eq 0 ] || { echo "retrieval $1 $3 failed — stopping queue"; exit 1; }
}
agent h2h-M-haiku --repo M --split test --arms A0,A2,A5,A6 --repeats 3 --model claude-haiku-5-5
retr S all .cache/exp3/onnx-parity-S embeddings,hybrid,compact_graph TYPETRACE_EMBED_BACKEND=onnx
for r in "S all" "M test" "L test"; do set -- $r; retr $1 $2 experiments/03-graph-scale/results/h2h-$1 code_review_graph_qwen; done
step swebench
npx tsx scripts/swebench/run.ts --out experiments/05-swebench-python/results 2>&1 | FILT
[ ${PIPESTATUS[0]} -eq 0 ] || { echo "swebench failed — stopping queue"; exit 1; }
agent h2h-L-sonnet --repo L --split test --arms A0,A2,A5,A6 --repeats 2 --model claude-sonnet-5-5
echo "=== queue done $(date -Is)"
