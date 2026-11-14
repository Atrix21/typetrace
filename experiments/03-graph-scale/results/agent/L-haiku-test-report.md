# Experiment 3 agent stage: L-haiku-test

Runs: 162 from `main-L-haiku`; tasks 18; arms ['A0', 'A1', 'A2']; models ['claude-haiku-5-5']. Unit = task (repeats averaged). No LLM judge.


## all tasks: 18 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.867 | 598151 | 0.0256 | 27.5 | 25.3 | 0.0 | 0.00 | 13.2 | 56 | 0.41 |
| A1 | 0.830 | 518391 | 0.0211 | 27.5 | 25.3 | 1.1 | 1.00 | 12.3 | 53 | 0.42 |
| A2 | 0.851 | 545734 | 0.0225 | 26.4 | 24.5 | 1.3 | 1.00 | 11.7 | 79 | 0.41 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 18 | +0.021 | [-0.014, +0.069] | 5/5/8 | 0.218 |
| log(A1/A2) total_tokens | total_tokens | 18 | +0.077 | [-0.048, +0.211] | 10/8/0 | 0.135 |
| log(A1/A2) cost_usd | cost_usd | 18 | +0.009 | [-0.080, +0.094] | 9/9/0 | 0.428 |
| A2 − A0 | task_score | 18 | -0.016 | [-0.066, +0.031] | 2/8/8 | 0.743 |
| log(A0/A2) total_tokens | total_tokens | 18 | +0.202 | [+0.101, +0.304] | 15/3/0 | 0.001 |
| log(A0/A2) cost_usd | cost_usd | 18 | +0.142 | [+0.063, +0.224] | 16/2/0 | 0.001 |
| A1 − A0 | task_score | 18 | -0.037 | [-0.098, +0.013] | 3/6/9 | 0.885 |
| log(A0/A1) total_tokens | total_tokens | 18 | +0.125 | [-0.017, +0.260] | 11/7/0 | 0.051 |
| log(A0/A1) cost_usd | cost_usd | 18 | +0.133 | [+0.014, +0.254] | 11/7/0 | 0.025 |

## bug localisation (A): 7 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.905 | 764823 | 0.0298 | 28.1 | 26.2 | 0.0 | 0.00 | 11.7 | 62 | 0.15 |
| A1 | 0.810 | 717267 | 0.0259 | 29.4 | 27.4 | 1.3 | 1.00 | 12.1 | 65 | 0.18 |
| A2 | 0.857 | 786680 | 0.0288 | 28.9 | 27.6 | 1.6 | 1.00 | 11.2 | 107 | 0.16 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 7 | +0.048 | [+0.000, +0.143] | 1/0/6 | 0.500 |
| log(A1/A2) total_tokens | total_tokens | 7 | +0.101 | [-0.122, +0.302] | 5/2/0 | 0.219 |
| log(A1/A2) cost_usd | cost_usd | 7 | +0.034 | [-0.161, +0.197] | 5/2/0 | 0.398 |
| A2 − A0 | task_score | 7 | -0.048 | [-0.143, +0.000] | 0/1/6 | 1.000 |
| log(A0/A2) total_tokens | total_tokens | 7 | +0.089 | [-0.044, +0.226] | 5/2/0 | 0.125 |
| log(A0/A2) cost_usd | cost_usd | 7 | +0.032 | [-0.078, +0.118] | 5/2/0 | 0.297 |
| A1 − A0 | task_score | 7 | -0.095 | [-0.190, +0.000] | 0/2/5 | 1.000 |
| log(A0/A1) total_tokens | total_tokens | 7 | -0.012 | [-0.227, +0.188] | 3/4/0 | 0.539 |
| log(A0/A1) cost_usd | cost_usd | 7 | -0.002 | [-0.178, +0.227] | 3/4/0 | 0.508 |

## understanding (B–E): 11 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.843 | 492087 | 0.0229 | 27.1 | 24.8 | 0.0 | 0.00 | 14.2 | 52 | 0.57 |
| A1 | 0.843 | 391833 | 0.0181 | 26.3 | 23.9 | 1.0 | 1.00 | 12.3 | 46 | 0.57 |
| A2 | 0.847 | 392405 | 0.0185 | 24.8 | 22.5 | 1.1 | 1.00 | 12.0 | 61 | 0.58 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 11 | +0.004 | [-0.031, +0.042] | 4/5/2 | 0.432 |
| log(A1/A2) total_tokens | total_tokens | 11 | +0.062 | [-0.082, +0.236] | 5/6/0 | 0.251 |
| log(A1/A2) cost_usd | cost_usd | 11 | -0.007 | [-0.080, +0.076] | 4/7/0 | 0.565 |
| A2 − A0 | task_score | 11 | +0.003 | [-0.038, +0.063] | 2/7/2 | 0.480 |
| log(A0/A2) total_tokens | total_tokens | 11 | +0.274 | [+0.151, +0.399] | 10/1/0 | 0.001 |
| log(A0/A2) cost_usd | cost_usd | 11 | +0.211 | [+0.126, +0.311] | 11/0/0 | 0.000 |
| A1 − A0 | task_score | 11 | -0.000 | [-0.043, +0.043] | 3/4/4 | 0.516 |
| log(A0/A1) total_tokens | total_tokens | 11 | +0.212 | [+0.049, +0.372] | 8/3/0 | 0.019 |
| log(A0/A1) cost_usd | cost_usd | 11 | +0.219 | [+0.095, +0.339] | 8/3/0 | 0.005 |

## Confirmatory family (Amendment C; Holm over H4, H4u, H3)

| ID | Contrast | mean | 95% CI | p | Holm |
|---|---|---:|---|---:|---:|
| H4 | task score A2 − A1 (all) | +0.021 | [-0.014, +0.069] | 0.218 | 0.436 |
| H4u | task score A2 − A1 (B–E) | +0.004 | [-0.031, +0.042] | 0.432 | 0.436 |
| H3 | log(tokens A0 / tokens A2) | +0.202 | [+0.101, +0.304] | 0.001 | 0.002 |

Non-inferiority (H3 companion): task score A2 − A0 one-sided 95% lower bound = -0.057 (margin −0.05: NOT met).
