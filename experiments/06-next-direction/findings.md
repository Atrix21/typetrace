# Experiment 06: searching for the next improvement — findings

2026-11-16/17. No billable run, no agent run. Branch `research/exp6-next-direction`.

## Summary

- **No retrieval-accuracy improvement was found.** Six directions that experiments 1–5 had not tried were tested. Five showed no reliable gain on design data. The sixth, cross-encoder reranking, looked positive on design data and failed its pre-registered held-out test: Recall@10 0.477 → 0.482, Δ +0.005 [−0.035, +0.045], 10 wins / 8 losses, one-sided p = 0.40.
- **The agent tool is now 13–46× faster with byte-identical output.** Three query-time hot spots in the product code were indexed. On Twenty (763k lines) a `find_relevant_code` query drops from 13.3 s to 0.29 s; on Immich from 730 ms to 54 ms. Output is byte-identical to the stored stage-1 output on every task checked (S 100/100 method–task outputs, M 30/30, L 28/28).
- **The graph's benefit replicated on new data.** On 127 mined bug fixes that are not frozen tasks, removing the graph costs 0.075 Recall@10 (0.652 → 0.578, 24 losses / 12 wins, p = 0.010) and 0.135 root-cause MRR (p < 0.001). This set is development-only (see §2), so it supports the stage-1 result but is not a new claim.
- **A lean ranking engine reproduces the frozen `hybrid` ranking exactly** on all 81 frozen tasks at 4 / 23 / 163 ms per query (S / M / L) and 2.2 GB on Twenty. It was the experiment harness here and is not wired into the product.

## 1. What was already known, and what had not been challenged

Established by experiments 1–5: typed-graph propagation from lexical and semantic seeds beats flat retrieval; the seed quality dominates; inside an agent the tool saves tokens but graph content adds little accuracy; recall falls with scale (hybrid Recall@10 0.69 / 0.48 / 0.33 on S / M / L).

Assumptions never tested before this experiment:
1. The repository is a static snapshot. No signal used change history.
2. The retrieval unit is one declaration. No file-level evidence entered the ranking.
3. The graph is used only at query time, never to shape what is embedded.
4. First-stage scores are final. No model re-reads the candidates.
5. Seed selection and propagation settings tuned on a 6k-line repository carry over to 63k and 763k lines.
6. Query latency was treated as an engineering detail (12 s on Twenty).

## 2. Data used for design, and its limits

- **Frozen dev splits:** S 6, M 11, L 6 tasks (23). Too few to separate effects below about ±0.05.
- **Development-only set (new):** mined bug-fix candidates that are not frozen tasks, 127 queries (Immich 67, Twenty 60), run on the pinned snapshots (`run.ts --silver`). Ground truth is the functions the fix changed that still exist under the same key. Two known biases: the fix is present in the code, and some reports state the fix (the audit rejected them for that). It is easier than the frozen tasks (hybrid Recall@10 0.65) and is used only to choose what to test.
- **Change-history replay:** every fix commit of the last year (Immich 277, Twenty 866), history cut strictly before each fix.
- **Held-out test splits** (S 14, M 26, L 18) were used once, for the pre-registered reranker test.

## 3. Directions tested

### 3.1 Change history as a prior — rejected

Hypothesis: where a fix lands is predictable from recent change activity, and that prior can lift bug localisation.

The prior alone is real. Ranking files by 90-day decayed change count, as of just before each fix:

| Repository | Fix commits | Fixed file in top 5% | in top 10% | Chance (best of ≤ 5 files) |
|---|---:|---:|---:|---|
| Immich | 277 | 49% | 65% | 9% / 17% |
| Twenty | 866 | 46% | 58% | 9% / 19% |

Combined with text retrieval it hurts everywhere:

| Setting | n | Baseline | With prior (exponent 0.25 / 0.5) |
|---|---:|---|---|
| Frozen dev, Immich bug tasks, stored hybrid top 50, Recall@10 | 7 | 0.524 | 0.524 / 0.286 |
| File-level, mined issues, Immich, MRR | 82 | 0.476 | 0.402 / 0.332 |
| File-level, mined issues, Twenty, MRR | 67 | 0.491 | 0.422 / 0.338 |
| File-level, commit subjects as queries, Immich, MRR | 258 | 0.456 | 0.436 / 0.357 |
| File-level, commit subjects as queries, Twenty, MRR | 802 | 0.427 | 0.384 / 0.304 |

Reason: the files that compete for a query are in the same feature area and are about equally active, and the most active files are central files that match many queries. The prior adds no discrimination where it is needed.

### 3.2 Commit titles as descriptions of the files they touched — rejected (not robust)

File score = code BM25 + 0.5 × similarity-weighted votes from the 50 most similar earlier commit subjects.

