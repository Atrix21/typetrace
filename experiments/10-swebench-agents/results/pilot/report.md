# Experiment 10 report: agents on SWE-bench issues

30 issues with every arm (298 runs). Unit = issue, repeats averaged.

| Arm | Score (changed fn in top 3) | Tokens / run (mean) | Turns | Used the tool |
|---|---:|---:|---:|---:|
| A0 | 0.850 | 115,120 | 9.8 | — |
| A1 | 0.917 | 83,087 | 9.6 | 97% |
| A2 | 0.833 | 60,609 | 9.1 | 98% |
| A5 | 0.817 | 90,691 | 9.7 | 14% |
| A6 | 0.867 | 155,595 | 10.0 | 24% |

## Family A: accuracy (Holm over 4)

| Test | Mean Δ | 95% CI | W/L/T | p | Holm p |
|---|---:|---|---|---:|---:|
| A2 > A0 | -0.017 | [-0.083, +0.033] | 1/2/27 | 0.8745 | 1.0000 |
| A2 > A1 | -0.083 | [-0.183, +0.000] | 0/3/27 | 1.0000 | 1.0000 |
| A2 > A5 | +0.017 | [-0.050, +0.083] | 3/2/25 | 0.4988 | 1.0000 |
| A2 > A6 | -0.033 | [-0.133, +0.067] | 1/3/26 | 0.8118 | 1.0000 |

## Family T: tokens (Holm over 3)

| Test | Mean log(other ÷ A2) (A2's tokens vs the other arm, typical issue) | 95% CI | W/L/T (W = A2 fewer) | p | Holm p |
|---|---:|---|---|---:|---:|
| A2 < A0 | +0.155 (-14%) | [+0.025, +0.313] | 22/8/0 | 0.0165 | 0.0165 |
| A2 < A5 | +0.353 (-30%) | [+0.224, +0.484] | 27/3/0 | 0.0000 | 0.0001 |
| A2 < A6 | +0.931 (-61%) | [+0.818, +1.058] | 30/0/0 | 0.0000 | 0.0001 |

Non-inferiority (A2 − A0): one-sided 95% lower bound -0.067 against −0.05: NOT met.


## Exploratory: by benchmark (score)

| Benchmark | n | A0 | A1 | A2 | A5 | A6 |
|---|---:|---:|---:|---:|---:|---:|
| lite | 15 | 0.933 | 1.000 | 0.900 | 0.933 | 0.933 |
| ml | 15 | 0.767 | 0.833 | 0.767 | 0.700 | 0.800 |

Runs by account (exploratory check that switching accounts changes nothing): login1 298 runs, mean score 0.856.

