#!/usr/bin/env bash
# Build paper/build/paper.pdf from paper/paper.md: figures to PNG (headless Chrome), Markdown to LaTeX, Tectonic.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 figures/make_figures.py >/dev/null
C=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
for f in figures/*.svg; do
  w=$(grep -o "viewBox='0 0 [0-9]* [0-9]*'" "$f" | awk '{print $3}'); h=$(grep -o "viewBox='0 0 [0-9]* [0-9]*'" "$f" | awk '{print $4}' | tr -d "'")
  "$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size="$w,$h" --screenshot="build/$(basename "${f%.svg}").png" "file://$PWD/$f" >/dev/null 2>&1
done
mkdir -p build/figures && mv build/fig*.png build/figures/
python3 build/md2tex.py paper.md > build/paper.tex
(cd build && "${TECTONIC:-tectonic}" -Z continue-on-errors paper.tex 2>&1 | grep -E "error|warning: .*(undefined|Overfull)" | head -20 || true)
ls -la build/paper.pdf
