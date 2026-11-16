#!/usr/bin/env bash
# Clone competitors at pinned commits and create isolated Python envs (see vendor/manifest.json).
set -euo pipefail
cd "$(dirname "$0")/.."
clone() { # dir url commit
  if [ ! -d "vendor/$1/.git" ]; then git clone -q "$2" "vendor/$1"; fi
  git -C "vendor/$1" checkout -q "$3"
  test "$(git -C "vendor/$1" rev-parse HEAD)" = "$3"
}
clone graphify https://github.com/Graphify-Labs/graphify 52cb28218eea0c68d80a9f4b2ae102d2fa63e267
clone code-review-graph https://github.com/tirth8205/code-review-graph b3f1285965a1337b3821e4423da03b65d70ee423
mkdir -p vendor/.venvs
[ -x vendor/.venvs/graphify/bin/python ] || uv venv -q --python 3.12 vendor/.venvs/graphify
GRAPHIFY_NO_AUTO_REFRESH=1 uv pip install -q --python vendor/.venvs/graphify/bin/python -e './vendor/graphify[mcp]'
[ -x vendor/.venvs/code-review-graph/bin/python ] || uv venv -q --python 3.12 vendor/.venvs/code-review-graph
uv pip install -q --python vendor/.venvs/code-review-graph/bin/python './vendor/code-review-graph[embeddings,communities]'
[ -x vendor/.venvs/embeddings/bin/python ] || uv venv -q --python 3.12 vendor/.venvs/embeddings
uv pip install -q --python vendor/.venvs/embeddings/bin/python sentence-transformers==5.1.2 transformers==4.57.1 torch==2.9.1 numpy
vendor/.venvs/embeddings/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-Embedding-0.6B', revision='97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3')"
bash scripts/setup-target-deps.sh
echo "competitors + target deps ready"
