# Experiment 06: confirmatory test of cross-encoder reranking (pre-registered)

Written and committed on 2026-11-17, before any reranker output existed for a task of the held-out test split.

## Background

Experiment 06 looked for a retrieval improvement that experiments 1–5 had not tried. Design work used only:
- the frozen dev splits (S 6, M 11, L 6 tasks);
- a development-only set of 127 mined bug fixes that are not frozen tasks (M 67, L 60), queried on the pinned snapshots. The fix is present in that code and some reports state the fix, so this set is never used for a claim.

Five directions showed no reliable gain there and are not tested on the held-out split (`findings.md` has the numbers). One did: reranking the top 50 results of the frozen `hybrid` ranking with a local cross-encoder trained for code retrieval, fused with the original order.

| Set | n | hybrid Recall@10 | reranked (RRF k=10) | paired Δ | W/L | p (two-sided sign-flip) |
|---|---:|---:|---:|---:|---|---:|
| development-only mined fixes | 127 | 0.652 | 0.692 | +0.040 | 20/9 | 0.06 |
| frozen dev split | 23 | 0.420 | 0.477 | +0.058 | 7/3 | 0.32 |

A general-text cross-encoder (`BAAI/bge-reranker-base`) made the dev split worse (−0.10 alone) and is not tested further.

## Method under test (frozen before the run)

- **Candidates:** the top 50 of the frozen `hybrid` ranking, produced by the lean engine `scripts/exp6/lean.ts`. That engine reproduces the stored stage-1 `hybrid` output exactly on all 81 frozen tasks (S 20, M 37, L 24).
- **Reranker:** `Qwen/Qwen3-Reranker-0.6B` at revision `e61197ed45024b0ed8a2d74b80b4d909f1255473`, fp16 on the GPU, score = P("yes"), prompt format of its model card, instruction as in `scripts/exp6/rerank.py`, at most 1,024 tokens per pair, query truncated to 1,200 characters, candidate text = the declaration's source (at most 150 lines) under a `// file symbol` header.
- **Fusion:** reciprocal-rank fusion of the hybrid rank and the reranker rank, `1/(10 + rank)` each, ties by hybrid rank (`rrf10` in `scripts/exp6/rerank_eval.py`). RRF k = 10 was chosen on the development-only set, the larger of the two design sets.
- No model call other than this local reranker. No change to the graph, the embeddings or the first-stage ranking.

## Data

The held-out test splits used by the stage-1 report: S 14, M 26, L 18 tasks (58). Snapshots, queries, ground truth, normalisation and metric formulas are those of experiment 3 (`scripts/exp6/run.ts` imports them).

## Outcomes and tests

- **Primary (confirmatory, one test):** symbol Recall@10 of `hybrid + rerank (rrf10)` > frozen `hybrid`, pooled over the 58 tasks. One-sided paired sign-flip permutation test, α = 0.05, 20,000 permutations, fixed seed. 95% task-level bootstrap CI of the mean difference.
- **Secondary (descriptive):** per repository; bug localisation and understanding tasks separately; root-cause MRR on bug tasks; file Recall@10; reranker-only order; seconds per query.
- **Reported whatever the outcome.** A null or negative result is a result. The reranker and fusion are not changed after the run; any later variation is labelled exploratory.

## What this test cannot show

- Agent benefit: no agent run is part of experiment 06 (no spend approval was sought).
- CPU feasibility: the measured cost is on an RTX 3060. The packaged CLI runs on the CPU, where a 0.6B cross-encoder over 50 candidates would take far longer.
