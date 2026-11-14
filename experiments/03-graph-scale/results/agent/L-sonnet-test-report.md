# Experiment 3 agent stage: L-sonnet-test

Runs: 72 from `main-L-sonnet`; tasks 18; arms ['A0', 'A2']; models ['claude-sonnet-5-5']. Unit = task (repeats averaged). No LLM judge.


## all tasks: 18 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.845 | 208565 | 0.2045 | 18.1 | 15.8 | 0.0 | 0.00 | 7.4 | 38 | 0.49 |
| A2 | 0.873 | 165802 | 0.1697 | 16.1 | 13.9 | 1.0 | 0.97 | 6.4 | 46 | 0.49 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 18 | +0.028 | [-0.012, +0.090] | 3/3/12 | 0.261 |
| log(A0/A2) total_tokens | total_tokens | 18 | +0.197 | [+0.016, +0.386] | 10/8/0 | 0.028 |
| log(A0/A2) cost_usd | cost_usd | 18 | +0.164 | [+0.030, +0.300] | 12/6/0 | 0.015 |

## bug localisation (A): 7 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.857 | 256086 | 0.1902 | 19.0 | 17.0 | 0.0 | 0.00 | 6.6 | 40 | 0.26 |
| A2 | 0.929 | 225360 | 0.1742 | 18.1 | 16.1 | 0.9 | 0.93 | 6.1 | 48 | 0.24 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 7 | +0.071 | [+0.000, +0.214] | 1/0/6 | 0.500 |
| log(A0/A2) total_tokens | total_tokens | 7 | -0.037 | [-0.253, +0.191] | 2/5/0 | 0.617 |
| log(A0/A2) cost_usd | cost_usd | 7 | -0.009 | [-0.167, +0.164] | 3/4/0 | 0.531 |

## understanding (B–E): 11 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.838 | 178324 | 0.2136 | 17.5 | 15.0 | 0.0 | 0.00 | 7.9 | 37 | 0.61 |
| A2 | 0.838 | 127901 | 0.1668 | 14.8 | 12.5 | 1.0 | 1.00 | 6.6 | 45 | 0.65 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 11 | -0.000 | [-0.024, +0.025] | 2/3/6 | 0.531 |
| log(A0/A2) total_tokens | total_tokens | 11 | +0.346 | [+0.117, +0.569] | 8/3/0 | 0.011 |
| log(A0/A2) cost_usd | cost_usd | 11 | +0.275 | [+0.111, +0.438] | 9/2/0 | 0.005 |

## Confirmatory family (Amendment C; Holm over H4, H4u, H3)

| ID | Contrast | mean | 95% CI | p | Holm |
|---|---|---:|---|---:|---:|
| H3 | log(tokens A0 / tokens A2) | +0.197 | [+0.016, +0.386] | 0.028 | 0.028 |

Non-inferiority (H3 companion): task score A2 − A0 one-sided 95% lower bound = -0.009 (margin −0.05: met).
