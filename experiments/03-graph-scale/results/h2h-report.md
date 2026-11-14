# Retrieval head-to-head (Amendment D2): ours vs graphify vs code-review-graph

Same tasks, snapshots, budget (50 results / 8k tokens) and scoring for every method; no model calls. Symbol-level metrics against frozen ground truth. Paired differences are ours − competitor over tasks (95% bootstrap CI; one-sided sign-flip p for ours > competitor).


## S: 20 tasks

| Method | Recall@10 | Recall@5 | RC MRR | RC hit@10 | File R@10 | Recall (own output) | own output tokens | latency ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ours: hybrid (BM25 + embeddings + graph) | 0.69 | 0.53 | 0.45 | 0.75 | 0.81 | 0.89 | 6,421 | 84 |
| ours: compact_graph (the agent tool) | 0.65 | 0.53 | 0.44 | 0.75 | 0.77 | 0.76 | 747 | 93 |
| ours: graph only | 0.67 | 0.54 | 0.38 | 0.65 | 0.78 | 0.85 | 5,808 | 78 |
| ours: hybrid without graph | 0.44 | 0.31 | 0.19 | 0.40 | 0.65 | 0.78 | 7,252 | 64 |
| BM25 | 0.43 | 0.25 | 0.24 | 0.50 | 0.62 | 0.70 | 7,249 | 11 |
| embeddings (Qwen3-0.6B) | 0.51 | 0.30 | 0.32 | 0.60 | 0.73 | 0.74 | 5,814 | 60 |
| ripgrep | 0.31 | 0.20 | 0.17 | 0.45 | 0.61 | 0.50 | 3,837 | 65 |
| graphify 0.9.108 | 0.12 | 0.08 | 0.04 | 0.05 | 0.50 | 0.42 | 8,680 | 201 |
| code-review-graph 2.4.0 (default, FTS) | 0.18 | 0.10 | 0.04 | 0.10 | 0.56 | 0.40 | 4,702 | 13 |
| code-review-graph 2.4.0 + embeddings | 0.31 | 0.15 | 0.07 | 0.20 | 0.65 | 0.56 | 4,784 | 26 |

| Ours | vs | metric | mean Δ | 95% CI | W/L/T | p |
|---|---|---|---:|---|---|---:|
| hybrid | graphify 0.9.108 | sym_recall_10 | +0.567 | [+0.450, +0.683] | 20/0/0 | 0.0000 |
| hybrid | graphify 0.9.108 | rc_mrr | +0.413 | [+0.240, +0.590] | 19/1/0 | 0.0003 |
| hybrid | code-review-graph 2.4.0 (default, FTS) | sym_recall_10 | +0.512 | [+0.379, +0.650] | 18/0/2 | 0.0000 |
| hybrid | code-review-graph 2.4.0 (default, FTS) | rc_mrr | +0.412 | [+0.262, +0.577] | 20/0/0 | 0.0000 |
| hybrid | code-review-graph 2.4.0 + embeddings | sym_recall_10 | +0.379 | [+0.250, +0.521] | 16/0/4 | 0.0000 |
| hybrid | code-review-graph 2.4.0 + embeddings | rc_mrr | +0.385 | [+0.233, +0.547] | 18/2/0 | 0.0001 |
| compact_graph | graphify 0.9.108 | sym_recall_10 | +0.525 | [+0.412, +0.642] | 19/0/1 | 0.0001 |
| compact_graph | graphify 0.9.108 | rc_mrr | +0.402 | [+0.224, +0.584] | 14/2/4 | 0.0005 |
| compact_graph | code-review-graph 2.4.0 (default, FTS) | sym_recall_10 | +0.471 | [+0.342, +0.604] | 18/0/2 | 0.0000 |
| compact_graph | code-review-graph 2.4.0 (default, FTS) | rc_mrr | +0.400 | [+0.245, +0.569] | 15/0/5 | 0.0001 |
| compact_graph | code-review-graph 2.4.0 + embeddings | sym_recall_10 | +0.338 | [+0.208, +0.483] | 15/0/5 | 0.0001 |
| compact_graph | code-review-graph 2.4.0 + embeddings | rc_mrr | +0.373 | [+0.217, +0.540] | 14/2/4 | 0.0001 |

