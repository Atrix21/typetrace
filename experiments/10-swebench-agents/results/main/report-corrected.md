# Experiment 10 report: agents on SWE-bench issues

346 issues with every arm (3460 runs). Unit = issue, repeats averaged.

| Arm | Score (changed fn in top 3) | Tokens / run (mean) | Turns | Used the tool |
|---|---:|---:|---:|---:|
| A0 | 0.824 | 69,915 | 9.0 | — |
| A1 | 0.822 | 65,473 | 9.1 | 96% |
| A2 | 0.821 | 70,165 | 9.1 | 98% |
| A5 | 0.819 | 88,387 | 9.5 | 17% |
| A6 | 0.824 | 147,032 | 9.7 | 18% |

## Family A: accuracy (Holm over 4)

| Test | Mean Δ | 95% CI | W/L/T | p | Holm p |
|---|---:|---|---|---:|---:|
| A2 > A0 | -0.003 | [-0.022, +0.014] | 17/20/309 | 0.6832 | 1.0000 |
| A2 > A1 | -0.001 | [-0.019, +0.016] | 13/14/319 | 0.6264 | 1.0000 |
| A2 > A5 | +0.001 | [-0.014, +0.017] | 12/11/323 | 0.5012 | 1.0000 |
| A2 > A6 | -0.003 | [-0.025, +0.019] | 19/22/305 | 0.6539 | 1.0000 |

## Family T: tokens (Holm over 3)

| Test | Mean log(other ÷ A2) (A2's tokens vs the other arm, typical issue) | 95% CI | W/L/T (W = A2 fewer) | p | Holm p |
|---|---:|---|---|---:|---:|
| A2 < A0 | +0.009 (-1%) | [-0.027, +0.045] | 174/172/0 | 0.3153 | 0.3153 |
| A2 < A5 | +0.266 (-23%) | [+0.231, +0.301] | 275/71/0 | 0.0000 | 0.0001 |
| A2 < A6 | +0.927 (-60%) | [+0.890, +0.966] | 343/3/0 | 0.0000 | 0.0001 |

Non-inferiority (A2 − A0): one-sided 95% lower bound -0.017 against −0.05: met.


## Exploratory: by benchmark (score)

| Benchmark | n | A0 | A1 | A2 | A5 | A6 |
|---|---:|---:|---:|---:|---:|---:|
| lite | 174 | 0.853 | 0.845 | 0.853 | 0.853 | 0.842 |
| ml | 172 | 0.794 | 0.799 | 0.788 | 0.785 | 0.805 |

Runs by account (exploratory check that switching accounts changes nothing): login1 3460 runs, mean score 0.822.

