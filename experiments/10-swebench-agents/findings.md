# Experiment 10: findings (coding agents on SWE-bench Lite and Multilingual issues)

Main run from 2026-11-19 01:04 IST to 2026-11-20 05:19 IST, with two stops (an automatic Claude Code update and a
full disk, both fixed and logged). All 346 issues were scored with every arm: 3,460 runs (5 arms × 2 repeats). Protocol:
[`protocol.md`](protocol.md), pre-registered and frozen before the pilot. Changes during the run:
[`decision-log.md`](decision-log.md) (E10-D01 to E10-D07; no prompt, tool, arm, scoring or analysis change). Full
tables: [`results/main/report-corrected.md`](results/main/report-corrected.md), from
`python3 scripts/swebench/analyse_agents.py experiments/10-swebench-agents/results/main --apply experiments/10-swebench-agents/results/main/rescore-E11-D07.jsonl --out report-corrected`.
**Corrected on 2026-11-21 (E10-D08):** a path-cleaning bug in the scorer had scored five issues 0 in every arm; every
arm's scores rise by the same amount, and no comparison or conclusion changes. The original report is kept as
[`results/main/report.md`](results/main/report.md).

Model: Claude Haiku 5.5, effort high, 40 turns, Claude Code 2.1.327. 174 issues from SWE-bench Lite (Python) and 172
from SWE-bench Multilingual (9 languages).

## Summary

- **No arm made the agent find the code more often (Q1 and Q4: no difference).** A changed function was among the
  agent's first three answers in 82% of issues in every arm: grep alone 0.824, TypeTrace 0.821, TypeTrace without
  the graph 0.822, graphify 0.819, code-review-graph with embeddings 0.824 (corrected on 2026-11-21, E10-D08). None of the four confirmatory accuracy
  tests comes close (all Holm p = 1.0). TypeTrace is non-inferior to grep alone: the one-sided 95% lower bound of
  the difference is −0.017, inside the −0.05 margin. The 95% CI rules out a gain of more than 0.014 over grep.
- **The graph made no difference inside the agent either (Q2).** TypeTrace with and without the call graph:
  Δ −0.001 [−0.019, +0.016], 13 wins / 14 losses / 319 ties. This is the result of experiments 5 and 8 (retrieval
  only), now with an agent.
- **TypeTrace did not save tokens against grep here (Q3, not supported).** Per issue, the agent used 1% fewer tokens
  with TypeTrace than with grep alone (95% CI: from 4% fewer to 3% more), Holm p = 0.32 (mean 70,165 against 69,915;
  median 41,435 against 43,927). The 18–28% savings on our TypeScript tasks (experiment 3) did not carry over to
  SWE-bench issues.
- **TypeTrace used far fewer tokens than both competitors (supported).** 23% fewer than graphify and 60% fewer than
  code-review-graph per issue (both Holm p = 0.0001; 275/71 and 343/3 issues). Most of that gap is the competitors'
  own overhead, not TypeTrace's saving: the agent called graphify in only 17% of runs and code-review-graph in 18%,
  and paid for their tool definitions in every run.
- **The agent used TypeTrace's tool in 98% of runs and the competitors' in 17–18%.** Installed as bare MCP servers,
  without their vendors' skills, instructions and hooks, the competitors' scores here mostly measure grep. Experiment
  11 tests each tool with its vendor's own setup.

## Results (346 issues, repeats averaged per issue)

| Arm | Changed function in top 3 (primary) | Top 1 | Any position | Share of changed functions listed | Tokens / run (mean) | Median | Turns | Wall time | Used the tool |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 grep alone | **0.824** | **0.712** | 0.857 | 0.759 | 69,915 | 43,927 | 9.0 | 38 s | — |
| A1 TypeTrace without the graph | 0.822 | 0.694 | 0.853 | 0.756 | **65,473** | 41,662 | 9.1 | **34 s** | 96% |
| A2 TypeTrace (as shipped) | 0.821 | 0.689 | 0.857 | 0.756 | 70,165 | **41,435** | 9.1 | 36 s | 98% |
| A5 graphify 0.9.108 | 0.819 | 0.705 | **0.858** | **0.762** | 88,387 | 54,486 | 9.5 | 43 s | 17% |
| A6 code-review-graph 2.4.0 + embeddings | **0.824** | 0.705 | 0.853 | 0.755 | 147,032 | 108,630 | 9.7 | 44 s | 18% |

