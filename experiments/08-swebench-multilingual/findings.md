# Experiment 08: findings (SWE-bench Multilingual, retrieval only)

Run on 2026-11-18, from 04:03 to 19:34 IST, with one pause. All 300 instances: 299 scored with all 9 methods, 1
excluded before the run (its gold patch changes only an HTML template). No method failed on any instance. Protocol:
[`protocol.md`](protocol.md), pre-registered before any retrieval method ran. Changes during the run:
[`decision-log.md`](decision-log.md) (two procedural changes before the first scored instance, one pause, no code
change). Full tables: [`results/report.md`](results/report.md), from `python3 scripts/swebench/analyse.py`.

## Summary

- **TypeTrace finds the changed code better than both competitors (P1 and P2 supported).** Symbol Recall@10:
  TypeTrace `hybrid` 0.389, code-review-graph with its embeddings 0.261, graphify 0.123, code-review-graph default
  0.069. Paired over the 299 instances: +0.266 against graphify and +0.128 against code-review-graph with embeddings
  (both Holm p = 0.0001). TypeTrace leads both competitors in each of the nine languages (exploratory).
- **The call graph does not help here either (P3 not supported).** The same search without the graph scores 0.392,
  against 0.389 with it: Δ −0.002 [−0.034, +0.029], 24 wins / 28 losses / 247 ties. This is experiment 5's result
  (Python) repeated in nine more languages.
- **The agent tool keeps the accuracy in a tenth of the tokens.** `compact_graph` scores 0.381, ahead of both
  competitors, in 750 tokens on average. Per instance its output is 0.12× graphify's and 0.09× that of
  code-review-graph with embeddings (geometric means).
- **As on Python, the lead comes from the search stack, not from the graph.** TypeTrace's search without the graph
  (`hybrid_nograph`: BM25 + Qwen3 embeddings + exact symbol match) is as good as the full product on this benchmark.

## Results (299 instances)

| Method | Recall@10 | RC MRR | File R@10 | File hit@1 | Output tokens |
|---|---:|---:|---:|---:|---:|
| TypeTrace without the graph (`hybrid_nograph`) | **0.392** | 0.269 | 0.713 | 0.388 | 7,582 |
| TypeTrace `hybrid` (with graph) | 0.389 | **0.281** | **0.729** | **0.445** | 6,199 |
| TypeTrace agent tool (`compact_graph`) | 0.381 | 0.272 | 0.671 | **0.445** | **750** |
| graph-only ranker | 0.281 | 0.185 | 0.660 | 0.355 | 5,484 |
| embeddings (Qwen3-Embedding-0.6B) | 0.280 | 0.169 | 0.679 | 0.258 | 7,424 |
| BM25 | 0.271 | 0.158 | 0.576 | 0.224 | 7,588 |
| code-review-graph 2.4.0 + embeddings | 0.261 | 0.186 | 0.619 | 0.371 | 10,467 |
| graphify 0.9.108 | 0.123 | 0.079 | 0.553 | 0.181 | 7,389 |
| code-review-graph 2.4.0 (default) | 0.069 | 0.047 | 0.144 | 0.087 | 4,211 |

Confirmatory family (one-sided paired sign-flip permutation, 20,000 flips, Holm over three tests):

| Test | Δ Recall@10 | 95% CI | W / L / T | Holm p | Result |
|---|---:|---|---|---:|---|
| P1: `hybrid` > graphify | +0.266 | [+0.212, +0.322] | 121 / 18 / 160 | 0.0001 | supported |
| P2: `hybrid` > code-review-graph + embeddings | +0.128 | [+0.074, +0.183] | 83 / 35 / 181 | 0.0001 | supported |
| P3: `hybrid` > `hybrid_nograph` | −0.002 | [−0.034, +0.029] | 24 / 28 / 247 | 0.55 | not supported |

Per language of the ground truth (exploratory, Recall@10):

