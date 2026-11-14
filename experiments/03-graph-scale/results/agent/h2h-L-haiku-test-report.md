# Experiment 3 agent stage: h2h-L-haiku-test

Runs: 216 from `h2h-L-haiku`; tasks 18; arms ['A0', 'A2', 'A5', 'A6']; models ['claude-haiku-5-5']. Unit = task (repeats averaged). No LLM judge.


## all tasks: 18 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.837 | 513343 | 0.0225 | 25.8 | 23.5 | 0.0 | 0.00 | 12.0 | 58 | 0.41 |
| A2 | 0.896 | 453186 | 0.0193 | 25.1 | 23.0 | 1.3 | 1.00 | 11.5 | 72 | 0.44 |
| A5 | 0.867 | 520608 | 0.0224 | 28.4 | 26.2 | 1.1 | 0.87 | 12.5 | 66 | 0.42 |
| A6 | 0.851 | 779185 | 0.0406 | 28.7 | 26.5 | 1.9 | 0.81 | 12.7 | 70 | 0.41 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 18 | +0.059 | [+0.010, +0.120] | 7/3/8 | 0.027 |
| log(A0/A2) total_tokens | total_tokens | 18 | +0.238 | [+0.060, +0.387] | 15/3/0 | 0.008 |
| log(A0/A2) cost_usd | cost_usd | 18 | +0.161 | [+0.016, +0.286] | 15/3/0 | 0.020 |
| A2 − A5 | task_score | 18 | +0.029 | [-0.007, +0.076] | 5/5/8 | 0.129 |
| log(A5/A2) total_tokens | total_tokens | 18 | +0.267 | [+0.129, +0.401] | 13/5/0 | 0.001 |
| log(A5/A2) cost_usd | cost_usd | 18 | +0.165 | [+0.072, +0.255] | 14/4/0 | 0.002 |
| A2 − A6 | task_score | 18 | +0.045 | [-0.034, +0.141] | 7/2/9 | 0.164 |
| log(A6/A2) total_tokens | total_tokens | 18 | +0.716 | [+0.506, +0.903] | 17/1/0 | 0.000 |
| log(A6/A2) cost_usd | cost_usd | 18 | +0.569 | [+0.320, +0.794] | 17/1/0 | 0.000 |
| A5 − A0 | task_score | 18 | +0.030 | [-0.017, +0.083] | 6/3/9 | 0.139 |
| log(A0/A5) total_tokens | total_tokens | 18 | -0.028 | [-0.202, +0.138] | 11/7/0 | 0.628 |
| log(A0/A5) cost_usd | cost_usd | 18 | -0.004 | [-0.174, +0.142] | 11/7/0 | 0.517 |
| A6 − A0 | task_score | 18 | +0.014 | [-0.074, +0.116] | 6/5/7 | 0.419 |
| log(A0/A6) total_tokens | total_tokens | 18 | -0.478 | [-0.626, -0.330] | 2/16/0 | 1.000 |
| log(A0/A6) cost_usd | cost_usd | 18 | -0.407 | [-0.621, -0.211] | 2/16/0 | 1.000 |

## bug localisation (A): 7 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.857 | 565294 | 0.0224 | 24.3 | 22.3 | 0.0 | 0.00 | 9.7 | 59 | 0.21 |
| A2 | 0.952 | 607342 | 0.0230 | 26.7 | 24.7 | 1.2 | 1.00 | 11.2 | 82 | 0.17 |
| A5 | 0.905 | 693020 | 0.0275 | 31.0 | 29.0 | 1.2 | 0.71 | 12.2 | 76 | 0.15 |
| A6 | 0.857 | 957015 | 0.0446 | 29.3 | 27.3 | 1.7 | 0.71 | 11.5 | 76 | 0.17 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 7 | +0.095 | [+0.000, +0.190] | 2/0/5 | 0.250 |
| log(A0/A2) total_tokens | total_tokens | 7 | +0.063 | [-0.296, +0.361] | 4/3/0 | 0.359 |
| log(A0/A2) cost_usd | cost_usd | 7 | +0.016 | [-0.283, +0.288] | 4/3/0 | 0.469 |
| A2 − A5 | task_score | 7 | +0.048 | [+0.000, +0.143] | 1/0/6 | 0.500 |
| log(A5/A2) total_tokens | total_tokens | 7 | +0.336 | [+0.098, +0.583] | 5/2/0 | 0.031 |
| log(A5/A2) cost_usd | cost_usd | 7 | +0.213 | [+0.004, +0.394] | 5/2/0 | 0.047 |
| A2 − A6 | task_score | 7 | +0.095 | [-0.095, +0.333] | 2/1/4 | 0.375 |
| log(A6/A2) total_tokens | total_tokens | 7 | +0.696 | [+0.232, +1.096] | 6/1/0 | 0.023 |
| log(A6/A2) cost_usd | cost_usd | 7 | +0.540 | [+0.005, +0.906] | 6/1/0 | 0.039 |
| A5 − A0 | task_score | 7 | +0.048 | [+0.000, +0.143] | 1/0/6 | 0.500 |
| log(A0/A5) total_tokens | total_tokens | 7 | -0.273 | [-0.550, +0.025] | 2/5/0 | 0.930 |
| log(A0/A5) cost_usd | cost_usd | 7 | -0.196 | [-0.541, +0.118] | 2/5/0 | 0.812 |
| A6 − A0 | task_score | 7 | +0.000 | [-0.190, +0.238] | 1/2/4 | 0.625 |
| log(A0/A6) total_tokens | total_tokens | 7 | -0.633 | [-0.905, -0.322] | 1/6/0 | 0.992 |
| log(A0/A6) cost_usd | cost_usd | 7 | -0.524 | [-0.928, -0.114] | 1/6/0 | 0.977 |

