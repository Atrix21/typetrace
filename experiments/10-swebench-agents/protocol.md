# Experiment 10: coding agents on SWE-bench Lite and Multilingual issues (pre-registered)

Written on 2026-11-18, before any billable run of this experiment. The only runs so far are mock runs against a local
fake API, which test the harness and use no model. The billable run waits for the owner's go.

## Why

Experiment 3's agent results come from 58 tasks in two TypeScript repositories that we built ourselves. Three things
limit them:
- the agents scored near the ceiling (0.82 to 0.90 with grep alone);
- accuracy differences below about 0.05 could not be detected;
- accuracy gains over grep alone did not replicate across five runs, while the token savings did.

This experiment repeats the agent comparison on issues others chose, in ten languages, at a sample size set by a
power analysis.

## Questions

1. Does the compact retrieval tool (A2) make the agent find the code to change more often than grep alone (A0)?
2. Does graph content matter inside the agent (A2 against A1, the same tool without graph propagation)?
3. Does the tool reduce tokens per issue?
4. How does it compare with graphify (A5) and code-review-graph with embeddings (A6) in accuracy and tokens?

## Data

- **Issues.** SWE-bench Lite (300 Python issues) and SWE-bench Multilingual (300 issues in 9 languages), as frozen by
  experiments 5 and 8 (SHA-256 in their `FROZEN.json`). Issues whose gold patch changes no declaration are left out,
  as in those experiments.
- **Ground truth.** The declarations the gold patch changes, as frozen by experiments 5 and 8. The rule does not
  involve any retrieval method.
- **Selection.** `selection.json`, from `scripts/swebench/select_agent_issues.py` with seed 20261118:
  - **Pilot:** 15 Lite and 15 Multilingual issues, drawn at random. They are never in the main sample.
  - **Main pool:** the other 570 issues, in a seeded random order that alternates the two benchmarks. The main sample
    is the first *n* issues of this pool, with *n* fixed after the pilot as described below.
- **Workspace.** The agent works on a snapshot of the repository at `base_commit`:
  - **Contents:** the experiment's corpus files (experiment 5: every `.py` file; experiment 8: the product's file
    selection) plus the top-level manifest and README files;
  - **Left out:** `.git` and the ground truth.

  Every tool indexes exactly these files.

## Arms (identical system and task prompts)

| Arm | Tools besides Read, Grep, Glob |
|---|---|
| A0 | none |
| A1 | `find_relevant_code` backed by TypeTrace's hybrid search **without** graph propagation; pointer output, at most 800 tokens |
| A2 | the same tool **with** graph propagation and relation lines (TypeTrace as shipped) |
| A5 | graphify 0.9.108's own MCP server, write tools denied |
| A6 | code-review-graph 2.4.0's own MCP server with its local embeddings, write tools denied |

- **Agent:** Claude Code, headless, model `claude-haiku-5-5`, effort high, 40 turns at most, 15 minutes at most per
  run.
- **Isolation:** the restricted-oauth profile of experiments 2 and 3.
- **Prompts:** `src/agent-eval/swebench/prompt.ts`. It is the experiment 3 prompt with the words "TypeScript
  repository" made language-neutral, plus an issue-report task prompt.
