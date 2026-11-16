<h1 align="center">TypeTrace</h1>

<p align="center"><strong>Your AI coding agent asks "where is the code for this?" and gets a short, exact answer instead of grepping through the whole repository.</strong></p>

<p align="center">Local MCP server for Claude Code and other MCP clients · TypeScript (Python experimental) · no API keys, nothing leaves your machine · MIT</p>

---

TypeTrace maps how your code connects, then answers an agent's question with the few places that matter:

1. **Read the code.** It parses your repository with the real TypeScript compiler and records what calls what. That includes the links grep cannot see: dependency injection, decorators, event and job handlers, API routes and database tables.
2. **Find likely matches.** It searches by words (BM25) and by meaning (a local embedding model, Qwen3-Embedding-0.6B).
3. **Follow the connections.** From those matches it walks the graph to the callers, callees and handlers that are actually involved.

The agent gets one tool, `find_relevant_code`. It returns at most 800 tokens of `file:line` pointers with each function's callers and callees. Then the agent opens the right files instead of searching for them.

For example, on [nestjs-boilerplate](https://github.com/brocoders/nestjs-boilerplate) (first 4 of 12 results, 752 tokens in total):

```text
$ npx typetrace-cli query . "where are refresh tokens validated?"
1. AuthService.validateLogin — src/auth/auth.service.ts:42-97
   → calls: AuthService.getTokensData src/auth/auth.service.ts:599; SessionService.create src/session/session.service.ts:16 +1 more
   ← called by: AuthController.login src/auth/auth.controller.ts:39
2. AuthService.refreshToken — src/auth/auth.service.ts:523-560
   → calls: AuthService.getTokensData src/auth/auth.service.ts:599; UsersService.findById src/users/users.service.ts:147; SessionService.updateByHash src/session/session.service.ts:31
   ← called by: AuthController.refresh src/auth/auth.controller.ts:106
3. AuthController.refresh — src/auth/auth.controller.ts:106-123
   ← route: /auth/refresh src/auth/auth.controller.ts:106 (framework)
4. JwtRefreshStrategy.validate — src/auth/strategies/jwt-refresh.strategy.ts:24-32
```

## Quick start

```bash
cd your-repo
npx typetrace-cli init
```

Or install it once (`npm i -g typetrace-cli`) and use the `typetrace` command: `typetrace init`.

That indexes the repository and registers the MCP server in `.mcp.json`. Restart Claude Code in the repository and approve the `typetrace` server. The agent can then call `find_relevant_code` whenever it needs to find code.

```bash
npx typetrace-cli query . "where are refresh tokens validated?"   # see what the agent sees
npx typetrace-cli index .                                         # re-index after large changes
```

**Requirements and what to expect:**
- **Node.js 22.13 or newer.** No Python, no GPU and no API key needed.
- **First run downloads the embedding model (~2.4 GB, once)** to `~/.cache/typetrace/models`. npm dependencies take about 900 MB, mostly ONNX Runtime.
- **RAM:** about 6 GB while indexing; the MCP server needs less.
- **First index time** is dominated by embedding on the CPU. Measured on an 8-core laptop CPU (i7-11800H):

  | Repository | Size | Code chunks | First index |
  |---|---:|---:|---:|
  | nestjs-boilerplate | 6k lines | 728 | 4.5 min (incl. model download) |
  | Immich server | 63k lines | 5,764 | ≈ 25 min (estimated from the chunk rate) |
  | Twenty server | 763k lines | 50,151 | ≈ 3.5 h (estimated from the chunk rate) |

  Re-indexing only embeds code that changed. For very large repositories, index the part you work on (`--include packages/server/src`), or use the GPU backend from a source checkout (`--gpu`, see [Reproducing](#reproducing-the-benchmark)).
- **Languages:** TypeScript/TSX. Python is experimental (see [Python](#python)).

## Results

Everything below was measured on three real TypeScript repositories of increasing size, against [graphify](https://github.com/Graphify-Labs/graphify) 0.9.108 and [code-review-graph](https://github.com/tirth8205/code-review-graph) 2.4.0. Both ran at their latest releases, through their own MCP servers, on exactly the same files. The tests were pre-registered before the runs, losses are reported, and [everything is reproducible](#reproducing-the-benchmark).

### 1. Does it find the right code? (retrieval, no model calls)

**Recall@10** is the share of the ground-truth functions (a bug's root cause and the functions on its path, or the functions a code question is about) found in the top 10 results.

| Repository | Lines | Tasks | **TypeTrace** (hybrid) | **TypeTrace** (agent tool, ≤800 tok) | code-review-graph + embeddings | code-review-graph (default) | graphify |
|---|---:|---:|---:|---:|---:|---:|---:|
| nestjs-boilerplate | 6.3k | 20 | **0.69** | **0.65** | 0.31 | 0.18 | 0.12 |
| Immich server | 63k | 26 | **0.48** | **0.39** | 0.26 | 0.03 | 0.04 |
| Twenty server | 763k | 18 | **0.33** | **0.28** | 0.10 | 0.01 | 0.01 |

- **TypeTrace is ahead at every scale.** Paired over tasks, 16 of the 18 TypeTrace-vs-competitor comparisons have p ≤ 0.001. The two exceptions are on Immich against code-review-graph + embeddings: hybrid +0.21 (p = 0.025) and the agent tool +0.12 (p = 0.12, not significant).
- **It is not just a better embedding model.** We re-ran code-review-graph with TypeTrace's own embedding model (Qwen3-Embedding-0.6B). It scored 0.28, 0.23 and 0.17, still well below TypeTrace on every repository (p < 0.01 each).
- **The graph matters more as repositories grow.** On Twenty, the same search without the graph scores 0.17; with it, 0.33.

Full table with MRR, file recall, output size and latency: [`h2h-report.md`](experiments/03-graph-scale/results/h2h-report.md).

### 2. Does it make a coding agent better or cheaper?

Claude Code, headless, with the read-only tools Read, Grep and Glob plus the arm's MCP server. Held-out bug reports and code questions, 3 repeats per task and arm, scored automatically against frozen ground truth (no LLM judge).

**Twenty server (763k lines), Claude Haiku 5.5, 18 tasks:**

| Arm | Task score | Tokens / task | Cost / task | Tool adoption |
|---|---:|---:|---:|---:|
| **+ TypeTrace** | **0.896** | **453k** | **$0.019** | 100% |
| + graphify | 0.867 | 521k | $0.022 | 87% |
| + code-review-graph (with embeddings) | 0.851 | 779k | $0.041 | 81% |
| grep / read only | 0.837 | 513k | $0.023 | — |

**Immich server (63k lines), Claude Haiku 5.5, 26 tasks:**

| Arm | Task score | Tokens / task | Cost / task | Tool adoption |
|---|---:|---:|---:|---:|
| **+ TypeTrace** | **0.860** | **190k** | $0.013 | 100% |
| + graphify | 0.833 | 248k | $0.013 | 92% |
| + code-review-graph (with embeddings) | 0.859 | 399k | $0.019 | 69% |
| grep / read only | 0.816 | 235k | $0.013 | — |

**Twenty server, Claude Sonnet 5.5, 18 tasks × 2 (TypeTrace vs grep only):** task score 0.873 vs 0.845, 166k vs 209k tokens per task.

What this shows (pre-registered tests, Holm-corrected, paired by task):
- **Fewer tokens: yes, every time.** Against graphify, 23% fewer per task on Twenty (p = 0.003) and 34% fewer on Immich (p < 0.001). Against code-review-graph, half the tokens or less on both (p < 0.001, fewer on 43 of 44 tasks). Against grep only, 18–28% fewer on all three runs (p ≤ 0.03).
- **More correct answers: not shown.** TypeTrace scores highest or tied in every run, but its accuracy leads over graphify and code-review-graph are **not statistically significant** with 18–26 tasks. Against grep only, the gain is small but consistent: +0.06 on Twenty (p = 0.03) and +0.04 on Immich (p = 0.02) with Haiku; +0.03 with Sonnet (not significant). These are exploratory tests, not the pre-registered family.
- **Cost:** on Twenty, TypeTrace runs are the cheapest. On Immich, cost per task is about the same as graphify and grep only, despite fewer tokens: cached prompt tokens are cheap, so token savings do not always become dollar savings.

## Is this a fair fight? Read this before quoting the numbers

**TypeTrace was built for TypeScript, and every benchmark above is TypeScript.** It uses the TypeScript compiler, while graphify and code-review-graph are multi-language tree-sitter tools. The repositories and tasks were chosen to study scale, not to favour any tool, but TypeScript is TypeTrace's home ground.

What makes the comparison fair:
- **Ground truth is independent of every tool.** It comes from merged fix PRs, a type-checker oracle for change impact, and independent audits, all frozen before any retrieval output existed.
- **Competitors run at their latest releases, as shipped**, each through its own native MCP server with every read-only tool it ships, on exactly the files TypeTrace sees.
- **Bugs in our own competitor harness were fixed, and they cut both ways.** One made graphify's graph unreachable in the agent arm; one had code-review-graph indexing the *fixed* code on bug tasks. Both are in the [decision log](experiments/03-graph-scale/decision-log.md).
- **The tests were pre-registered** before the runs, with Holm correction. Non-significant results and losses are reported, not dropped.

Where the advantage comes from, and where it doesn't:
- **The embedding model is part of it, but not the explanation.** Qwen3-Embedding-0.6B alone, with no graph and no BM25, already beats code-review-graph + MiniLM embeddings (Recall@10 0.51 vs 0.31, 0.47 vs 0.26, 0.19 vs 0.10). But code-review-graph *given* Qwen3 still trails TypeTrace by 0.16–0.41.
- **The graph adds most on the smallest and largest repositories.** Recall@10 +0.24 on nestjs-boilerplate, +0.05 on Immich, +0.16 on Twenty, against the same search without the graph.
- **Inside the agent, the graph does not significantly improve accuracy.** The same tool without graph propagation scored within 0.02 (pre-registered, Holm p = 0.44). Agents with grep recover much of the difference by reading more files. The token savings are what replicate.
- **Scope:** Claude Haiku 5.5 and Sonnet 5.5 only, 18–26 tasks per repository, three repositories. The repositories are public, so models may have seen them; that affects every arm equally.

### Python

Python support is **new and experimental**. It uses tree-sitter with scope, import and inheritance resolution. Links it can only guess by name are labelled as inferred, not verified. It is **not benchmarked yet**. A head-to-head on [SWE-bench Lite](https://www.swebench.com/) (300 real Python issues, ground truth from the merged fixes) is [pre-registered](experiments/05-swebench-python/protocol.md) and will be published, win or lose. Go, Java and Rust are not supported yet.

### The other tools' own benchmarks: did we run TypeTrace on them?

| Their benchmark | Run with TypeTrace? | Why |
|---|---|---|
| graphify: LOCOMO recall@10 / QA | recall only, on an open protocol (below) | their harness is not public; QA needs their LLM reader and judge |
| graphify: LongMemEval-S | no | conversational memory, not code |
| graphify: ERPNext cross-tool (Python, n = 6) | not yet | Python; the SWE-bench Lite run above is the larger Python test |
| graphify: FastAPI edge-precision audit | not yet | Python. Our own edge audit on TypeScript: 100/100 sampled edges correct after fixes ([edge audit](experiments/03-graph-scale/dataset/audit/)) |
| code-review-graph: token reduction on fastapi, flask, gin, httpx, express | no | Python, Go and JavaScript repositories |
| code-review-graph: impact F1 on 13 commits | no | its ground truth is derived from its own graph (its README calls the recall "a circular upper bound"); our change-impact tasks use a type-checker oracle instead |

So TypeTrace has **not** been shown to beat these tools on their chosen benchmarks. It beats them on ours: real TypeScript repositories, tool-independent ground truth, competitors as shipped.

### LOCOMO (conversational memory; search stack only)

LOCOMO contains no code, so it tests only TypeTrace's search stack (BM25, Qwen3-Embedding-0.6B and a cross-encoder reranker, no LLM). The protocol is open: categories 1–4, 1,536 questions, dialogue turns as the retrieval unit, recall@10 of the evidence turns. It is identical to an [independent public replication](https://github.com/devkancheti4-design/model-d-graphify), whose BM25 score of 0.540 we reproduce exactly.

| Method | Recall@10 (all 1,536) | Recall@10 (seeded 300) |
|---|---:|---:|
| **TypeTrace search (hybrid + rerank)** | **0.745** | **0.753** |
| dense (Qwen3-Embedding-0.6B) | 0.637 | 0.642 |
| hybrid RRF | 0.635 | 0.662 |
| BM25 | 0.540 | 0.566 |

graphify reports 0.497 on LOCOMO with a harness that is not public; its BM25 scores 0.362 there, against 0.540 on the open protocol. The numbers measure different things, so ours is **not** a like-for-like win over graphify's figure. Details: [`experiments/04-locomo/`](experiments/04-locomo/).

## How it works

- **TypeScript graph:** built with the TypeScript compiler, so calls are resolved by type, not by name. It covers typed calls, dependency injection, decorators, GraphQL resolvers, keyed event and job dispatch, HTTP routes and Kysely queries.
- **Python graph (experimental):** tree-sitter with scope, import, inheritance (MRO) and `self.attr` resolution. Name-only guesses are kept separate and marked as inferred.
- **Search:** BM25 plus Qwen3-Embedding-0.6B, fused, then graph propagation from the best matches.
- **Output:** at most 800 tokens of `file:line` pointers with callers, callees and handlers, so the agent's context stays small.
- **No LLM** is used to build or query the index, and nothing leaves your machine.
- **Storage:** indexes live in `~/.cache/typetrace/` (move with `TYPETRACE_CACHE`) and the model in `~/.cache/typetrace/models/` (`TYPETRACE_MODEL_DIR`). Your repository is never written to, except `.mcp.json`.
- **Monorepos:** `npx typetrace-cli init --include packages/server/src`. Third-party type declarations are stubbed automatically above 5,000 files.

## Reproducing the benchmark

| | |
|---|---|
| Repositories | nestjs-boilerplate (S); Immich server @a203e288 (M); Twenty server @bde4ff13 (L). Same language and framework family, 6k to 763k lines |
| Tasks | 64 tasks: S all 20; the held-out test splits of M (26) and L (18).<br>Historical bug fixes reverted on the pinned snapshot (ground truth = the functions the merged fix changed).<br>Feature-understanding, change-impact (type-checker oracle), data-flow and architecture questions.<br>Every task was independently audited before any retrieval output existed |
| Agent harness | Claude Code, headless, in an isolated copy of the workspace with no `.git`, no `node_modules` and no ground truth. Read-only tools, a 40-turn cap and identical prompts per arm. Structured answers are scored automatically |
| Competitors | Latest releases, vendored at pinned commits (`vendor/manifest.json`). Each runs through its own native MCP server with every read-only tool it ships. Graphs are built on exactly the files TypeTrace sees |
| Statistics | The unit is the task, with repeats averaged. Paired bootstrap CIs, one-sided sign-flip permutation tests, and Holm correction over pre-registered families |
| Pre-registration | [`protocol.md`](experiments/03-graph-scale/protocol.md), Amendments C and D, committed before the runs they govern |
| Every decision and fix | [`decision-log.md`](experiments/03-graph-scale/decision-log.md) |

Steps:
- **Setup (one command):** `git clone https://github.com/Atrix21/typetrace && cd typetrace && npm ci && npm run setup`. This clones the competitors at their pinned commits into `vendor/` and creates their Python environments, plus the PyTorch embedding environment, with [uv](https://docs.astral.sh/uv/). It also clones the S repository and builds its task snapshots. Immich and Twenty snapshots are built by `scripts/exp3/tasks.ts` from upstream commits listed in `experiments/03-graph-scale/manifests/`.
- **Retrieval-only results** need no API access: `npx tsx scripts/exp3/stage1.ts --repo S|M|L ...`, then `python3 scripts/exp3/analyse-h2h.py`.
- **Agent runs** need a Claude Code login. They are refused unless an approval file and a spend cap allow them.
- **Embeddings:** every published number uses the PyTorch backend (`--gpu`). The CPU backend that `npx typetrace-cli` uses runs the same model in ONNX. On the S tasks it matches: Recall@10 0.650 vs 0.650 for the agent tool, and at most one task differs per method ([parity check](experiments/03-graph-scale/results/onnx-parity-S/)).
- **Benchmark repositories:** Immich and Twenty are AGPL-3.0 and are not redistributed here. Tasks reference upstream commits, and transcripts and raw outputs containing their code are kept out of git.

Earlier experiments in this repository: experiment 1 (retrieval on S, `research/findings.md`) and experiment 2 (agent diagnosis on S, `experiments/02-agent-diagnosis/findings.md`).

## Licence

MIT, see [LICENSE](LICENSE). It covers this repository's code and documentation, not the benchmark repositories it downloads.
