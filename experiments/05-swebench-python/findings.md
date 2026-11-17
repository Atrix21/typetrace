# Experiment 05: findings (SWE-bench Lite, Python, retrieval only)

Run 2026-11-16 to 2026-11-18. All 300 instances, 9 methods each, no exclusions. Protocol: [`protocol.md`](protocol.md),
pre-registered on 2026-11-15. Changes during the run: [`decision-log.md`](decision-log.md) (one crash fix with no effect
on output, two pauses). Full tables: [`results/report.md`](results/report.md), from `python3 scripts/swebench/analyse.py`.

## Summary

- **TypeTrace finds the changed code better than both competitors (P1 and P2 supported).** Symbol Recall@10:
  TypeTrace `hybrid` 0.469, code-review-graph with its embeddings 0.354, graphify 0.151, code-review-graph default
  0.127. Paired over the 300 instances: +0.318 against graphify (Holm p = 0.0001) and +0.115 against
  code-review-graph with embeddings (Holm p = 0.0005).
- **The Python call graph does not help (P3 not supported).** The same search without the graph scores 0.487, against
  0.469 with it: Δ −0.018 [−0.055, +0.019], 17 wins / 24 losses / 259 ties. On TypeScript (experiment 3) the graph
  added +0.05 to +0.24. On Python it adds nothing measurable, and on some repositories it costs recall
  (scikit-learn −0.20 over 23 instances).
- **The agent tool keeps most of the accuracy in a tenth of the tokens.** `compact_graph` (the output an agent gets)
  scores 0.454, ahead of both competitors, in 748 tokens on average. The full-output methods, the competitors
  included, return 3,800 to 7,700. Per instance, its output is 0.14× graphify's and 0.12× that of code-review-graph with embeddings
  (geometric means).
- **The best single method on Python is our search without the graph** (`hybrid_nograph`: BM25 + Qwen3 embeddings +
  exact symbol match). For the product this means that on Python, TypeTrace's lead comes from its search stack, not
  from its graph.

## Results (all 300 instances)

| Method | Recall@10 | RC MRR | File R@10 | File hit@1 | Output tokens |
|---|---:|---:|---:|---:|---:|
| TypeTrace without the graph (`hybrid_nograph`) | **0.487** | **0.316** | **0.800** | 0.433 | 7,660 |
| TypeTrace `hybrid` (with graph) | 0.469 | 0.296 | **0.800** | **0.450** | 6,124 |
| TypeTrace agent tool (`compact_graph`) | 0.454 | 0.289 | 0.747 | **0.450** | **748** |
| embeddings (Qwen3-Embedding-0.6B) | 0.419 | 0.238 | 0.780 | 0.317 | 7,013 |
| BM25 | 0.392 | 0.249 | 0.700 | 0.353 | 7,540 |
| code-review-graph 2.4.0 + embeddings | 0.354 | 0.200 | 0.717 | 0.413 | 7,288 |
| graph-only ranker | 0.312 | 0.179 | 0.677 | 0.330 | 5,741 |
| graphify 0.9.108 | 0.151 | 0.083 | 0.667 | 0.237 | 6,570 |
| code-review-graph 2.4.0 (default) | 0.127 | 0.085 | 0.240 | 0.163 | 3,824 |

Confirmatory family (one-sided paired sign-flip permutation, 20,000 flips, Holm over three tests):

| Test | Δ Recall@10 | 95% CI | W / L / T | Holm p | Result |
|---|---:|---|---|---:|---|
| P1: `hybrid` > graphify | +0.318 | [+0.259, +0.375] | 109 / 10 / 181 | 0.0001 | supported |
| P2: `hybrid` > code-review-graph + embeddings | +0.115 | [+0.057, +0.173] | 64 / 32 / 204 | 0.0005 | supported |
| P3: `hybrid` > `hybrid_nograph` | −0.018 | [−0.055, +0.019] | 17 / 24 / 259 | 0.83 | not supported |

## What the numbers mean