Columns after the primary score and the token columns of the confirmatory family are secondary outcomes, reported
without tests (exploratory).

### Confirmatory family A: accuracy (one-sided paired sign-flip permutation, Holm over 4)

| Test | Mean Δ | 95% CI | W / L / T | Holm p | Result |
|---|---:|---|---|---:|---|
| A2 > A0 (grep alone) | −0.003 | [−0.022, +0.014] | 17 / 20 / 309 | 1.0 | not supported |
| A2 > A1 (no graph) | −0.001 | [−0.019, +0.016] | 13 / 14 / 319 | 1.0 | not supported |
| A2 > A5 (graphify) | +0.001 | [−0.014, +0.017] | 12 / 11 / 323 | 1.0 | not supported |
| A2 > A6 (code-review-graph) | −0.003 | [−0.025, +0.019] | 19 / 22 / 305 | 1.0 | not supported |

Non-inferiority, reported with A2 > A0: lower bound −0.017 against a margin of −0.05, **met**.

### Confirmatory family T: tokens (per-issue log ratio, Holm over 3)

| Test | A2's tokens against the other arm (typical issue) | 95% CI (log ratio) | Issues where A2 used fewer | Holm p | Result |
|---|---:|---|---|---:|---|
| A2 < A0 (grep alone) | −1% | [−0.027, +0.045] | 174 of 346 | 0.32 | not supported |
| A2 < A5 (graphify) | −23% | [+0.231, +0.301] | 275 of 346 | 0.0001 | supported |
| A2 < A6 (code-review-graph) | −60% | [+0.890, +0.966] | 343 of 346 | 0.0001 | supported |

## Exploratory

**Top-1 accuracy is slightly lower with TypeTrace.** Grep alone put a changed function first in 0.712 of issues,
TypeTrace in 0.689: Δ −0.023, bootstrap 95% CI [−0.043, −0.004]. Without the graph the difference is similar
(−0.019 [−0.040, +0.003]). The share of listed functions that actually changed is also lower in both TypeTrace arms
(0.218 and 0.224, against 0.261 for grep alone): the agent lists more functions, or more neighbours of the right one.
This is one of many unplanned comparisons, uncorrected, and the top-3 score is unchanged; but it is the only
difference in the experiment whose interval excludes zero, and it goes against TypeTrace. Experiment 11 reports
top-1 for every arm.

**By benchmark and language** (top 3 / share of changed functions listed; small samples, no tests):

| Language | Issues | Grep alone | TypeTrace no graph | TypeTrace | graphify | code-review-graph |
|---|---:|---|---|---|---|---|
| Python (Lite) | 174 | 0.85 / 0.83 | 0.84 / 0.83 | 0.85 / 0.83 | 0.85 / 0.84 | 0.84 / 0.82 |
| Ruby | 26 | 0.75 / 0.60 | 0.79 / 0.61 | 0.77 / 0.59 | 0.75 / 0.58 | 0.75 / 0.60 |
| PHP | 25 | 0.84 / 0.74 | 0.86 / 0.74 | 0.78 / 0.73 | 0.76 / 0.72 | 0.86 / 0.74 |
| Go | 25 | 0.74 / 0.70 | 0.76 / 0.70 | 0.76 / 0.72 | 0.78 / 0.71 | 0.78 / 0.72 |
| Rust | 23 | 0.91 / 0.71 | 0.89 / 0.71 | 0.91 / 0.72 | 0.89 / 0.76 | 0.89 / 0.76 |
| Java | 20 | 0.72 / 0.63 | 0.68 / 0.59 | 0.70 / 0.59 | 0.70 / 0.62 | 0.68 / 0.60 |
| JavaScript | 20 | 0.70 / 0.65 | 0.70 / 0.63 | 0.70 / 0.64 | 0.72 / 0.66 | 0.72 / 0.64 |
| C | 16 | 0.88 / 0.79 | 0.94 / 0.82 | 0.94 / 0.80 | 0.94 / 0.80 | 0.97 / 0.84 |
| TypeScript | 10 | 1.00 / 1.00 | 1.00 / 1.00 | 0.95 / 0.95 | 0.95 / 0.95 | 1.00 / 1.00 |
| C++ | 6 | 0.50 / 0.21 | 0.42 / 0.21 | 0.42 / 0.21 | 0.42 / 0.21 | 0.50 / 0.18 |

