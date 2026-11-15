# Experiment 3 agent stage: h2h-M-haiku-test

Runs: 312 from `h2h-M-haiku`; tasks 26; arms ['A0', 'A2', 'A5', 'A6']; models ['claude-haiku-5-5']. Unit = task (repeats averaged). No LLM judge.


## all tasks: 26 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.816 | 234949 | 0.0130 | 18.6 | 16.5 | 0.0 | 0.00 | 5.7 | 56 | 0.41 |
| A2 | 0.860 | 190208 | 0.0134 | 17.7 | 15.7 | 1.1 | 1.00 | 5.8 | 50 | 0.41 |
| A5 | 0.833 | 248416 | 0.0125 | 19.3 | 17.2 | 1.0 | 0.92 | 6.1 | 49 | 0.39 |
| A6 | 0.859 | 399018 | 0.0190 | 19.7 | 17.6 | 1.1 | 0.69 | 6.0 | 62 | 0.40 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 26 | +0.044 | [+0.007, +0.089] | 7/4/15 | 0.024 |
| log(A0/A2) total_tokens | total_tokens | 26 | +0.325 | [+0.186, +0.466] | 20/6/0 | 0.000 |
| log(A0/A2) cost_usd | cost_usd | 26 | +0.187 | [+0.078, +0.285] | 20/6/0 | 0.001 |
| A2 − A5 | task_score | 26 | +0.028 | [-0.021, +0.080] | 7/3/16 | 0.154 |
| log(A5/A2) total_tokens | total_tokens | 26 | +0.411 | [+0.233, +0.592] | 21/5/0 | 0.000 |
| log(A5/A2) cost_usd | cost_usd | 26 | +0.203 | [+0.056, +0.325] | 21/5/0 | 0.004 |
| A2 − A6 | task_score | 26 | +0.002 | [-0.036, +0.039] | 4/5/17 | 0.468 |
| log(A6/A2) total_tokens | total_tokens | 26 | +0.883 | [+0.737, +1.032] | 26/0/0 | 0.000 |
| log(A6/A2) cost_usd | cost_usd | 26 | +0.421 | [+0.337, +0.510] | 26/0/0 | 0.000 |
| A5 − A0 | task_score | 26 | +0.016 | [-0.026, +0.057] | 7/4/15 | 0.246 |
| log(A0/A5) total_tokens | total_tokens | 26 | -0.086 | [-0.169, -0.001] | 7/19/0 | 0.970 |
| log(A0/A5) cost_usd | cost_usd | 26 | -0.016 | [-0.074, +0.051] | 11/15/0 | 0.688 |
| A6 − A0 | task_score | 26 | +0.042 | [-0.015, +0.112] | 6/3/17 | 0.114 |
| log(A0/A6) total_tokens | total_tokens | 26 | -0.558 | [-0.667, -0.445] | 1/25/0 | 1.000 |
| log(A0/A6) cost_usd | cost_usd | 26 | -0.234 | [-0.320, -0.152] | 4/22/0 | 1.000 |

## bug localisation (A): 15 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.844 | 241729 | 0.0140 | 16.8 | 14.8 | 0.0 | 0.00 | 4.8 | 65 | 0.22 |
| A2 | 0.889 | 208532 | 0.0164 | 15.8 | 13.8 | 1.1 | 1.00 | 4.8 | 60 | 0.24 |
| A5 | 0.844 | 254221 | 0.0130 | 17.6 | 15.5 | 0.9 | 0.87 | 4.8 | 55 | 0.22 |
| A6 | 0.889 | 414436 | 0.0225 | 18.4 | 16.4 | 0.7 | 0.47 | 5.1 | 71 | 0.22 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 15 | +0.044 | [+0.000, +0.111] | 2/0/13 | 0.250 |
| log(A0/A2) total_tokens | total_tokens | 15 | +0.290 | [+0.083, +0.505] | 10/5/0 | 0.010 |
| log(A0/A2) cost_usd | cost_usd | 15 | +0.141 | [-0.024, +0.290] | 10/5/0 | 0.057 |
| A2 − A5 | task_score | 15 | +0.044 | [-0.044, +0.133] | 3/1/11 | 0.312 |
| log(A5/A2) total_tokens | total_tokens | 15 | +0.393 | [+0.126, +0.675] | 11/4/0 | 0.008 |
| log(A5/A2) cost_usd | cost_usd | 15 | +0.158 | [-0.078, +0.352] | 12/3/0 | 0.098 |
| A2 − A6 | task_score | 15 | +0.000 | [-0.067, +0.067] | 1/1/13 | 0.750 |
| log(A6/A2) total_tokens | total_tokens | 15 | +0.892 | [+0.680, +1.116] | 15/0/0 | 0.000 |
| log(A6/A2) cost_usd | cost_usd | 15 | +0.410 | [+0.287, +0.546] | 15/0/0 | 0.000 |
| A5 − A0 | task_score | 15 | -0.000 | [-0.067, +0.067] | 1/1/13 | 0.750 |
| log(A0/A5) total_tokens | total_tokens | 15 | -0.103 | [-0.236, +0.035] | 5/10/0 | 0.915 |
| log(A0/A5) cost_usd | cost_usd | 15 | -0.017 | [-0.109, +0.089] | 6/9/0 | 0.623 |
| A6 − A0 | task_score | 15 | +0.044 | [-0.044, +0.156] | 2/1/12 | 0.375 |
| log(A0/A6) total_tokens | total_tokens | 15 | -0.602 | [-0.741, -0.452] | 1/14/0 | 1.000 |
| log(A0/A6) cost_usd | cost_usd | 15 | -0.269 | [-0.386, -0.160] | 2/13/0 | 1.000 |

