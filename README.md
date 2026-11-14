<h1 align="center">TypeTrace</h1>

<p align="center"><strong>A typed code graph plus hybrid search for AI coding agents, served over MCP. Every claim here is measured, pre-registered and reproducible.</strong></p>

TypeTrace indexes a **TypeScript** codebase with the TypeScript compiler. The index covers:
- typed calls;
- dependency injection, decorators and GraphQL resolvers;
- keyed event and job dispatch;
- Kysely queries.

It combines this graph with BM25 and a local embedding model, and serves one MCP tool, `find_relevant_code`. The tool returns at most 800 tokens of `file:line` pointers, with each function's callers, callees and handlers. No LLM is used to build or query the index, and nothing leaves your machine.

It is benchmarked head-to-head against [graphify](https://github.com/Graphify-Labs/graphify) 0.9.108 and
[code-review-graph](https://github.com/tirth8205/code-review-graph) 2.4.0. Both run at their latest release, each through its own native MCP server, with code-review-graph in its strongest documented setup.

## Results

### 1. Retrieval: does the tool find the code that matters? (no model calls)

**Recall@10** here is the share of ground-truth functions found in the top 10 results. The ground truth is the bug's root cause and the functions on its path, or the functions a code question is about. The repositories are real and grow in size, and every method gets the same tasks, snapshots, budget and scoring.

| Repository | Lines | Tasks | **TypeTrace** (hybrid) | **TypeTrace** (agent tool, ≤800 tok) | code-review-graph + embeddings | code-review-graph (default) | graphify |
|---|---:|---:|---:|---:|---:|---:|---:|
| nestjs-boilerplate | 6.3k | 20 | **0.69** | **0.65** | 0.31 | 0.18 | 0.12 |
| Immich server | 63k | 26 | **0.48** | **0.39** | 0.26 | 0.03 | 0.04 |
| Twenty server | 763k | 18 | **0.33** | **0.28** | 0.10 | 0.01 | 0.01 |

TypeTrace is ahead of every competitor setup at every scale.
- **Significance:** paired over tasks, 16 of the 18 TypeTrace-vs-competitor comparisons have p ≤ 0.001. Both exceptions are on Immich against code-review-graph + embeddings: hybrid +0.21 (p = 0.025) and agent tool +0.12 (p = 0.12, not significant).
- **Same-embedder control:** _code-review-graph rerun with TypeTrace's own embedding model is running; added when complete._

Full table with MRR, file recall, output size and latency: [`experiments/03-graph-scale/results/h2h-report.md`](experiments/03-graph-scale/results/h2h-report.md).

### 2. Agents: does it make a coding agent better or cheaper?

Setup:
- **Agent:** Claude Code, headless, with Claude Haiku 5.5 and the read-only tools Read, Grep and Glob.
- **Tasks:** 18 held-out bug reports and code questions on the 763k-line Twenty server.
- **Design:** 3 repeats per task and arm, with arms interleaved.
- **Scoring:** automatic, against frozen ground truth (no LLM judge).

| Arm | Task score | Tokens / run | Cost / run | Tool adoption |
|---|---:|---:|---:|---:|
| **+ TypeTrace** | **0.896** | **453k** | **$0.019** | 100% |
| + graphify | 0.867 | 521k | $0.022 | 87% |
| + code-review-graph (with embeddings) | 0.851 | 779k | $0.041 | 81% |
| grep / read only | 0.837 | 513k | $0.023 | — |

Pre-registered confirmatory tests (Holm-corrected, paired by task):
- **Tokens vs graphify:** TypeTrace uses **23% fewer tokens** per task (geometric mean of per-task ratios; 13% by the arm means above). Holm p = 0.003; fewer tokens on 13 of 18 tasks.
- **Tokens vs code-review-graph:** TypeTrace uses **half the tokens**: a per-task ratio of 2.0×, or 1.7× by arm means. Holm p < 0.001; fewer tokens on 17 of 18 tasks. code-review-graph runs cost 2.1× as much.
- **Accuracy:** TypeTrace scores highest, but its leads over graphify (+0.03) and code-review-graph (+0.05) are **not statistically significant** with 18 tasks (Holm p = 0.26).
- **Against the grep-only agent:** +0.06 task score (p = 0.03) at 21% fewer tokens per task (12% by arm means).

_Replications on Immich (Haiku) and on Twenty with Claude Sonnet 5.5 are running and will be added when complete._

### 3. LOCOMO (conversational memory; search stack only)

LOCOMO contains no code, so it tests only TypeTrace's search stack: BM25, Qwen3-Embedding-0.6B and a cross-encoder reranker, with no LLM.

The protocol is open:
- categories 1–4, 1,536 questions;
- dialogue turns as the retrieval unit;
- recall@10 of the evidence turns for each question.

It is identical to an [independent public replication](https://github.com/devkancheti4-design/model-d-graphify), and our BM25 reproduces that replication's 0.540 exactly.

| Method | Recall@10 (all 1,536) | Recall@10 (seeded 300) |
|---|---:|---:|
| **TypeTrace search (hybrid + rerank)** | **0.745** | **0.753** |
| dense (Qwen3-Embedding-0.6B) | 0.637 | 0.642 |
| hybrid RRF | 0.635 | 0.662 |
| BM25 | 0.540 | 0.566 |

graphify reports 0.497 on LOCOMO with a harness that is not public; its BM25 scores 0.362 there, against 0.540 on the open protocol. The two numbers measure different things, so ours is **not** a like-for-like win over graphify's figure. Details: [`experiments/04-locomo/`](experiments/04-locomo/).

## Is this a fair fight? Read this before quoting the numbers

**TypeTrace was built for TypeScript, and every code benchmark here is TypeScript.** TypeTrace uses the TypeScript compiler, while graphify and code-review-graph are multi-language tree-sitter tools. The repositories and tasks were chosen to study scale, not to favour any tool, but a TypeScript-only benchmark is TypeTrace's home ground. TypeTrace **does not support** Python, Go, Java or any other language. Its results say nothing about how it would compare on them; it simply cannot run there.

What makes the comparison fair:
- **Ground truth is independent of every tool.** It comes from merged fix PRs (FAIL_TO_PASS-verified where runnable), a type-checker oracle for change impact, and independent audits. All of it was frozen before any retrieval output existed.
- **Competitors run at their latest releases, as shipped.** Each uses its own native MCP server with every read-only tool it ships, on exactly the files TypeTrace sees.
- **Bugs we found in our own competitor harness were fixed, and they cut both ways.** One made graphify's graph unreachable in the agent arm, and one had code-review-graph indexing the *fixed* code on bug tasks. Both are documented in the [decision log](experiments/03-graph-scale/decision-log.md).
- **Tests were pre-registered before the runs**, with Holm correction. Non-significant results and losses are reported, not dropped.

Where the advantage comes from, and where it doesn't:
- **A good part of the retrieval lead is the embedding model, not the graph.** Qwen3-Embedding-0.6B alone, with no graph and no BM25, already beats code-review-graph + MiniLM embeddings: Recall@10 0.51 vs 0.31 on S, 0.47 vs 0.26 on M, 0.19 vs 0.10 on L. The same-embedder control above measures this directly.
- **The graph adds most on S and L, and little on Immich.** Recall@10 +0.24 on S, +0.05 on M, +0.16 on L, against the same search without the graph.
- **In agents, the graph inside TypeTrace does not significantly improve accuracy.** The same tool without graph propagation scored within 0.02 (pre-registered H4, Holm p = 0.44). Agents with grep recover much of the difference by reading more.
- **The agent accuracy gain over a grep-only agent replicated in one of the runs we have, not all.** In one earlier run on Twenty, grep-only scored 0.867 and the tool 0.851. Accuracy differences between arms are close to run-to-run noise. The **token savings** (18–28%) are what replicate.
- **Only one model family is tested** (Claude Haiku 5.5, plus Sonnet 5.5 in progress), with 18–26 tasks per repository and three repositories. The repositories are public, so models may have seen them; that affects every arm equally.

### The other tools' own benchmarks: did we run TypeTrace on them?

| Their benchmark | Run with TypeTrace? | Why |
|---|---|---|
| graphify: LOCOMO recall@10 / QA | recall only, on an open protocol | their harness is not public; QA needs their LLM reader and judge |
| graphify: LongMemEval-S | no | not yet run (conversational memory, not code) |
| graphify: ERPNext cross-tool (Python, n = 6) | **no** | Python; TypeTrace cannot index it |
| graphify: FastAPI edge-precision audit | **no** | Python. Our own edge audit on TypeScript: 100/100 sampled edges correct after fixes ([edge audit](experiments/03-graph-scale/dataset/audit/)) |
| code-review-graph: token reduction on fastapi, flask, gin, httpx, express | **no** | Python, Go and JavaScript repositories |
| code-review-graph: impact F1 on 13 commits | **no** | its ground truth is derived from its own graph (its README calls the recall "a circular upper bound"); our change-impact tasks use a type-checker oracle instead |

So TypeTrace has **not** been shown to beat these tools on their chosen benchmarks. It beats them on ours: real TypeScript repositories, tool-independent ground truth, competitors as shipped. Running a non-TypeScript comparison would need a TypeTrace extractor for that language.

## Quick start

Requires Node ≥ 22.13, git, and [uv](https://docs.astral.sh/uv/) for the local embedding model (Qwen3-Embedding-0.6B). It runs on CPU, and faster on a GPU.

```bash
git clone https://github.com/Atrix21/typetrace && cd typetrace
npm ci
uv venv --python 3.12 vendor/.venvs/embeddings && \
  uv pip install --python vendor/.venvs/embeddings/bin/python sentence-transformers==5.1.2 transformers==4.57.1 torch==2.9.1 numpy

node bin/typetrace.js index   /path/to/your/repo                 # typed graph + BM25 + embeddings (one-time)
node bin/typetrace.js query   /path/to/your/repo "where are refresh tokens validated"
node bin/typetrace.js install /path/to/your/repo                 # adds the MCP server to <repo>/.mcp.json
```

Restart Claude Code in the repository; the tool is `mcp__typetrace__find_relevant_code`.
- **Where indexes live:** `~/.cache/typetrace/` (override with `TYPETRACE_CACHE`). Your repository is never written to, except `.mcp.json`.
- **Monorepos:** use `--include packages/server/src`. Third-party type declarations are stubbed automatically above 5,000 files; override with `--max-package-decl-mb`.
- **Indexing cost on this machine:** 6k lines take 15 s in total. 763k lines take about 80 s and 4 GB of RAM for the typed graph, plus a one-time embedding pass that is cached by content hash.

## How the benchmark works

| | |
|---|---|
| Repositories | nestjs-boilerplate (S); Immich server @a203e288 (M); Twenty server @bde4ff13 (L). Same language and framework family, 6k to 763k lines |
| Tasks | 64 tasks: S all 20; the held-out test splits of M (26) and L (18).<br>Historical bug fixes reverted on the pinned snapshot (ground truth = the functions the merged fix changed).<br>Feature-understanding, change-impact (type-checker oracle), data-flow and architecture questions.<br>Every task was independently audited before any retrieval output existed |
| Agent harness | Claude Code, headless, in an isolated copy of the workspace with no `.git`, no `node_modules` and no ground truth. Read-only tools, a 40-turn cap and identical prompts per arm. Structured answers are scored automatically |
| Competitors | Latest releases, vendored at pinned commits (`vendor/manifest.json`). Each runs through its own native MCP server with every read-only tool it ships. Graphs are built on exactly the files TypeTrace sees |
| Statistics | The unit is the task, with repeats averaged. Paired bootstrap CIs, one-sided sign-flip permutation tests, and Holm correction over pre-registered families |
| Pre-registration | [`protocol.md`](experiments/03-graph-scale/protocol.md), Amendments C and D, committed before the runs they govern |
| Every decision and fix | [`decision-log.md`](experiments/03-graph-scale/decision-log.md) |

Reproducing:
- **Setup (one command):** `npm ci && npm run setup`. This clones the competitors at their pinned commits into `vendor/` and creates their Python environments plus the embedding environment with `uv`. It also clones the S repository and builds its task snapshots. Immich and Twenty snapshots are built by `scripts/exp3/tasks.ts` from upstream commits listed in `experiments/03-graph-scale/manifests/`.
- **Retrieval-only results** need no API access: `npx tsx scripts/exp3/stage1.ts --repo S|M|L ...`, then `python3 scripts/exp3/analyse-h2h.py`.
- **Agent runs** need a Claude Code login. They are refused unless an approval file and a spend cap allow them.
- **Benchmark repositories:** Immich and Twenty are AGPL-3.0 and are not redistributed here. Tasks reference upstream commits, and transcripts and raw outputs containing their code are kept out of git.

Earlier experiments in this repository: experiment 1 (retrieval on S, `research/findings.md`) and experiment 2 (agent diagnosis on S, `experiments/02-agent-diagnosis/findings.md`).

## Licence

MIT, see [LICENSE](LICENSE). It covers this repository's code and documentation, not the benchmark repositories it downloads.