One issue whose changed code spans Go, JavaScript and TypeScript is in the totals only. No language shows a
consistent difference between arms; the per-language gaps are within one or two issues.

**Where the competitors' tokens go.** In runs where the agent never called the tool, the median run cost 50,544
tokens with graphify installed and 102,811 with code-review-graph, against 43,927 with grep alone: the tool
definitions and server instructions are sent on every turn whether or not they are used. In runs where the agent did
call them, the medians were 72,837 and 131,434.

**Cost and time.** At list price the 3,460 scored runs cost $16.99 (charged to a subscription): $3.13 for TypeTrace's
692 runs, $3.20 for grep alone, $3.58 for graphify and $4.04 for code-review-graph. TypeTrace runs were the fastest
(34–36 s against 38 s for grep alone and 43–44 s for the competitors), with the same number of turns.

**Accounts.** Every run used the first login; the failover to the second was never needed.

## What this means

1. **On SWE-bench issues a capable agent finds the code with grep as well as with any of these tools.** A likely
   reason: the issues describe the failing behaviour precisely, often with an error message or a function name, and
   the agent finishes in about nine turns in every arm. The ceiling (0.82 top-3, 0.86 anywhere) is the same for all five arms, so what
   separates them is cost, not accuracy.
2. **TypeTrace's retrieval lead (experiments 5 and 8) does not become an agent accuracy lead.** Retrieval alone,
   TypeTrace's Recall@10 was 0.47 and 0.39 against 0.35/0.26 for code-review-graph and 0.15/0.12 for graphify. Inside
   the agent, grep closes the gap.
3. **The token saving against grep is task-dependent.** On our own TypeScript repositories (experiment 3), where a
   task needs code spread over several files, TypeTrace saved 18–28%. On SWE-bench issues it saved nothing. The
   claim "fewer tokens than grep" now has to be qualified by the kind of task.
4. **Against the competitors installed the same way, TypeTrace costs a quarter to three fifths less for the same
   accuracy.** That comparison is fair as run (every arm a bare MCP server), but it is mostly a property of the
   competitors' tool definitions. Whether their vendors' own setups change the picture is experiment 11's question.

## Limitations

- **Ceiling.** Grep alone already finds a changed function in the top three in 82% of issues. The primary score
  cannot show gains much above 0.05 on the remaining 19%, and the experiment was powered for a 0.05 difference.
- **One model.** Claude Haiku 5.5 at high effort. A weaker model might lean on the tools more; a stronger one less.
- **Localisation, not resolution.** The agent names the code to change but does not change it. Stage 2 (resolving
  the issue under the SWE-bench test harness) has its own protocol, still to be written.
- **Competitors without their vendor setups.** By design (equal treatment), and the reason for experiment 11.

## Deviations and records

- **E10-D05:** an automatic Claude Code update stopped the run at 779 of 3,460; the version was pinned to 2.1.327
  and the run resumed. The two runs in flight at the stop were discarded and rerun on the pinned version.
- **E10-D06:** the disk filled at 1,024 of 3,460; per-issue indexes are now deleted when an issue ends. One cut-off
  record in `excluded.jsonl` was completed and marked `repaired`; no scored run was affected.
- **E10-D07:** after the run, the absolute paths in `excluded.jsonl` (the scratch folder and the competitor adapter
  in error messages of failed setups) were shortened to repository-relative paths before publishing. No other field
  changed. The original file is kept outside the repository.
- **Retries:** 41 attempts ended without a result event (Claude Code exited without an answer) and 1 was aborted at
  the version stop. All were retried under E10-D02; 33 scored runs are second or later attempts. The run with the
  version mismatch is not counted.
- **E10-D08 (2026-11-21):** scoring correction, as described at the top of this file; all figures here are corrected.
- Transcripts (263 MB) and tool logs are kept locally and are not in the repository, as for the pilot.
