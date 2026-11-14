#!/usr/bin/env bash
# After the Amendment D queue: same-embedder control (D2b). Strictly sequential; waits for the h2h chain to finish.
cd "$(dirname "$0")/../.."
while ps -eo args | grep -q "[r]un-h2h-chain"; do sleep 60; done
for spec in "S all" "M test" "L test"; do set -- $spec
  [ -f experiments/03-graph-scale/STOP ] && { echo "STOP file"; exit 0; }
  echo "=== $(date -Is) D2b $1 $2"
  npx tsx scripts/exp3/stage1.ts --repo $1 --split $2 --out experiments/03-graph-scale/results/h2h-$1 --methods code_review_graph_qwen 2>&1 | grep --line-buffered -v -e ExperimentalWarning -e trace-warnings
  [ ${PIPESTATUS[0]} -eq 0 ] || { echo "D2b $1 failed"; exit 1; }
done
echo "=== followups done $(date -Is)"