## M: 26 tasks (test split)

| Method | Recall@10 | Recall@5 | RC MRR | RC hit@10 | File R@10 | Recall (own output) | own output tokens | latency ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ours: hybrid (BM25 + embeddings + graph) | 0.48 | 0.35 | 0.30 | 0.50 | 0.75 | 0.62 | 7,820 | 589 |
| ours: compact_graph (the agent tool) | 0.39 | 0.35 | 0.29 | 0.42 | 0.73 | 0.50 | 756 | 717 |
| ours: graph only | 0.35 | 0.23 | 0.14 | 0.38 | 0.60 | 0.49 | 7,249 | 1,091 |
| ours: hybrid without graph | 0.43 | 0.35 | 0.19 | 0.50 | 0.69 | 0.57 | 7,724 | 36 |
| BM25 | 0.37 | 0.26 | 0.20 | 0.46 | 0.55 | 0.40 | 7,530 | 17 |
| embeddings (Qwen3-0.6B) | 0.47 | 0.34 | 0.25 | 0.50 | 0.71 | 0.61 | 7,595 | 25 |
| ripgrep | 0.18 | 0.13 | 0.11 | 0.23 | 0.45 | 0.23 | 5,892 | 92 |
| graphify 0.9.108 | 0.04 | 0.00 | 0.01 | 0.04 | 0.20 | 0.15 | 8,761 | 595 |
| code-review-graph 2.4.0 (default, FTS) | 0.03 | 0.01 | 0.01 | 0.08 | 0.18 | 0.04 | 4,024 | 23 |
| code-review-graph 2.4.0 + embeddings | 0.26 | 0.19 | 0.14 | 0.35 | 0.47 | 0.35 | 5,524 | 52 |

| Ours | vs | metric | mean Δ | 95% CI | W/L/T | p |
|---|---|---|---:|---|---|---:|
| hybrid | graphify 0.9.108 | sym_recall_10 | +0.435 | [+0.281, +0.593] | 19/0/7 | 0.0000 |
| hybrid | graphify 0.9.108 | rc_mrr | +0.295 | [+0.163, +0.442] | 18/0/8 | 0.0000 |
| hybrid | code-review-graph 2.4.0 (default, FTS) | sym_recall_10 | +0.447 | [+0.284, +0.617] | 19/0/7 | 0.0000 |
| hybrid | code-review-graph 2.4.0 (default, FTS) | rc_mrr | +0.293 | [+0.154, +0.448] | 17/1/8 | 0.0000 |
| hybrid | code-review-graph 2.4.0 + embeddings | sym_recall_10 | +0.213 | [+0.013, +0.412] | 15/3/8 | 0.0251 |
| hybrid | code-review-graph 2.4.0 + embeddings | rc_mrr | +0.163 | [+0.017, +0.321] | 12/7/7 | 0.0254 |
| compact_graph | graphify 0.9.108 | sym_recall_10 | +0.345 | [+0.201, +0.499] | 17/0/9 | 0.0000 |
| compact_graph | graphify 0.9.108 | rc_mrr | +0.283 | [+0.148, +0.433] | 15/0/11 | 0.0001 |
| compact_graph | code-review-graph 2.4.0 (default, FTS) | sym_recall_10 | +0.357 | [+0.201, +0.526] | 17/0/9 | 0.0000 |
| compact_graph | code-review-graph 2.4.0 (default, FTS) | rc_mrr | +0.280 | [+0.138, +0.439] | 15/1/10 | 0.0002 |
| compact_graph | code-review-graph 2.4.0 + embeddings | sym_recall_10 | +0.123 | [-0.073, +0.320] | 13/4/9 | 0.1217 |
| compact_graph | code-review-graph 2.4.0 + embeddings | rc_mrr | +0.150 | [+0.002, +0.312] | 12/7/7 | 0.0383 |

