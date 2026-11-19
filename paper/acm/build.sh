#!/usr/bin/env bash
# Build the ACM sigconf version of the paper with Tectonic.
#   bash paper/acm/build.sh            -> paper/acm/out/paper-anonymous.pdf
#   BLIND_NAMES=1 bash paper/acm/build.sh -> paper/acm/out/paper-blind-read.pdf (pseudonymous author block from
#                                          authors.blind.tex, local only, never committed)
set -euo pipefail
cd "$(dirname "$0")"
T=${TECTONIC:-tectonic}
# acmart from TeX Live (the class in Tectonic's bundle fails on \@undescribed@images); cached locally, not committed
if [ ! -f .tex/acmart.cls ]; then
  mkdir -p .tex && tmp=$(mktemp -d)
  curl -sSfL -o "$tmp/a.tar.xz" https://mirrors.ctan.org/systems/texlive/tlnet/archive/acmart.tar.xz
  tar -xJf "$tmp/a.tar.xz" -C "$tmp" && cp "$tmp"/tex/latex/acmart/acmart.cls "$tmp"/bibtex/bst/acmart/ACM-Reference-Format.bst .tex/ && rm -rf "$tmp"
fi
# print figures (vector PDF), regenerated from the result values in ../figures/make_figures.py
PRINT=1 python3 ../figures/make_figures.py >/dev/null
C=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
mkdir -p figures out
for f in ../figures/print/*.svg; do
  b=$(basename "${f%.svg}"); vb=$(grep -o "viewBox='0 0 [0-9]* [0-9]*'" "$f"); w=$(echo "$vb" | awk '{print $3}'); h=$(echo "$vb" | awk '{print $4}' | tr -d "'")
  printf "<!doctype html><html><head><style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>%s</body></html>" "$(cat "$f")" > "figures/$b.html"
  "$C" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$PWD/figures/$b.pdf" "file://$PWD/figures/$b.html" >/dev/null 2>&1; rm "figures/$b.html"
done
name=paper-anonymous; src=authors.anonymous.tex
if [ "${BLIND_NAMES:-0}" = 1 ]; then name=paper-blind-read; src=authors.blind.tex; fi
cp "$src" authors.tex
cp .tex/acmart.cls .tex/ACM-Reference-Format.bst .
"$T" --keep-logs main.tex 2>&1 | grep -E "^error" || true
grep -E "^(Overfull|Underfull) .hbox \(([2-9][0-9]|[0-9]{3})" main.log | head -5 || true
grep -E "LaTeX Warning: (Reference|Citation).*undefined" main.log | head -5 || true
mv main.pdf "out/$name.pdf"; rm -f acmart.cls ACM-Reference-Format.bst authors.tex main.log main.blg
ls -la "out/$name.pdf"