| Language | n | TypeTrace `hybrid` | without graph | CRG + emb | graphify | graph effect |
|---|---:|---:|---:|---:|---:|---:|
| Ruby | 44 | 0.402 | 0.417 | 0.289 | 0.174 | −0.015 |
| Java | 43 | 0.440 | 0.547 | 0.295 | 0.120 | −0.107 |
| PHP | 43 | 0.361 | 0.258 | 0.324 | 0.226 | +0.103 |
| Rust | 43 | 0.352 | 0.324 | 0.217 | 0.053 | +0.028 |
| Go | 39 | 0.390 | 0.432 | 0.335 | 0.104 | −0.043 |
| JavaScript | 29 | 0.399 | 0.451 | 0.248 | 0.191 | −0.052 |
| C | 28 | 0.518 | 0.435 | 0.196 | 0.036 | +0.083 |
| TypeScript | 13 | 0.327 | 0.327 | 0.169 | 0.077 | +0.000 |
| C++ | 12 | 0.222 | 0.208 | 0.090 | 0.028 | +0.014 |

Five instances whose ground truth spans several languages are in the report only.

## What the numbers mean

**The competitors.** As on TypeScript and Python, code-review-graph's default search returns nothing for most issue
texts (206 of 299), and its embeddings variant is the strongest competitor. graphify usually finds the right file but
rarely the function. Neither competitor beats TypeTrace in any language.

**The graph.** Across all nine languages the graph's effect is zero on average, and it moves only 52 of 299 instances.
Per language it ranges from −0.107 (Java, 43 instances) to +0.103 (PHP, 43), and per repository from −0.26 (gson, 9)
to +0.19 (redis, 12). These splits are exploratory and uncorrected, and most are a handful of wins and losses. The
losses show experiment 5's mechanism. Graph propagation adds neighbours of the best matches (constructors, callers,
sibling methods), and they push the changed function out of the top ten. In `google__gson-1100`, for example, the
changed `DefaultDateTypeAdapter.write` is fifth without the graph. With the graph, `GsonBuilder`'s constructor,
`GsonBuilder.create` and three `Gson.toJson` overloads, all neighbours of the top match `GsonBuilder.setDateFormat`,
push it out of the top ten.

**TypeScript and JavaScript.** These 43 instances use the type-checked graph that helped on Immich and Twenty
(experiments 3 and 6). Here it shows no gain: Δ −0.035 [−0.140, +0.058], 2 wins and 3 losses. The interval is wide
and includes the +0.075 that experiment 6 measured on mined TypeScript fixes, so this does not contradict that
result. It does not confirm it either. The graph's benefit is now shown on two TypeScript repositories, but not on
SWE-bench in any language.

**The agent tool.** `compact_graph` loses 0.008 Recall@10 against `hybrid` and scores 0.120 above code-review-graph
with embeddings (exploratory, p = 0.0001), at a tenth of the tokens. Whether agents use fewer tokens with it on these
repositories was not tested here. Experiment 10 tests that.

## Costs

- **TypeTrace graph build:** median 5.5 s, at most 43 s per snapshot (median 9k nodes and 27k edges). The largest is
  apache/druid (96k nodes, 474k edges).
- **Index times per snapshot (median):** BM25 2.6 s; our embedding stack 4 to 17 s, with vectors cached across a
  repository's snapshots; graphify 8 s; code-review-graph 5 s (default) and 15 s (with embeddings), both rebuilt for
  every snapshot. The setups differ, so these are not a speed comparison (see `results/report.md`).
- **Query latency (mean per query):** BM25 55 ms; `hybrid` 118 ms; `compact_graph` 134 ms; code-review-graph 42 to
  87 ms; graphify 1.9 s.

## Limits

- **Retrieval only.** No agent ran. Recall@10 is about what an agent is shown first, not whether it fixes the issue.
- **Public repositories, old issues.** The embedding model may have seen this code and these issues in training. That
  affects every method that uses embeddings: ours and code-review-graph's.
- **Not tuned on these languages.** The ranking was tuned on TypeScript (experiment 1) and was not re-tuned, as
  pre-registered. A language-specific propagation setting might change P3, but choosing one now would be tuning on
  the test set.
- **Front-end overlap.** Four repositories here (gin, gson, jq, ripgrep; 28 instances) were among the 13 used to check
  the language front-ends' edge precision (experiment 7). No issue or patch from this dataset was looked at.
- **Uneven languages.** TypeScript (13) and C++ (12) have few instances, so their rows are noise.

## What changes in the README

The evidence table gets a row for SWE-bench Multilingual, with the loss on P3. The statement that the graph helps on
TypeScript only now adds that it did not help on SWE-bench's TypeScript and JavaScript issues.