## L: 18 tasks (test split)

| Method | Recall@10 | Recall@5 | RC MRR | RC hit@10 | File R@10 | Recall (own output) | own output tokens | latency ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ours: hybrid (BM25 + embeddings + graph) | 0.33 | 0.23 | 0.23 | 0.33 | 0.41 | 0.51 | 7,866 | 11,959 |
| ours: compact_graph (the agent tool) | 0.28 | 0.22 | 0.22 | 0.33 | 0.42 | 0.37 | 713 | 12,932 |
| ours: graph only | 0.22 | 0.18 | 0.11 | 0.17 | 0.28 | 0.52 | 7,589 | 18,094 |
| ours: hybrid without graph | 0.17 | 0.15 | 0.09 | 0.17 | 0.39 | 0.32 | 7,669 | 293 |
| BM25 | 0.19 | 0.07 | 0.06 | 0.11 | 0.29 | 0.22 | 7,580 | 132 |
| embeddings (Qwen3-0.6B) | 0.19 | 0.17 | 0.15 | 0.17 | 0.34 | 0.37 | 7,551 | 4,965 |
| ripgrep | 0.03 | 0.00 | 0.01 | 0.06 | 0.11 | 0.14 | 6,880 | 1,174 |
| graphify 0.9.108 | 0.01 | 0.01 | 0.00 | 0.00 | 0.06 | 0.03 | 5,459 | 6,319 |
| code-review-graph 2.4.0 (default, FTS) | 0.01 | 0.00 | 0.00 | 0.00 | 0.05 | 0.02 | 4,952 | 310 |
| code-review-graph 2.4.0 + embeddings | 0.10 | 0.08 | 0.02 | 0.06 | 0.21 | 0.17 | 6,885 | 345 |

| Ours | vs | metric | mean Δ | 95% CI | W/L/T | p |
|---|---|---|---:|---|---|---:|
| hybrid | graphify 0.9.108 | sym_recall_10 | +0.316 | [+0.198, +0.441] | 14/0/4 | 0.0000 |
| hybrid | graphify 0.9.108 | rc_mrr | +0.227 | [+0.071, +0.413] | 8/0/10 | 0.0032 |
| hybrid | code-review-graph 2.4.0 (default, FTS) | sym_recall_10 | +0.322 | [+0.204, +0.446] | 14/0/4 | 0.0000 |
| hybrid | code-review-graph 2.4.0 (default, FTS) | rc_mrr | +0.229 | [+0.073, +0.415] | 8/0/10 | 0.0032 |
| hybrid | code-review-graph 2.4.0 + embeddings | sym_recall_10 | +0.227 | [+0.134, +0.324] | 12/0/6 | 0.0001 |
| hybrid | code-review-graph 2.4.0 + embeddings | rc_mrr | +0.212 | [+0.068, +0.382] | 8/0/10 | 0.0032 |
| compact_graph | graphify 0.9.108 | sym_recall_10 | +0.272 | [+0.167, +0.392] | 13/0/5 | 0.0001 |
| compact_graph | graphify 0.9.108 | rc_mrr | +0.219 | [+0.061, +0.407] | 6/0/12 | 0.0148 |
| compact_graph | code-review-graph 2.4.0 (default, FTS) | sym_recall_10 | +0.278 | [+0.171, +0.398] | 13/0/5 | 0.0001 |
| compact_graph | code-review-graph 2.4.0 (default, FTS) | rc_mrr | +0.220 | [+0.062, +0.407] | 6/0/12 | 0.0148 |
| compact_graph | code-review-graph 2.4.0 + embeddings | sym_recall_10 | +0.184 | [+0.104, +0.267] | 11/0/7 | 0.0005 |
| compact_graph | code-review-graph 2.4.0 + embeddings | rc_mrr | +0.204 | [+0.056, +0.375] | 6/0/12 | 0.0148 |