## understanding (B–E): 11 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.778 | 225703 | 0.0117 | 20.9 | 18.8 | 0.0 | 0.00 | 7.0 | 43 | 0.67 |
| A2 | 0.821 | 165222 | 0.0094 | 20.4 | 18.3 | 1.2 | 1.00 | 7.1 | 38 | 0.65 |
| A5 | 0.817 | 240500 | 0.0119 | 21.6 | 19.5 | 1.1 | 1.00 | 7.8 | 42 | 0.62 |
| A6 | 0.817 | 377993 | 0.0143 | 21.4 | 19.3 | 1.7 | 1.00 | 7.4 | 49 | 0.66 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 11 | +0.043 | [-0.011, +0.101] | 5/4/2 | 0.098 |
| log(A0/A2) total_tokens | total_tokens | 11 | +0.373 | [+0.213, +0.533] | 10/1/0 | 0.001 |
| log(A0/A2) cost_usd | cost_usd | 11 | +0.250 | [+0.149, +0.356] | 10/1/0 | 0.001 |
| A2 − A5 | task_score | 11 | +0.004 | [-0.021, +0.029] | 4/2/5 | 0.375 |
| log(A5/A2) total_tokens | total_tokens | 11 | +0.436 | [+0.235, +0.635] | 10/1/0 | 0.002 |
| log(A5/A2) cost_usd | cost_usd | 11 | +0.264 | [+0.146, +0.374] | 9/2/0 | 0.002 |
| A2 − A6 | task_score | 11 | +0.004 | [-0.023, +0.037] | 3/4/4 | 0.430 |
| log(A6/A2) total_tokens | total_tokens | 11 | +0.870 | [+0.694, +1.027] | 11/0/0 | 0.000 |
| log(A6/A2) cost_usd | cost_usd | 11 | +0.436 | [+0.332, +0.538] | 11/0/0 | 0.000 |
| A5 − A0 | task_score | 11 | +0.039 | [-0.001, +0.085] | 6/3/2 | 0.076 |
| log(A0/A5) total_tokens | total_tokens | 11 | -0.063 | [-0.133, +0.015] | 2/9/0 | 0.926 |
| log(A0/A5) cost_usd | cost_usd | 11 | -0.014 | [-0.067, +0.038] | 5/6/0 | 0.692 |
| A6 − A0 | task_score | 11 | +0.039 | [-0.004, +0.088] | 4/2/5 | 0.078 |
| log(A0/A6) total_tokens | total_tokens | 11 | -0.497 | [-0.662, -0.332] | 0/11/0 | 1.000 |
| log(A0/A6) cost_usd | cost_usd | 11 | -0.186 | [-0.310, -0.072] | 2/9/0 | 0.995 |

## Confirmatory family (Amendment C; Holm over H4, H4u, H3)

| ID | Contrast | mean | 95% CI | p | Holm |
|---|---|---:|---|---:|---:|
| H3 | log(tokens A0 / tokens A2) | +0.325 | [+0.186, +0.466] | 0.000 | 0.000 |

## Head-to-head family (Amendment D4; Holm over four, one-sided, ours = A2)

| ID | Contrast | mean | 95% CI | W/L/T | p | Holm |
|---|---|---:|---|---|---:|---:|
| D-acc-G | task score ours − graphify | +0.028 | [-0.021, +0.080] | 7/3/16 | 0.154 | 0.308 |
| D-acc-C | task score ours − code-review-graph | +0.002 | [-0.036, +0.039] | 4/5/17 | 0.468 | 0.468 |
| D-tok-G | log(tokens graphify / ours) | +0.411 | [+0.233, +0.592] | 21/5/0 | 0.000 | 0.000 |
| D-tok-C | log(tokens code-review-graph / ours) | +0.883 | [+0.737, +1.032] | 26/0/0 | 0.000 | 0.000 |

Non-inferiority (H3 companion): task score A2 − A0 one-sided 95% lower bound = +0.012 (margin −0.05: met).