| Query set | n | Code-only MRR | + commit titles | W / L |
|---|---:|---:|---:|---|
| Mined issues, Immich | 82 | 0.476 | 0.602 | 42 / 17 |
| Mined issues, Twenty | 67 | 0.491 | 0.395 | 14 / 35 |
| Commit subjects, Immich | 258 | 0.456 | 0.544 | 114 / 56 |
| Commit subjects, Twenty | 802 | 0.427 | 0.459 | 292 / 261 |

It helps on the medium repository and hurts on real issue text at large scale, where it is most needed. Weights above 0.5 hurt on Twenty in both query sets.

### 3.3 File-level evidence added to declaration ranking — rejected

Whole-file BM25 looked strong on the mined issues (file Recall@10 0.58 on Twenty). On the frozen dev tasks it equals declaration-level BM25 exactly (Twenty file Recall@10 0.374 for both), and adding a file score to the stored top 50 gave no consistent change (Immich hybrid 0.457 → 0.493 → 0.473 as the weight rises; Twenty 0.021 → 0.037). The mined-issue number came from easier text, not from the granularity.

### 3.4 Seed selection and propagation settings — rejected

Dev failure analysis showed weak seeds on Twenty: test files, several constants of one file, keyword noise. Variants: order seeds by the ranking prior, cap seeds per file, require a graph node, graph weight 0.5, depth 1 or 2.

| Variant | Dev (23) ΔRecall@10 | W/L | Development set (127) ΔRecall@10 | W/L | p |
|---|---:|---|---:|---|---:|
| no graph | −0.047 | 2/4 | −0.075 | 12/24 | 0.010 |
| seeds ordered by prior | +0.023 | 3/2 | +0.005 | 9/11 | 0.82 |
| ≤ 2 seeds per file | −0.037 | 2/1 | +0.005 | 4/4 | 0.75 |
| ≤ 1 seed per file | +0.042 | 3/1 | −0.011 | 8/11 | 0.64 |
| graph weight 0.5 | +0.044 | 3/2 | +0.014 | 10/6 | 0.46 |
| depth 2 | +0.050 | 3/0 | +0.015 | 2/1 | 0.49 |
| depth 1 | +0.008 | 3/4 | −0.016 | 8/13 | 0.44 |

Nothing separates from zero on 127 queries. The frozen settings are a flat optimum for these knobs.

### 3.5 Graph-context embeddings — rejected

Each declaration was embedded with a header naming its route, events and nearest callers and callees (2,508 of 5,764 Immich chunks have such context). On the 67 Immich development queries: Recall@10 0.750 with or without the header (0 wins / 0 losses); without graph propagation 0.666 against 0.671. Root-cause MRR −0.010 (2 wins / 7 losses). Not extended to Twenty.

### 3.6 Cross-encoder reranking — pre-registered test failed

`protocol.md` was committed (8c1fdfc) before any reranker output existed for a test task. Method: top 50 of the frozen hybrid, `Qwen/Qwen3-Reranker-0.6B`, reciprocal-rank fusion with the hybrid order (k = 10).

| Set | n | hybrid | reranked | Δ Recall@10 | 95% CI | W/L | one-sided p |
|---|---:|---:|---:|---:|---|---|---:|
| Development set | 127 | 0.652 | 0.692 | +0.040 | [−0.000, +0.082] | 20/9 | 0.033 |
| Frozen dev | 23 | 0.420 | 0.477 | +0.058 | [−0.023, +0.164] | 7/3 | 0.16 |
| **Held-out test (confirmatory)** | **58** | **0.477** | **0.482** | **+0.005** | **[−0.035, +0.045]** | **10/8** | **0.40** |

Held-out detail (descriptive): S 0.667 → 0.643; M bug 0.633 → 0.633; M understanding 0.265 → 0.299; L bug 0.286 → 0.286; L understanding 0.355 → 0.380. Reciprocal rank of the first root-cause or anchor symbol rose 0.305 → 0.359 (21 wins / 9 losses, two-sided p = 0.066; exploratory). The reranker's own order is worse than hybrid (0.447). Cost: 2.35 s per query on an RTX 3060. A general-text cross-encoder (`bge-reranker-base`) lowered dev Recall@10 by 0.10.

The development set overstated the effect. Its two biases (fix present in the code, reports that state the fix) favour a model that reads candidate bodies closely.

## 4. What was implemented

### 4.1 Query-time speed fixes in the product path (integrated)

| Change | File |
|---|---|
| Evidence lines indexed by owning declaration on first use, instead of scanning every edge once per rendered result | `src/retrieval/graph-engine.ts` |
| Graph ids of the ranked symbols computed once per query, instead of inside every sort comparison | `src/retrieval/compact-context.ts` |
| Chunk lookup table built once per index, instead of per query | `src/retrieval/hybrid-retrieval.ts` |

Measured on this machine, tasks on the pinned snapshot, same process for both methods:

