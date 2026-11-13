# Experiment 3 agent stage: pilot-L-haiku

Runs: 18 from `pilot-L-haiku`; tasks 6; arms ['A0', 'A1', 'A2']; models ['claude-haiku-5-5']. Unit = task (repeats averaged). No LLM judge.


## all tasks: 6 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.718 | 876792 | 0.0451 | 35.2 | 33.0 | 0.0 | 0.00 | 15.7 | 87 | 0.38 |
| A1 | 0.728 | 946898 | 0.0422 | 37.5 | 35.3 | 2.2 | 1.00 | 17.2 | 92 | 0.38 |
| A2 | 0.747 | 628526 | 0.0284 | 32.2 | 30.2 | 2.0 | 1.00 | 14.2 | 107 | 0.40 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 6 | +0.018 | [+0.000, +0.039] | 2/0/4 | 0.250 |
| log(A1/A2) total_tokens | total_tokens | 6 | +0.400 | [+0.110, +0.721] | 5/1/0 | 0.031 |
| log(A1/A2) cost_usd | cost_usd | 6 | +0.300 | [+0.149, +0.469] | 6/0/0 | 0.016 |
| A2 − A0 | task_score | 6 | +0.029 | [+0.008, +0.052] | 3/0/3 | 0.125 |
| log(A0/A2) total_tokens | total_tokens | 6 | +0.344 | [+0.060, +0.610] | 5/1/0 | 0.047 |
| log(A0/A2) cost_usd | cost_usd | 6 | +0.315 | [+0.083, +0.529] | 5/1/0 | 0.047 |
| A1 − A0 | task_score | 6 | +0.010 | [+0.000, +0.031] | 1/0/5 | 0.500 |
| log(A0/A1) total_tokens | total_tokens | 6 | -0.057 | [-0.305, +0.159] | 3/3/0 | 0.672 |
| log(A0/A1) cost_usd | cost_usd | 6 | +0.015 | [-0.170, +0.205] | 4/2/0 | 0.453 |

## bug localisation (A): 3 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.667 | 887156 | 0.0597 | 32.0 | 30.0 | 0.0 | 0.00 | 15.3 | 104 | 0.06 |
| A1 | 0.667 | 1188247 | 0.0575 | 38.3 | 36.3 | 2.7 | 1.00 | 18.0 | 116 | 0.06 |
| A2 | 0.667 | 757923 | 0.0369 | 33.0 | 31.0 | 2.0 | 1.00 | 16.3 | 126 | 0.06 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 3 | +0.000 | [+0.000, +0.000] | 0/0/3 | 1.000 |
| log(A1/A2) total_tokens | total_tokens | 3 | +0.478 | [+0.016, +1.119] | 3/0/0 | 0.125 |
| log(A1/A2) cost_usd | cost_usd | 3 | +0.333 | [+0.085, +0.482] | 3/0/0 | 0.125 |
| A2 − A0 | task_score | 3 | +0.000 | [+0.000, +0.000] | 0/0/3 | 1.000 |
| log(A0/A2) total_tokens | total_tokens | 3 | +0.147 | [-0.225, +0.576] | 2/1/0 | 0.375 |
| log(A0/A2) cost_usd | cost_usd | 3 | +0.199 | [-0.138, +0.624] | 2/1/0 | 0.375 |
| A1 − A0 | task_score | 3 | +0.000 | [+0.000, +0.000] | 0/0/3 | 1.000 |
| log(A0/A1) total_tokens | total_tokens | 3 | -0.331 | [-0.543, -0.210] | 0/3/0 | 1.000 |
| log(A0/A1) cost_usd | cost_usd | 3 | -0.134 | [-0.321, +0.142] | 1/2/0 | 0.875 |

## understanding (B–E): 3 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.769 | 866428 | 0.0305 | 38.3 | 36.0 | 0.0 | 0.00 | 16.0 | 70 | 0.70 |
| A1 | 0.790 | 705550 | 0.0269 | 36.7 | 34.3 | 1.7 | 1.00 | 16.3 | 68 | 0.69 |
| A2 | 0.826 | 499129 | 0.0199 | 31.3 | 29.3 | 2.0 | 1.00 | 12.0 | 88 | 0.74 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A1 | task_score | 3 | +0.037 | [+0.000, +0.062] | 2/0/1 | 0.250 |
| log(A1/A2) total_tokens | total_tokens | 3 | +0.322 | [-0.000, +0.652] | 2/1/0 | 0.250 |
| log(A1/A2) cost_usd | cost_usd | 3 | +0.267 | [+0.094, +0.605] | 3/0/0 | 0.125 |
| A2 − A0 | task_score | 3 | +0.058 | [+0.048, +0.062] | 3/0/0 | 0.125 |
| log(A0/A2) total_tokens | total_tokens | 3 | +0.541 | [+0.231, +0.826] | 3/0/0 | 0.125 |
| log(A0/A2) cost_usd | cost_usd | 3 | +0.430 | [+0.177, +0.629] | 3/0/0 | 0.125 |
| A1 − A0 | task_score | 3 | +0.021 | [+0.000, +0.062] | 1/0/2 | 0.500 |
| log(A0/A1) total_tokens | total_tokens | 3 | +0.218 | [+0.174, +0.250] | 3/0/0 | 0.125 |
| log(A0/A1) cost_usd | cost_usd | 3 | +0.163 | [+0.024, +0.390] | 3/0/0 | 0.125 |

## Confirmatory family (Amendment C; Holm over H4, H4u, H3)

| ID | Contrast | mean | 95% CI | p | Holm |
|---|---|---:|---|---:|---:|
| H4 | task score A2 − A1 (all) | +0.018 | [+0.000, +0.039] | 0.250 | 0.500 |
| H4u | task score A2 − A1 (B–E) | +0.037 | [+0.000, +0.062] | 0.250 | 0.500 |
| H3 | log(tokens A0 / tokens A2) | +0.344 | [+0.060, +0.610] | 0.047 | 0.141 |

Non-inferiority (H3 companion): task score A2 − A0 one-sided 95% lower bound = +0.010 (margin −0.05: met).
