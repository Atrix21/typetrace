# Experiment 3 agent stage: M-haiku-test

Runs: 156 from `main-M-haiku`; tasks 26; arms ['A0', 'A1', 'A2']; models ['claude-haiku-5-5']. Unit = task (repeats averaged). No LLM judge.


## all tasks: 26 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.842 | 231334 | 0.0127 | 18.1 | 16.1 | 0.0 | 0.00 | 5.9 | 48 | 0.41 |
| A1 | 0.806 | 165498 | 0.0114 | 17.3 | 15.2 | 1.1 | 1.00 | 5.7 | 42 | 0.40 |
| A2 | 0.848 | 199232 | 0.0142 | 17.3 | 15.2 | 1.0 | 1.00 | 5.8 | 46 | 0.41 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 26 | +0.042 | [-0.036, +0.140] | 5/3/18 | 0.222 |
| log(A1/A2) total_tokens | total_tokens | 26 | -0.080 | [-0.217, +0.052] | 11/15/0 | 0.866 |
| log(A1/A2) cost_usd | cost_usd | 26 | -0.040 | [-0.126, +0.043] | 12/14/0 | 0.809 |
| A2 − A0 | task_score | 26 | +0.007 | [-0.071, +0.081] | 6/5/15 | 0.403 |
| log(A0/A2) total_tokens | total_tokens | 26 | +0.325 | [+0.181, +0.470] | 23/3/0 | 0.000 |
| log(A0/A2) cost_usd | cost_usd | 26 | +0.194 | [+0.066, +0.299] | 23/3/0 | 0.001 |
| A1 − A0 | task_score | 26 | -0.035 | [-0.110, +0.035] | 4/5/17 | 0.818 |
| log(A0/A1) total_tokens | total_tokens | 26 | +0.405 | [+0.251, +0.559] | 22/4/0 | 0.000 |
| log(A0/A1) cost_usd | cost_usd | 26 | +0.234 | [+0.131, +0.327] | 21/5/0 | 0.000 |

## bug localisation (A): 15 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.867 | 246854 | 0.0138 | 16.4 | 14.3 | 0.0 | 0.00 | 4.8 | 57 | 0.22 |
| A1 | 0.833 | 164103 | 0.0128 | 15.2 | 13.2 | 1.0 | 1.00 | 4.5 | 49 | 0.21 |
| A2 | 0.900 | 230760 | 0.0179 | 15.5 | 13.4 | 1.0 | 1.00 | 4.8 | 57 | 0.22 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 15 | +0.067 | [+0.000, +0.200] | 1/0/14 | 0.500 |
| log(A1/A2) total_tokens | total_tokens | 15 | -0.190 | [-0.381, -0.003] | 5/10/0 | 0.958 |
| log(A1/A2) cost_usd | cost_usd | 15 | -0.105 | [-0.232, +0.016] | 5/10/0 | 0.932 |
| A2 − A0 | task_score | 15 | +0.033 | [-0.067, +0.133] | 2/1/12 | 0.500 |
| log(A0/A2) total_tokens | total_tokens | 15 | +0.303 | [+0.078, +0.537] | 12/3/0 | 0.012 |
| log(A0/A2) cost_usd | cost_usd | 15 | +0.172 | [-0.039, +0.351] | 12/3/0 | 0.063 |
| A1 − A0 | task_score | 15 | -0.033 | [-0.133, +0.067] | 1/2/12 | 0.875 |
| log(A0/A1) total_tokens | total_tokens | 15 | +0.493 | [+0.265, +0.727] | 13/2/0 | 0.001 |
| log(A0/A1) cost_usd | cost_usd | 15 | +0.277 | [+0.118, +0.422] | 12/3/0 | 0.003 |

## understanding (B–E): 11 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.808 | 210171 | 0.0112 | 20.5 | 18.5 | 0.0 | 0.00 | 7.4 | 35 | 0.67 |
| A1 | 0.769 | 167399 | 0.0096 | 20.2 | 18.0 | 1.1 | 1.00 | 7.3 | 32 | 0.66 |
| A2 | 0.778 | 156240 | 0.0091 | 19.9 | 17.7 | 1.1 | 1.00 | 7.1 | 31 | 0.67 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 11 | +0.009 | [-0.118, +0.123] | 4/3/4 | 0.438 |
| log(A1/A2) total_tokens | total_tokens | 11 | +0.071 | [-0.064, +0.202] | 6/5/0 | 0.167 |
| log(A1/A2) cost_usd | cost_usd | 11 | +0.050 | [-0.030, +0.129] | 7/4/0 | 0.134 |
| A2 − A0 | task_score | 11 | -0.030 | [-0.139, +0.044] | 4/4/3 | 0.609 |
| log(A0/A2) total_tokens | total_tokens | 11 | +0.355 | [+0.225, +0.489] | 11/0/0 | 0.000 |
| log(A0/A2) cost_usd | cost_usd | 11 | +0.224 | [+0.169, +0.282] | 11/0/0 | 0.000 |
| A1 − A0 | task_score | 11 | -0.038 | [-0.115, +0.021] | 3/3/5 | 0.812 |
| log(A0/A1) total_tokens | total_tokens | 11 | +0.284 | [+0.090, +0.455] | 9/2/0 | 0.010 |
| log(A0/A1) cost_usd | cost_usd | 11 | +0.174 | [+0.082, +0.253] | 9/2/0 | 0.004 |

## Confirmatory family (Amendment C; Holm over H4, H4u, H3)

| ID | Contrast | mean | 95% CI | p | Holm |
|---|---|---:|---|---:|---:|
| H4 | task score A2 − A1 (all) | +0.042 | [-0.036, +0.140] | 0.222 | 0.445 |
| H4u | task score A2 − A1 (B–E) | +0.009 | [-0.118, +0.123] | 0.438 | 0.445 |
| H3 | log(tokens A0 / tokens A2) | +0.325 | [+0.181, +0.470] | 0.000 | 0.000 |

Non-inferiority (H3 companion): task score A2 − A0 one-sided 95% lower bound = -0.058 (margin −0.05: NOT met).