| Repository | Method | Before | After | Byte-identical to stored output |
|---|---|---:|---:|---|
| Immich (63k lines) | agent tool (`compact_graph`) | 730 ms | 54 ms | 15/15 |
| Immich | hybrid | 595 ms | 46 ms | 15/15 |
| Twenty (763k lines) | agent tool (`compact_graph`) | 13,260 ms (stored) | 289 ms | 14/14 |
| Twenty | hybrid | 12,273 ms (stored) | 287 ms | 14/14 |
| nestjs-boilerplate | 5 methods × 20 tasks (stage-1 runner) | 60–83 ms (stored) | 11–48 ms | 100/100 |

"Before" was re-measured on Immich (730 ms against 665 ms stored). On Twenty the stored stage-1 latencies of the same 14 tasks are used; the old code was not re-run there. Peak memory of the product path on Twenty was 3.6 GB after the change; it was not measured before, and the change does not target memory.

Tests: 250 existing tests pass; 2 new tests (`tests/graph/retrieval-speed.test.ts`) compare the indexed evidence lines with the original scan for every declaration of the fixture and pin the neighbour order.

Expected agent effect, not measured: in the Twenty head-to-head, runs with TypeTrace took 72 s against 58 s for grep only, with 1.3 retrieval calls per run. About 17 s of that was tool latency and is now under half a second.

### 4.2 Lean ranking engine (experiment harness, not integrated)

`scripts/exp6/lean.ts`: typed-array adjacency, inverted-index BM25, graph rows read column by column from SQLite, no snippet rendering.

| Repository | Tasks | Ranking identical to stored hybrid | Median query | Stored hybrid query |
|---|---:|---:|---:|---:|
| S | 20 | 20 | 4 ms | 84 ms |
| M | 37 | 37 | 23 ms | 589 ms |
| L | 24 | 24 | 163 ms | 11,959 ms |

Process memory on Twenty is 2.2 GB against 6.1 GB for the stage-1 evaluation process. It ranks only; the product's pointer rendering still uses the original graph objects.

## 5. Is the improvement meaningful?

- **Accuracy:** none demonstrated. The held-out test of the only promising candidate has a CI of [−0.035, +0.045]; an effect of practical size (≥ +0.05) is unlikely.
- **Latency:** yes. It is a 13–46× reduction with identical output, verified byte for byte, on the path every agent call takes.
- **Power:** 58 held-out tasks detect only effects of about ±0.05 or more. On the 23 dev tasks alone, several variants showed +0.04 to +0.07 that shrank to about +0.01 on 127 queries. The development set is biased (§2), so it can reject ideas but cannot confirm them, as the reranker showed.

## 6. Should the architecture change?

- **Ranking: no.** Keep the frozen hybrid. Do not add change history, commit-title text, file-level scores, graph-context embeddings or a reranker.
- **Keep the speed fixes.** They change no output.
- **Worth doing next, in this order:**
  1. More audited held-out tasks before any further ranking work. Ranking changes of plausible size cannot be confirmed on 58.
  2. The navigation operation deferred in `03-graph-scale/retrieval-architecture.md` §3.2. Agent runs average 23 tool calls per task with 1.3 retrieval calls in every arm, so the tool changes one step of a 25-step session. Exact "who calls this / what handles this" lookups address the other 22. This needs an approved agent run.
  3. Moving the product onto the lean structures, if the 3.6 GB on large repositories matters. Ranking equivalence is already shown; the pointer renderer would have to be ported and checked the same way.

## 7. Reproduce (no model calls except the local reranker)

```bash
npx tsx scripts/exp6/run.ts --repo S|M|L --split all --out .cache/exp6/check-<repo> --variants frozen,nograph   # lean engine vs stored output
npx tsx scripts/exp6/run.ts --repo M|L --split all --silver --out .cache/exp6/silver1-<repo> --dump frozen     # development-only set
npx tsx scripts/exp6/run.ts --repo S|M|L --split test --out .cache/exp6/test-<repo> --variants frozen --dump frozen
vendor/.venvs/embeddings/bin/python scripts/exp6/rerank.py --model Qwen/Qwen3-Reranker-0.6B --max-len 1024 --batch 8 --cands <cands files> --out <scores.jsonl>
python3 scripts/exp6/rerank_eval.py --cands <cands files> --scores <scores.jsonl> --confirm
npx tsx scripts/exp6/bench-product.ts --repo M|L --out <file.json>                                             # product path latency + byte identity
python3 scripts/exp6/history/prior_sim.py .cache/exp6/history/twenty-log.txt packages/twenty-server/src/ 365    # history replay (log commands in hist_lib.py)
python3 scripts/exp6/collect.py                                                                                 # results/summary.json
```

Results: `results/summary.json`, `results/rerank-{dev,silver,test}.json`. Candidate dumps and raw rows contain AGPL code or file paths and stay under `.cache/exp6/`.