- **Answer:** an ordered list of code locations (experiment 3's schema).
- **Repeats:** 2 per issue and arm. Within an issue, the order of (arm, repeat) is seeded.

## Outcomes

- **Primary, per run:** a changed function is among the first three locations the agent lists (0 or 1). This is
  experiment 3's bug-localisation score. A run without a structured answer scores 0.
- **Primary, per issue:** the mean over its repeats.
- **Secondary:**
  - the same at 1 location and at any location;
  - the share of the changed functions listed;
  - total tokens per run (input, output and cache) and list-price cost;
  - turns and wall time;
  - whether the agent used the tool at all.

## Confirmatory tests

The unit is the issue. Tests are one-sided paired sign-flip permutation tests (exact up to 2^16 sign patterns, else
20,000 seeded flips), with 95% bootstrap CIs and Holm correction within each family:
- **Family A (accuracy, Holm over 4):** A2 > A0, A2 > A1, A2 > A5, A2 > A6.
- **Family T (tokens, Holm over 3, per-issue log ratio):** A2 < A0, A2 < A5, A2 < A6.
- **Reported with A2 > A0:** non-inferiority of accuracy, as the one-sided 95% lower bound against a margin of −0.05.

Everything else is exploratory:
- splits by benchmark, language and repository;
- A1 against A0;
- the competitors against A0;
- an account check: whether results differ between the two Claude logins (see Accounts).

## Pilot and sample size

The pilot runs all five arms with 2 repeats on the 30 pilot issues. It is used for three things only:
1. checking the harness on real issues;
2. measuring the time and usage per run;
3. estimating the standard deviation (SD) of the per-issue paired differences in the primary outcome.

No prompt, tool, arm or scoring change may follow from the pilot's accuracy numbers. Bug fixes are allowed, and each
one is logged in `decision-log.md`.

**Sample-size rule (fixed now):**
1. Take *s*, the larger of the pilot SDs of the per-issue differences A2−A0 and A2−A1.
2. Inflate it to its 80% upper confidence bound: *s*·sqrt((k−1)/χ²₀.₂₀,ₖ₋₁), where *k* is the number of pilot issues.
3. Set *n* = ⌈((z₀.₉₈₇₅ + z₀.₈₀) · *s* / 0.05)²⌉. This gives 80% power for a 0.05 difference at the strictest Holm
   level of family A (one-sided α = 0.05/4).
4. If *n* exceeds 570, the whole main pool is used and the achieved power is reported.

`scripts/swebench/agent_power.py` computes *n* from the pilot output. The value and the commit that adds it are
recorded in the decision log before the main run starts.

## Accounts, parallel runs and stopping

- **Accounts.** Runs use two of the owner's Claude Code logins in a fixed order, recorded as `login1` and `login2`
  (a Pro and a Team plan). The login names appear only on the command line and in the local approval file. When an account
  reports a usage limit, the runs move to the next one. When all are exhausted, the runner waits and tries again. A
  usage-limit stop is retried and is never counted as an attempt. Each run records its account by label, plan and a
  hash of the e-mail.
- **Parallel runs.** Up to 4 workers run different issues at once. A worker starts an issue only while at least 4 GB
  of memory is free, and index builds run one at a time. One shared query-embedding model serves every worker. The
  arm order is seeded within each issue, so no arm is tied to a worker or to a time of day.
- **Failures.** An infrastructure failure is retried once. A run with an init mismatch (wrong tools, model or
  version) stops the experiment.
- **Spend caps.** The approval file sets list-price caps in `APPROVAL.json`. The ledger is `spend-ledger.jsonl`.

## Stage 2: resolving the issue (planned; protocol to follow)

The owner asked for a second stage that measures whether the agent actually resolves the issue: it writes a patch,
and the SWE-bench test harness runs the issue's FAIL_TO_PASS and PASS_TO_PASS tests in Docker. This stage gets its own
protocol, committed before any stage-2 run. These parts are fixed now:
- **Primary outcome:** the resolved rate, per the SWE-bench harness, as an issue-level paired comparison.
- **Primary contrasts:** A2 against A0 and A2 against A1.
- **Issues:** drawn at random from the main sample.
- **Disk:** Docker images are built and removed per issue (about 58 GB free).

## Disclosures

- **Tuning:** TypeTrace's ranking was tuned on TypeScript (experiment 1) and is not re-tuned here.
- **Shared repositories:** some experiment-7 front-end checks used repositories that are also in SWE-bench
  Multilingual. They checked graph-edge precision only (see experiment 8's protocol).
- **Retrieval results known:** SWE-bench Lite's retrieval results (experiment 5) are known when this is written, and
  so is the partial Multilingual run (experiment 8). The issues and the ground truth were fixed before both.
- **Code freeze:** the commit that adds this protocol. Later changes go in `decision-log.md`, and earlier numbers are
  kept.
- **Losses:** a loss is reported as a loss.
