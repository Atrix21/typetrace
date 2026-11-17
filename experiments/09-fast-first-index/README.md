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
| M: Immich server (63k lines) | 26 | 0.39 | *pending* | | |
| L: Twenty server (763k lines) | 18 | 0.28 | *pending* | | |

- **S:** no measurable loss: 17 of 20 tasks tie. S is small, though, and it is the repository the ranking was tuned on
  (experiment 1), so this does not carry over to large repositories. There, embeddings may matter more.
- **M and L** run when the machine is free (one heavy job at a time: the L graph build alone peaks at 4 GB).

## Time until the first answer

The first answer can come as soon as the call graph is built. Measured graph builds (experiment 3,
`results/stage1-<repo>/graph-builds.jsonl`):

| Repository | Graph build | Peak memory | Semantic search complete (CPU, background) |
|---|---:|---:|---:|
| S (172 files with tests) | 1.7 s, whole `init --no-embed` | 0.35 GB | 4.5 min |
| M | 22 s | 1.8 GB | ≈ 25 min |
| L | 81 s | 4.0 GB | ≈ 3.5 h |

Raw outputs are not committed (they contain code from the benchmark repositories). `results/S/` holds the metrics
and the run's metadata.
