#!/usr/bin/env bash
# Render the README illustrations: docs/diagrams/src/<name>.js -> docs/diagrams/<name>.png (2x, headless Chrome).
#   bash docs/diagrams/render.sh [name ...]     (needs: npm ci for roughjs, google-chrome, network for the fonts)
set -euo pipefail
cd "$(dirname "$0")/src"
declare -A SIZE=([how-it-works]="1700 410" [without-with]="1500 870" [hidden-links]="1500 700" [results]="1560 800" [agent-tokens]="1560 730")
names=("$@"); [ ${#names[@]} -gt 0 ] || names=("${!SIZE[@]}")
for n in "${names[@]}"; do
  read -r W H <<<"${SIZE[$n]}"
  sed -e "s/__W__/$W/" -e "s/__H__/$H/" -e "s/__SCRIPT__/$n.js/" page.html > ".render-$n.html"
  google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size="$W,$H" --virtual-time-budget=10000 --screenshot="../$n.png" "file://$PWD/.render-$n.html" >/dev/null 2>&1
  rm -f ".render-$n.html"
  echo "rendered docs/diagrams/$n.png"
done