## understanding (B–E): 11 tasks

| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 0.824 | 480284 | 0.0225 | 26.7 | 24.2 | 0.0 | 0.00 | 13.5 | 56 | 0.54 |
| A2 | 0.860 | 355086 | 0.0169 | 24.2 | 21.9 | 1.3 | 1.00 | 11.7 | 65 | 0.61 |
| A5 | 0.843 | 410892 | 0.0191 | 26.8 | 24.5 | 1.1 | 0.97 | 12.6 | 59 | 0.59 |
| A6 | 0.847 | 666021 | 0.0381 | 28.3 | 25.9 | 2.1 | 0.88 | 13.5 | 66 | 0.56 |

| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |
|---|---|---:|---:|---|---|---:|
| A2 − A0 | task_score | 11 | +0.035 | [-0.007, +0.092] | 5/3/3 | 0.109 |
| log(A0/A2) total_tokens | total_tokens | 11 | +0.350 | [+0.228, +0.472] | 11/0/0 | 0.000 |
| log(A0/A2) cost_usd | cost_usd | 11 | +0.254 | [+0.166, +0.338] | 11/0/0 | 0.000 |
| A2 − A5 | task_score | 11 | +0.016 | [-0.018, +0.058] | 4/5/2 | 0.264 |
| log(A5/A2) total_tokens | total_tokens | 11 | +0.222 | [+0.067, +0.374] | 8/3/0 | 0.014 |
| log(A5/A2) cost_usd | cost_usd | 11 | +0.135 | [+0.060, +0.213] | 9/2/0 | 0.004 |
| A2 − A6 | task_score | 11 | +0.012 | [-0.011, +0.035] | 5/1/5 | 0.172 |
| log(A6/A2) total_tokens | total_tokens | 11 | +0.729 | [+0.568, +0.894] | 11/0/0 | 0.000 |
| log(A6/A2) cost_usd | cost_usd | 11 | +0.587 | [+0.372, +0.847] | 11/0/0 | 0.000 |
| A5 − A0 | task_score | 11 | +0.019 | [-0.042, +0.076] | 5/3/3 | 0.277 |
| log(A0/A5) total_tokens | total_tokens | 11 | +0.127 | [-0.015, +0.272] | 9/2/0 | 0.065 |
| log(A0/A5) cost_usd | cost_usd | 11 | +0.118 | [+0.025, +0.208] | 9/2/0 | 0.021 |
| A6 − A0 | task_score | 11 | +0.023 | [-0.024, +0.083] | 5/3/3 | 0.262 |
| log(A0/A6) total_tokens | total_tokens | 11 | -0.379 | [-0.491, -0.262] | 1/10/0 | 1.000 |
| log(A0/A6) cost_usd | cost_usd | 11 | -0.333 | [-0.559, -0.147] | 1/10/0 | 0.999 |

## Confirmatory family (Amendment C; Holm over H4, H4u, H3)

| ID | Contrast | mean | 95% CI | p | Holm |
|---|---|---:|---|---:|---:|
| H3 | log(tokens A0 / tokens A2) | +0.238 | [+0.060, +0.387] | 0.008 | 0.008 |

## Head-to-head family (Amendment D4; Holm over four, one-sided, ours = A2)

| ID | Contrast | mean | 95% CI | W/L/T | p | Holm |
|---|---|---:|---|---|---:|---:|
| D-acc-G | task score ours − graphify | +0.029 | [-0.007, +0.076] | 5/5/8 | 0.129 | 0.258 |
| D-acc-C | task score ours − code-review-graph | +0.045 | [-0.034, +0.141] | 7/2/9 | 0.164 | 0.258 |
| D-tok-G | log(tokens graphify / ours) | +0.267 | [+0.129, +0.401] | 13/5/0 | 0.001 | 0.003 |
| D-tok-C | log(tokens code-review-graph / ours) | +0.716 | [+0.506, +0.903] | 17/1/0 | 0.000 | 0.000 |

Non-inferiority (H3 companion): task score A2 − A0 one-sided 95% lower bound = +0.015 (margin −0.05: met).