**The competitors.** code-review-graph's default search found nothing for 178 of the 300 issue texts. Its documentation
says that natural-language queries return nothing without its embeddings, which is why the embeddings variant is the
pre-registered comparison. With them, it is the strongest competitor and reaches 0.354. graphify usually finds the
right file (file Recall@10 0.667), but rarely the function: its `query` returns the neighbourhood of keyword-matched
graph nodes rather than ranked functions. These are the same patterns as on TypeScript (experiment 3), so Python,
their best-supported language, does not change the picture.

**Why the graph does not help here.** The 24 instances where the graph lowered Recall@10 show one pattern. Graph
propagation adds close neighbours of the best matches: other methods of the same class, `__init__`, callers, and the
tests that call the function. They push the changed function from rank 7 to 10 out of the top 10. Examples:
`scikit-learn-13142`, where `BaseMixture.fit_predict` is displaced by `GaussianMixture.__init__` and test helpers;
`sympy-14817`, where the parser functions crowd out `PrettyPrinter._print_MatAdd`. The 17 wins are the same mechanism
working the other way. Two differences from the TypeScript benchmarks plausibly explain why the balance is negative
here. Neither was tested by this experiment:

1. **Ground truth.** SWE-bench Lite's ground truth is the functions the gold patch changed: one function in 248 of
   300 instances (mean 1.2). Experiment 3's tasks also count the functions on the bug's path (mean 5.2 on Immich and
   7.9 on Twenty), and propagation is built to retrieve exactly those. Against changed-functions-only ground truth on
   TypeScript, though, the graph still helped: on 127 mined Immich and Twenty fixes it was worth +0.075 Recall@10
   (experiment 6, development data). So ground truth alone does not explain the difference.
2. **Graph precision.** The TypeScript graph is resolved by the type checker. The Python graph is syntactic: of the
   calls it sees in a typical snapshot, about a fifth are resolved from scopes, imports and `self` types, a tenth are
   inferred by name (at most three candidates), and the rest are left unresolved (`graphs.jsonl`, astropy: 19,666 /
   10,990 / 61,427). Name-inferred edges into large classes connect many functions that a bug does not involve.

Per repository the effect varies widely (`results/report.md`): the graph helps on pytest (+0.12, 17 instances) and
django (+0.02, 114), and hurts on scikit-learn (−0.20, 23) and sympy (−0.03, 77). Repositories with 3 to 6 instances
are noise.

**The agent tool.** `compact_graph` renders the same ranking as file:line pointers with relations, capped at about 800
tokens. It loses 0.015 Recall@10 against `hybrid` and scores 0.10 above code-review-graph with embeddings
(p = 0.001, exploratory), at a tenth of the tokens. On TypeScript this property is what made agents use fewer tokens
(experiment 3). Whether it does so on Python was not tested: no agent runs were made here.

## Costs

- **TypeTrace Python graph build:** median 6.0 s, at most 32 s per snapshot (median 35k nodes, 119k edges; sympy's
  later snapshots are the largest).
- **Index times per snapshot** (median): BM25 5.9 s; our embedding stack 8.5 to 14 s, with vectors cached across a
  repository's snapshots; graphify 45 s; code-review-graph 20 s (default) and 50 s (with embeddings), both rebuilt
  for every snapshot. The setups differ, so these are not a speed comparison (see `results/report.md`).
- **Query latency** (mean per query): BM25 71 ms; `hybrid` 210 ms; `compact_graph` 225 ms; code-review-graph
  63 to 106 ms; graphify 3.4 s.

## Limits

- **Retrieval only.** No agent ran. Recall@10 is about what an agent is shown first, not whether it fixes the issue.
- **Public repositories, old issues.** Every repository here was public long before the embedding model was trained,
  so it may have seen the code and the issues. That affects every method that uses embeddings: ours and
  code-review-graph's.
- **Not tuned on Python.** The ranking was tuned on TypeScript (experiment 1) and was not re-tuned here, as
  pre-registered. A Python-specific propagation setting (for example, dropping name-inferred edges, or excluding test
  files from expansion) might change P3. Testing one now would be tuning on the test set, so it needs new data.
- **Uneven repositories.** django (114) and sympy (77) are 64% of the instances.

## What changes in the README

The "Python" row of the evidence table now reports these results, the loss on P3 included. The claim that the call
graph helps is limited to TypeScript.
