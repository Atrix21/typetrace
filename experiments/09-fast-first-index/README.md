# Experiment 09: fast first index (product, exploratory)

**Question.** `typetrace init` now returns once the call graph and the keyword index are built. The embeddings are
computed afterwards by a background job. Until it finishes, a code chunk without a vector has no semantic score, so
search runs on keywords, exact symbol names, graph facts and graph propagation: the method `compact_graph_lex`
(`hybrid` with `wSem = 0`, rendered like the agent tool). How much worse is that than the benchmarked tool
(`compact_graph`)?

**Method.** The experiment 3 harness, with the same tasks, snapshots, budget and scoring as the published numbers:

```bash
npx tsx scripts/exp3/stage1.ts --repo S --split all  --out <dir> --methods compact_graph_lex
npx tsx scripts/exp3/stage1.ts --repo M --split test --out <dir> --methods compact_graph_lex
npx tsx scripts/exp3/stage1.ts --repo L --split test --out <dir> --methods compact_graph_lex
```

It is compared with the stored `compact_graph` rows of `experiments/03-graph-scale/results/stage1-<repo>/`. This is
exploratory and was not pre-registered. It decides what the README may say about the fast mode, not a release.

That a user really gets `compact_graph_lex` before the embeddings exist is checked separately. With no vectors, the
served tool's output is byte-identical to `compact_graph_lex` (`tests/product/fast-mode.test.ts`).

## Results

| Repository | Tasks | Recall@10, full tool | Recall@10, fast mode | Root-cause MRR, full / fast | Fast vs full, per task (W/L/T) |
|---|---:|---:|---:|---:|---:|
| S: nestjs-boilerplate (6k lines) | 20 | 0.650 | 0.662 | 0.443 / 0.419 | 2 / 1 / 17 |
| M: Immich server (63k lines) | 26 | 0.387 | 0.398 | 0.291 / 0.266 | 3 / 3 / 20 |
| L: Twenty server (763k lines) | 18 | 0.284 | **0.171** | 0.220 / **0.047** | 2 / 9 / 7 |

Paired differences (fast − full, 95% bootstrap CI over tasks):

| Repository | Δ Recall@10 | Δ root-cause MRR |
|---|---|---|
| S | +0.013 [−0.037, +0.062] | −0.024 [−0.148, +0.087] |
| M | +0.010 [−0.032, +0.062] | −0.025 [−0.105, +0.051] |
| L | **−0.113 [−0.200, −0.032]** | **−0.172 [−0.339, −0.028]** |

- **S and M:** no measurable loss. Most tasks tie, and the confidence intervals include zero.
- **L: a clear loss.** On the 763k-line repository, the answers before embeddings exist find about 40% less of the
  relevant code, and the root cause rarely comes first. This is where search by meaning matters: with tens of
  thousands of functions, keyword matches are many and weak, so the graph spreads from the wrong seeds.
- **So the fast mode is a stopgap on large repositories.** It answers within about 1.5 minutes instead of 3.5 hours,
  but those answers are clearly worse than the full tool's until the background embedding finishes. `typetrace
  status` shows the progress. The README says this.
- **Same graphs.** The graphs are identical to experiment 3's: the SHA-256 of every M and L snapshot graph matches
  `experiments/03-graph-scale/results/stage1-*/graph-builds.jsonl` (M pinned, and L 18 of 18).

## Time until the first answer

The first answer can come as soon as the call graph is built. Measured graph builds (experiment 3,
`results/stage1-<repo>/graph-builds.jsonl`):

| Repository | Graph build | Peak memory | Semantic search complete (CPU, background) |
|---|---:|---:|---:|
| S (172 files with tests) | 1.7 s, whole `init --no-embed` | 0.35 GB | 4.5 min |
| M | 22 s | 1.8 GB | ≈ 25 min |
| L | 81 s | 4.0 GB | ≈ 3.5 h |

Raw outputs are not committed (they contain code from the benchmark repositories). `results/<repo>/` holds the metrics
and the run's metadata.

## Live check: background embedding and the switch-over

On 2026-11-18, the built branch was run on a fresh copy of nestjs-boilerplate (172 indexed files). It used an empty
cache, real CPU (ONNX) embedding, and an MCP client that asked the same question every 20 s:

- **`init`** returned after 1.4 s. `status` showed the job starting, then progress ("112 of 733 code chunks, about
  86 s left"), then "complete".
- **The served tool switched over without a restart.** The first nine answers were the fast mode's: the top result
  was `AuthService.getTokensData`. When the embedding finished, the server logged "index reloaded". From then on its
  answers were byte-identical to `typetrace query` on the finished index: the top result was
  `AuthService.validateLogin`, as in the published agent tool.
