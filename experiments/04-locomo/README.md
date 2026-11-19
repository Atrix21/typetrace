# Experiment 04: LOCOMO (conversational memory, search components only)

**Why.** graphify reports "0.497 recall@10" on [LOCOMO](https://github.com/snap-research/locomo) (Maharana et al.,
ACL 2024), a benchmark of very long chat conversations. Its harness is not public. LOCOMO contains no code, so it
cannot test a code graph. It only shows how the search components behave on a public retrieval benchmark.

**Protocol (open).** The protocol is identical to an
[independent public replication](https://github.com/devkancheti4-design/model-d-graphify) (`bench/locomo_eval.py`),
whose BM25 score of 0.540 is reproduced exactly here.
- Questions in categories 1–4 that have at least one evidence turn: 1,536 questions. Category 5 is adversarial and
  has no answer in the conversation.
- The retrieval unit is one dialogue turn, with one index per conversation.
- Recall@10 is the share of evidence turns in the top 10, averaged over questions. A seeded sample of 300 questions is
  also reported.

**Methods.** No LLM is used anywhere.

| Method | What it is | Recall@10 (1,536) | Recall@10 (seeded 300) |
|---|---|---:|---:|
| `bm25` | k1 = 1.5, b = 0.75 | 0.540 | 0.566 |
| `dense` | Qwen3-Embedding-0.6B (TypeTrace's embedding model), cosine | 0.637 | 0.642 |
| `hybrid` | reciprocal-rank fusion (k = 60) of BM25 and dense, top 100 each | 0.635 | 0.662 |
| `hybrid_rr` | `hybrid` top 50, re-ranked by the bge-reranker-base cross-encoder | **0.745** | **0.753** |

By category (1,536 questions), `hybrid_rr` scores 0.52, 0.80, 0.41 and 0.84 on categories 1 to 4; per-question scores
are in `locomo-per-question.jsonl`.

**What this does and does not show.**
- **Not TypeTrace's ranking.** TypeTrace's own ranking (exact symbols, BM25, embeddings, graph facts and graph
  propagation) needs code. This experiment uses generic fusion with TypeTrace's embedding model.
- **The reranker is not in TypeTrace.** On code it failed its pre-registered held-out test
  ([experiment 6](../06-next-direction/findings.md)), so the product does not ship it.
- **Not a like-for-like comparison with graphify's 0.497.** graphify's harness is not public, and its BM25 scores 0.362
  there, against 0.540 on this protocol, so the two setups differ.

**Reproduce.**

```bash
bash scripts/locomo/get.sh   # fetches locomo10.json (not redistributed)
vendor/.venvs/embeddings/bin/python -I scripts/locomo/eval.py --data .cache/locomo/locomo10.json --out experiments/04-locomo
```

Outputs: `locomo-recall.json` (summary) and `locomo-per-question.jsonl`.
