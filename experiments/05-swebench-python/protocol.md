# Experiment 05: Python retrieval head-to-head on SWE-bench Lite (pre-registered)

Written and committed on 2026-11-15, before the runner was executed on any instance and before any retrieval output existed.

## Why this benchmark

Every earlier code benchmark in this repository is TypeScript, which is TypeTrace's home ground: it was built around the TypeScript compiler. This experiment moves to ground that none of the compared tools chose:
- **Python** is graphify's and code-review-graph's best-supported language.
- **[SWE-bench Lite](https://www.swebench.com/)** is a public, widely used benchmark: 300 real GitHub issues from 12 Python repositories.
- **Tool-independent ground truth:** it comes from the merged gold patches.

## Data

- **Dataset:** `princeton-nlp/SWE-bench_Lite`, test split, all 300 instances (SHA-256 of the fetched JSON recorded in `FROZEN.json`).
- **Query:** the `problem_statement`, verbatim.
- **Snapshot:** the repository at `base_commit`. The corpus is every `.py` file, tests included: every method indexes the same files, as an agent would see them.
- **Ground truth:** the declarations changed by the gold `patch` (never the `test_patch`). Changed and deleted lines on the old side, and insertion points, map to the innermost enclosing declaration (`function`, `Class.method`, or a `class` body) at `base_commit`. Module-level edits (typically imports added beside a fix) count as the file's `<module>` symbol only when the patch changes no declaration in that file. This rule was settled before any method ran, after a dry run of the ground-truth derivation. The mapping uses only the syntactic declaration index (tree-sitter); no retrieval method is involved. Instances whose patch touches no `.py` file are excluded and counted.

## Methods (same budget: 50 results / 8k tokens; no model calls)

| Method | What it is |
|---|---|
| `bm25`, `embeddings`, `hybrid_nograph` | our search stack without the graph (Qwen3-Embedding-0.6B, PyTorch backend, as in experiment 3) |
| `hybrid`, `compact_graph` | TypeTrace: the same stack plus the Python call/import/inheritance graph (`src/languages/python.ts`) |
| `custom_graph` | the graph-only ranker |
| `graphify` | graphify 0.9.108, its own `query` |
| `code_review_graph`, `code_review_graph_emb` | code-review-graph 2.4.0, default (FTS) and with its local embeddings |

Competitors index exactly the instance snapshot's corpus files (`neutralCopy`).

## Outcomes and tests

- **Primary:** symbol Recall@10.
- **Secondary:** root-cause MRR, file Recall@10, file hit@1/5 (comparable with published file-level SWE-bench localisation numbers), output tokens, latency, index time.
- **Unit:** the instance. Results are reported overall and per repository.
- **Confirmatory family (Holm, one-sided, paired sign-flip permutation):**
  - **P1:** Recall@10 of `hybrid` > `graphify`.
  - **P2:** Recall@10 of `hybrid` > `code_review_graph_emb`.
  - **P3:** Recall@10 of `hybrid` > `hybrid_nograph` (does the Python graph help?).
- **Exploratory:** everything else.

A loss is reported as a loss. The Python extractor will not be tuned on these 300 instances: any change made after results are seen is logged, and the earlier numbers are kept.
