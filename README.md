<h1 align="center">code-graphs</h1>

<p align="center"><strong>Typed code graph + hybrid search for AI coding agents, over MCP. Measured, not claimed.</strong></p>

`code-graphs` indexes a TypeScript codebase with the TypeScript compiler (typed calls, DI, decorators, GraphQL resolvers,
keyed event/job dispatch, Kysely queries), combines it with BM25 and a local embedding model, and serves one MCP tool,
`find_relevant_code`, that returns at most 800 tokens of `file:line` pointers with each function's callers, callees and
handlers. No LLM is used to build or query the index.

Every number below comes from a pre-registered, version-pinned benchmark in this repository. Head-to-head against
[graphify](https://github.com/Graphify-Labs/graphify) 0.9.108 and
[code-review-graph](https://github.com/tirth8205/code-review-graph) 2.4.0, each run with its own native MCP server, its
latest release and, for code-review-graph, its strongest documented setup (local embeddings on).

## Results

### 1. Retrieval: does the tool find the code that matters? (no model calls)

Recall@10 of the ground-truth symbols (bug root cause and the functions on its path, or the functions a code question is
about), on real repositories of increasing size. Same tasks, snapshots, budget and scoring for every method.

| Repository | Lines | Tasks | **code-graphs** (hybrid) | **code-graphs** (agent tool, ≤800 tok) | code-review-graph + embeddings | code-review-graph (default) | graphify |
|---|---:|---:|---:|---:|---:|---:|---:|
| nestjs-boilerplate | 6.3k | 20 | **0.69** | **0.65** | 0.31 | 0.18 | 0.12 |
| Immich server | 63k | 26 | **0.48** | **0.39** | 0.26 | 0.03 | 0.04 |
| Twenty server | 763k | 18 | **0.33** | **0.28** | 0.10 | 0.01 | 0.01 |

Ours is ahead of every competitor configuration at every scale. Paired over tasks, 16 of the 18 ours-vs-competitor
comparisons have p ≤ 0.001; the two exceptions are on Immich against code-review-graph + embeddings (hybrid +0.21,
p = 0.025; agent tool +0.12, p = 0.12, not significant). On Twenty our hybrid has higher Recall@10 than
code-review-graph + embeddings on 12 of 18 tasks and lower on none. Full table with MRR, file recall, output size and latency:
[`experiments/03-graph-scale/results/h2h-report.md`](experiments/03-graph-scale/results/h2h-report.md).

### 2. Agents: does it make a coding agent better or cheaper?

Claude Code (headless, Claude Haiku 5.5, read-only tools Read/Grep/Glob) answers 18 held-out questions and bug reports on
the 763k-line Twenty server, 3 repeats per task and arm, arms interleaved. Answers are scored automatically against
frozen ground truth (no LLM judge).

| Arm | Task score | Tokens / run | Cost / run | Tool adoption |
|---|---:|---:|---:|---:|
| **+ code-graphs** | **0.896** | **453k** | **$0.019** | 100% |
| + graphify | 0.867 | 521k | $0.022 | 87% |
| + code-review-graph (with embeddings) | 0.851 | 779k | $0.041 | 81% |
| grep / read only | 0.837 | 513k | $0.023 | — |

Pre-registered confirmatory tests (Holm-corrected, task-level paired):

- **Tokens:** per task, code-graphs uses **23% fewer tokens than graphify** (geometric mean of per-task ratios; 13% by
  the arm means above; Holm p = 0.003, fewer on 13 of 18 tasks) and **half the tokens of code-review-graph** (per-task
  ratio 2.0×; 1.7× by arm means; Holm p < 0.001, fewer on 17 of 18 tasks). code-review-graph runs cost 2.1× ours.
- **Accuracy:** code-graphs scores highest, but the gaps to graphify (+0.03) and code-review-graph (+0.05) are not
  statistically significant with 18 tasks (Holm p = 0.26).
- Against the grep-only agent: +0.06 task score (p = 0.03) at 21% fewer tokens per task (12% by arm means).

Immich (Haiku) and Twenty (Sonnet 5.5) replications: _running; added when complete._

### 3. LOCOMO (conversational memory; retrieval stack only)

LOCOMO has no code, so this measures only the search stack (BM25 + Qwen3-Embedding-0.6B + a cross-encoder reranker; no
LLM), on an open protocol (categories 1–4, 1,536 questions, dialogue-turn units, per-question evidence recall@10)
identical to an [independent public replication](https://github.com/devkancheti4-design/model-d-graphify), whose BM25
number (0.540) ours reproduces exactly.

| Method | Recall@10 (all 1,536) | Recall@10 (seeded 300) |
|---|---:|---:|
| **code-graphs search (hybrid + rerank)** | **0.745** | **0.753** |
| dense (Qwen3-Embedding-0.6B) | 0.637 | 0.642 |
| hybrid RRF | 0.635 | 0.662 |
| BM25 | 0.540 | 0.566 |

graphify reports 0.497 on LOCOMO with a harness that is not public (its BM25 scores 0.362 there), so that number is
quoted, not reproduced: [`experiments/04-locomo/`](experiments/04-locomo/).

### What we did not find (reported because it is true)

- Inside our own tool, the graph's contribution to **agent accuracy** is not significant: the same tool without graph
  propagation scored within 0.02 (pre-registered H4, Holm p = 0.44). The graph's large effect is on **retrieval**
  (Recall@10 +0.16 on Twenty) and on cross-module questions; agents with grep recover much of the difference by reading more.
- The token saving against a grep-only agent replicates across repositories and models (18–28%); the accuracy gain
  against grep-only is significant in one of the agent runs, not all.
- Category-A tasks are historical bug fixes reverted on pinned snapshots, and the repositories are public, so models may
  have seen them; this affects all arms equally.

## Quick start

Requires Node ≥ 22.13, git, and [uv](https://docs.astral.sh/uv/) for the local embedding model (Qwen3-Embedding-0.6B;
runs on CPU, faster on a GPU).

```bash
git clone <this repository> code-graphs && cd code-graphs
npm ci
uv venv --python 3.12 vendor/.venvs/embeddings && \
  uv pip install --python vendor/.venvs/embeddings/bin/python sentence-transformers==5.1.2 transformers==4.57.1 torch==2.9.1 numpy

npx tsx src/product/cli.ts index   /path/to/your/repo            # typed graph + BM25 + embeddings (one-time)
npx tsx src/product/cli.ts query   /path/to/your/repo "where are refresh tokens validated"
npx tsx src/product/cli.ts install /path/to/your/repo            # adds the MCP server to <repo>/.mcp.json
```

Restart Claude Code in the repository; the tool is `mcp__code-graphs__find_relevant_code`. Indexes live in
`~/.cache/code-graphs/` (override with `CODE_GRAPHS_CACHE`); your repository is never written except `.mcp.json`.
Large monorepos: `--include packages/server/src`; third-party type declarations are stubbed automatically above 5,000 files
(`--max-package-decl-mb` to override).

Indexing cost (one-time, this machine): 6k lines 15 s in total; 763k lines about 80 s and 4 GB RAM for the typed graph, plus embedding time (one-time, cached by content hash).

## How the benchmark works

| | |
|---|---|
| Repositories | nestjs-boilerplate (S), Immich server @a203e288 (M), Twenty server @bde4ff13 (L): same language and framework family, 6k → 763k lines |
| Tasks | 64 tasks (S: all 20; M and L: the held-out test splits, 26 and 18): historical bug fixes reverted on the pinned snapshot (ground truth = functions the merged fix changed; FAIL_TO_PASS-verified where runnable) plus feature-understanding, change-impact (type-checker oracle), data-flow and architecture questions. Every task independently audited before any retrieval output existed |
| Agent harness | Claude Code headless, isolated workspace copy (no `.git`, no `node_modules`, no ground truth), read-only tools, 40-turn cap, identical prompts per arm, structured answers scored automatically |
| Competitors | latest releases, vendored at pinned commits, each run through its own native MCP server with every read-only tool it ships; graphs built on exactly the files our tool sees |
| Statistics | unit = task, repeats averaged; paired bootstrap CIs; one-sided sign-flip permutation tests; Holm correction over pre-registered families |
| Pre-registration | `experiments/03-graph-scale/protocol.md` Amendments C and D, committed before the runs they govern |
| Every decision and fix | `experiments/03-graph-scale/decision-log.md` |

Reproduce: see [`experiments/03-graph-scale/README.md`](experiments/03-graph-scale/README.md). Retrieval-only results need
no API access; agent runs need a Claude Code login and are cost-capped by an approval file and a spend ledger.

## Licence

_To be chosen by the owner before publishing._ Benchmark repositories (Immich, Twenty) are AGPL-3.0 and are not
redistributed; agent transcripts and raw retrieval outputs, which contain their code, are kept out of git.
