# Experiment 08: retrieval head-to-head on SWE-bench Multilingual (pre-registered)

Written before the runner was executed with any retrieval method. The only step run beforehand was a dry run of the
ground-truth derivation (no method involved; counts below). The run itself waits for the owner's approval: it is long
(41 repositories, several of them large) and the machine runs one heavy job at a time.

## Why this benchmark

TypeTrace's retrieval has been benchmarked on TypeScript (experiment 3) and Python (experiment 5). Its other languages
have only a graph-quality check (experiment 7). [SWE-bench Multilingual](https://www.swebench.com/multilingual.html)
gives 300 real GitHub issues from 41 repositories in Java, Rust, Go, PHP, Ruby, C, C++, JavaScript and TypeScript.
Its ground truth comes from the merged gold patches, so it is independent of every tool, and both compared tools
support all of these languages.

## Data

- **Dataset:** `SWE-bench/SWE-bench_Multilingual`, test split, all 300 instances (SHA-256 of the fetched JSON in
  `FROZEN.json`).
- **Query:** the `problem_statement`, verbatim.
- **Snapshot:** the repository at `base_commit`.
- **Corpus:** the product's own file selection (`src/product/source-files.ts`): every file in a supported language,
  tests included; build output, dependencies, vendored and generated code, and files over 1 MB excluded. Every method
  indexes exactly these files (competitors through `neutralCopy`, as in experiments 3 and 5).
- **Ground truth:** the declarations changed by the gold `patch` (never the `test_patch`), by the experiment 5 rule.
  Changed and deleted lines on the old side, and insertion points, map to the innermost enclosing declaration at
  `base_commit`. Module-level edits count as the file's `<module>` symbol only when the patch changes no declaration
  in that file. Only corpus files count. The mapping uses only the syntactic declaration index (tree-sitter; the
  TypeScript parser for TypeScript and JavaScript), and no retrieval method is involved. Instances with an empty
  ground truth are excluded and counted.

## Methods (same budget: 50 results / 8k tokens; no model calls)

| Method | What it is |
|---|---|
| `bm25`, `embeddings`, `hybrid_nograph` | the search stack without the graph (Qwen3-Embedding-0.6B, PyTorch backend, as in experiments 3 and 5) |
| `hybrid`, `compact_graph` | TypeTrace: the same stack plus the graph (`buildGraph`: TypeScript compiler for TS/JS, `src/languages/syntactic.ts` for the rest) |
| `custom_graph` | the graph-only ranker |
| `graphify` | graphify 0.9.108, its own `query` |
| `code_review_graph`, `code_review_graph_emb` | code-review-graph 2.4.0, default (FTS) and with its local embeddings |

## Outcomes and tests

- **Primary:** symbol Recall@10.
- **Secondary:** root-cause MRR, file Recall@10, file hit@1/5, output tokens, latency, index time.
- **Unit:** the instance. Results are reported overall, per language of the ground truth, and per repository.
- **Confirmatory family (Holm, one-sided, paired sign-flip permutation as in experiments 3 and 5: exact up to 2^16 sign patterns, else 20,000 seeded random flips):**
  - **P1:** Recall@10 of `hybrid` > `graphify`.
  - **P2:** Recall@10 of `hybrid` > `code_review_graph_emb`.
  - **P3:** Recall@10 of `hybrid` > `hybrid_nograph` (does the graph help in these languages?).
- **Exploratory:** everything else, including the per-language splits.

## Disclosures

- The language front-ends were built and checked on 13 other repositories (experiment 7). Four of them are also
  SWE-bench Multilingual repositories: gin, gson, jq and ripgrep. They were checked at their current commits, for graph
  edge precision only, and no issue or patch from this dataset was looked at.
- The ranking was tuned on TypeScript (experiments 1 to 3) and is not re-tuned here.
- **Code freeze:** the commit that adds this protocol. Any code change after results are seen is logged in the
  decision log, and the earlier numbers are kept. A loss is reported as a loss.

## Ground-truth dry run (before any method ran)

`scripts/swebench/multilingual.ts --gt-only` ran on all 300 instances, with ground truth only and no method:

- **Included:** 299. **Excluded:** 1 (`gohugoio__hugo-12204`: the gold patch changes only an HTML template).
- **Language of the ground truth:**

  | Ruby | Java | Rust | PHP | Go | JavaScript | C | TypeScript | C++ | mixed |
  |---|---|---|---|---|---|---|---|---|---|
  | 44 | 43 | 43 | 43 | 39 | 29 | 28 | 13 | 12 | 5 |

- **Ground truth per instance:** 2.24 declarations on average. 11 instances have module-level ground truth only.
- **Corpus sizes:** largest are babel/babel (18,812 files, mostly test fixtures), apache/druid (8,708), apache/lucene (5,669) and
  astral-sh/ruff (3,962). In total, 451,414 corpus files across the 299 instances. Embeddings are cached by content per
  repository, as in experiment 5.
