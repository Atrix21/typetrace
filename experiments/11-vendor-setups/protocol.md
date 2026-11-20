# Experiment 11: each tool as its vendor ships it, on each tool's own kind of task

Status: approved by the owner on 2026-11-20 and frozen before the pilot (the commit that adds this line). Changes after
the freeze go to `decision-log.md`.

## Why

The competitive claim is that TypeTrace finds the right code better than graphify and code-review-graph. Two gaps
weaken every comparison so far:

1. **The task was always ours.** Experiments 1, 3, 5 and 8 measured finding the code for a bug report or a code
   question, scored our way. That is TypeTrace's home task. Neither competitor is built for it:
   - graphify is built for understanding a codebase. Its own code benchmark is an agent answering questions about
     ERPNext, graded by how many key facts of a reference answer it covers.
   - code-review-graph is built for reviewing changes. Its own non-circular benchmark is co-change: given one file
     of a real commit, find the other files the author changed.
2. **In the agent experiments the competitors ran stripped.** Experiments 2, 3 and 10 gave every arm a bare MCP
   server and removed all skills, instructions and hooks. That is equal treatment, but both competitors ship an
   installer for Claude Code that adds a skill, project instructions and hooks that steer the agent toward the graph.
   In experiment 10 the agent called graphify in 17% of runs and code-review-graph in 18%, against 98% for TypeTrace.
   Their scores there mostly measure grep.
3. **The issues were too easy to separate the arms.** In experiment 10 every arm, grep alone included, found a
   changed function in the top three on 81% of issues (see the multi-file pool below).

This experiment tests each tool **as its vendor ships it for Claude Code**, on **three kinds of task, one from each
tool's home ground**, with each tool's own way of scoring where it has one.

## Questions

1. On each of the three tasks, does an agent with TypeTrace find more of the right code (or cover more of the right
   answer) than the same agent with graphify, and than with code-review-graph, each set up as shipped?
2. Is any difference also visible in accuracy (the right answer among the agent's first few)?
3. Does the answer change when TypeTrace gets the same kind of setup the competitors give themselves (a skill,
   project instructions and a hook that nudges toward the tool)?
4. What does each setup cost in tokens, and how often does the agent use the tool?

Questions 1 and 2 are asked twice:
- **as shipped today:** TT against GF and CR;
- **like for like:** TS, TypeTrace with its own setup, against GF and CR.

They are tested in both directions: a competitor winning on its own task is a result, not a failure.

## Arms

All arms use the same model, effort, prompts per task, turn cap and base tools. They differ only in what each
vendor's installer adds.

| Arm | Tool and version | Setup |
|---|---|---|
| G0 | none | Claude Code's base tools only. The baseline. |
| TT | TypeTrace as it ships today (0.2.0) | `typetrace init`: the index plus the MCP entry in `.mcp.json`. It writes no skill, no instructions and no hooks. |
| TS | TypeTrace 0.3.0 (setup unchanged in 0.3.1), the release that adds a Claude Code setup | `typetrace init` with default options: the same index and MCP entry, plus a CLAUDE.md block, one skill and a soft PreToolUse hook, under the rules below. |
| GF | graphify, the release current at the freeze (0.9.113 on 2026-11-20) | Its two documented Claude Code steps with default options: `graphify install --platform claude` (the skill and a line in the user-level CLAUDE.md) and `graphify claude install` (the project CLAUDE.md section and its PreToolUse and SessionStart hooks). This setup has no MCP server: the skill, the instructions and the hooks direct the agent to graphify's command line through Bash. Graph built by `graphify .` (code only: the LLM pass covers documents, needs an API key, and does not change code nodes). |
| CR | code-review-graph, the release current at the freeze (2.4.0 on 2026-11-20) | `code-review-graph install --platform claude-code -y`: the MCP entry, the instruction block in CLAUDE.md, its four skills, its PostToolUse and SessionStart hooks, and its git hooks. Graph built by `build`, with embeddings as in experiments 8 and 10. |

**What the installers wrote** (captured 2026-11-20 in a throwaway repository with an empty HOME):

| | Always in context | Loaded when used | Hooks |
|---|---|---|---|
| GF | project CLAUDE.md section (198 words), user CLAUDE.md line (29 words), skill description (50 words) | skill body, 6,508 words, plus 8 reference files | PreToolUse on Bash/Grep and Read/Glob: a soft nudge, at most 5 per session and agent, none after the first while a query is under 30 minutes old; SessionStart on compaction resets the count |
| CR | CLAUDE.md block (308 words), 4 skill descriptions (about 10 words each) | 4 skill bodies, 173 to 220 words each | PostToolUse on Edit/Write rebuilds the graph; SessionStart prints the graph status. No nudge (that is the non-default `--steering`) |
| TS (0.3.0) | CLAUDE.md block (146 words), skill description (41 words) | skill body, 288 words | PreToolUse on Grep/Glob/Read and search commands in Bash: graphify's mechanism and cap; a 49-word nudge (graphify's is about 55) |

**Adapting the captured setups to the run** (the only changes; each is mechanical and applied to every arm alike):
- Commands are pointed at the pinned installs: graphify's hooks name the absolute path of whichever `graphify` was
  on the PATH, and code-review-graph's MCP entry starts `uvx code-review-graph serve`, which would download the
  latest release at run time. Both are replaced by the pinned virtual environment's binaries. The `cwd` is replaced by
  the run's workspace.
- Every workspace is a git repository with one commit holding the issue's snapshot and no history. code-review-graph's
  SessionStart hook and git hooks expect one, as on a user's machine.
- Each tool's hook state is reset before every run: graphify's `graphify-out/cache/` stamps and counters, and
  TypeTrace's `last_query` stamp and `hooks/` counters. Each run starts like a new session. These files, the graphs and
  `.code-review-graph/` are excluded from the workspace hash check; any other change still stops the experiment.

- **Rules for TypeTrace's setup (TS).** The setup copies the mechanisms the competitors' default installs use,
  without going further:
  - **Same parts:** one skill, one block of project instructions, and one PreToolUse hook that nudges toward the
    tool before searches and reads. The hook never denies a call, as in both competitors' default modes.
  - **Same strength:** the hook nudges at most 5 times per session, graphify's default cap.
  - **No longer than theirs:** the always-loaded text (instructions plus skill description) is no longer than the
    longer of the competitors' (code-review-graph's, about 350 words), and the skill body no longer than the longer
    of theirs (graphify's).
  - **Generic:** it is written as product text for any repository and any coding task. It names no benchmark, task
    type, answer format or score, and is written before any pilot of this experiment.
  - **Released:** it ships in a public `typetrace-cli` release, installed by `typetrace init`, before the freeze. It
    is captured from that installer like the others and never changed after the freeze.
  - **Reviewable:** the setup text is reported in full in the findings.
- **Base tools in every arm:** Read, Grep, Glob, Bash, the Skill tool and StructuredOutput. Bash is needed because
  graphify's Claude Code setup works only through its command-line tool. It runs in Claude Code's sandbox (no network, no writes
  outside a scratch folder). The workspace hash check from experiment 10 stays: a run that changes the workspace
  stops the experiment.
- **Capturing each setup:** each installer runs once, in a clean copy of a throwaway repository with an empty HOME.
  Every file it writes, at project and at user level, is recorded with its hash. The recorded set is the arm's
  frozen setup and is copied into each run's workspace. An installer that needs a user-level file gets it in the
  run's own config folder, never the owner's.
- **Versions:** each tool's latest release at the freeze, recorded with its commit. The adapters from experiments 8
  and 10 are rechecked against it.
- **Model:** Claude Haiku 5.5, effort high, 40 turns, as in experiment 10. Claude Code is pinned to one version for
  the whole run (E10-D05).
- **No sensitivity arms** (decided by the owner on 2026-11-20). graphify's `--strict`, which denies Read and Grep
  until the graph has been queried, and code-review-graph's `--steering` are not their defaults and are not run.

## Harness, as built and checked before the pilot (2026-11-20)

These points settle details the draft left open. They are fixed before any agent run, and each is checked in mock
runs with `scripts/exp11/setup_check.py`.

- **Loading the setups:** Claude Code runs with `--setting-sources project`. Each workspace's own CLAUDE.md,
  `.claude/skills/` and `.claude/settings.json` hooks load; user-level ones never do. Reads outside the workspace are
  blocked (`permissions.blockReadsOutsideWorkingDirectories`). `scripts/exp11/probe_isolation.ts` verified each point.
- **Installers run in each workspace.** The real installers run in every workspace, with a throwaway HOME (TypeTrace
  0.3.1 from this repository, graphify 0.9.113 and code-review-graph 2.4.0 from pinned virtual environments). graphify
  installs its skill at project scope (`graphify install --project`), its documented option. The hashes of every file
  each installer wrote are recorded in `setups.jsonl`.
- **Bash.** Claude Code's Bash sandbox cannot start on this machine: Ubuntu's AppArmor restricts unprivileged user
  namespaces, and lifting that needs root. So no arm runs arbitrary commands.
  - In the graphify arm, Bash is allowed only for the commands graphify's setup tells the agent to run: `graphify query`,
    `path`, `explain` and `section`. They only read the graph.
  - Every other arm has no Bash tool. Read, Grep and Glob are in every arm.
  - Each tool keeps its own interface: MCP for TypeTrace and code-review-graph, the command line for graphify.
- **Tool homes.** graphify and code-review-graph always run through wrappers with their own HOME. This applies to
  their installers, their hooks and graphify's command line. graphify's command line otherwise reads `~/.claude/skills`
  and refreshes old copies of its skill there.
- **Pinned commands.**
  - code-review-graph's installer writes `uvx code-review-graph serve`, or `<its python> -m code_review_graph serve`
    when uvx is absent. Both are replaced by the pinned install.
  - Its write-capable MCP tools stay denied, as in experiments 8 and 10.
  - TypeTrace's MCP entry is used as written.
- **Prompts.** The task instructions are appended to Claude Code's own system prompt, as a user's would be. They name no
  tool and do not ask the agent to use one; experiment 10's instruction to use the MCP tool first is gone. Steering is
  left to the setups. The prompts and schemas are in `scripts/exp11/prompts.ts`.
- **No owner data.**
  - Claude Code shows the git user in its context, so each workspace has a neutral git identity and the global git
    configuration is hidden.
  - In mock runs of all three tasks and all five arms, no line of the owner's CLAUDE.md files, none of the owner's
    skills, no memory marker and nothing on the private-pattern list reached the model.
  - The positive control, user-level settings switched on, detected all four kinds.
- **Setups delivered, no crossover:** checked per arm in the same mock runs (instructions, skill listing, hook text, MCP
  tool, Bash in every arm, sandboxed: see E11-D01).
- **Hook state reset** before every run (graphify's stamps and counters, TypeTrace's query stamp and counters).
- **TypeTrace versions.** 0.3.0 shipped the setup on npm on 2026-11-20. 0.3.1 changes only the MCP Registry name, so
  the TS arm's setup is 0.3.0's.

## Isolation and setup checks (before any billable run)

The owner's own Claude configuration must not reach any arm. Each vendor's setup must reach its own arm, and only
that arm.

1. **No leaks.** The leak check from experiment 10 runs on mock-recorded requests of every arm and finds none of the
   owner's CLAUDE.md lines, skills or memory. Its positive control, isolation turned off, must still detect them.
2. **Setup delivered.** In the mock recordings:
   - GF and CR requests contain their skill listings and instruction text;
   - their hooks fire, checked by a hook log;
   - TT and TS requests contain the TypeTrace MCP tool;
   - TS requests also contain its skill listing and instructions, and its hook fires;
   - G0 requests contain none of these.
3. **No crossover.** No arm's request contains another arm's skill, instruction or tool.
4. **End to end.** Every arm, on every task, completes a mock run in Python and in at least two other languages.

## Tasks

Each task has its own frozen ground truth, derived before any run, and its own pilot.

### The multi-file pool (T1 and T2)

Experiment 10 showed why single-file issues cannot separate the arms. On its 312 issues whose fix changes one file,
every arm found a changed function in the top three 81% of the time and listed 78% of the changed functions. On its
34 issues whose fix changes two or more files, the agent listed only 41% of the changed functions, again the same in
every arm. A tool that follows the code across files has room to help there. T1 and T2 therefore both draw on issues
whose fix changes **at least 2 non-test files** (decided by the owner on 2026-11-20).

- **Sources** (counts of multi-file instances, checked 2026-11-20):
  - **SWE-bench**, full test split, Python, outside Lite: 571 instances from 12 repositories;
  - **SWE-PolyBench** (Amazon, MIT licence), test split: 1,079 instances. They comprise 361 TypeScript, 545
    JavaScript, 101 Java and 72 Python instances, from 20 repositories.
- **Excluded:**
  - the 4 SWE-PolyBench instances that are also in SWE-bench Multilingual (experiments 8 and 10 used them);
  - test files, by the path rule of experiments 5 and 8;
  - repositories too large to index within the per-issue time budget. The cap is set from index build times
    measured in preparation and frozen before sampling. Experiment 3 indexed 763k lines; microsoft/vscode is the
    likely exclusion;
  - very large changes: a ground truth of more than 30 functions or more than 10 files. Such a change is a refactor
    or a feature, not a place to find, and every arm would score near 0. An example is a trino instance with 303
    functions in 34 files. The bounds are fixed from the ground-truth distribution alone, before any run.
- **Scripts:**
  - `scripts/exp11/select_pool.py` freezes the seeded order (`pool-order.json`: 1,400 instances, 639 Python, 327
    TypeScript, 342 JavaScript and 92 Java);
  - `scripts/exp11/prepare_pool.ts` derives the ground truth along that order. It reproduced experiment 8's frozen
    ground truth exactly on 8 of 8 gson instances checked;
  - `assign_pool.py` (to write) applies the caps and assigns the pilots, T1 and T2.
- **Sampling:**
  - stratified by language (Python, TypeScript, JavaScript, Java), aiming at equal shares;
  - at most 15% of a task's items from one repository;
  - seeded and frozen;
  - T1, T2 and their pilots get disjoint sets. No instance is in two of them.
- **Held out:** no experiment has run on any of these instances.

### T1: find the code to change for an issue (TypeTrace's home task)

- **Data:** a sample of the multi-file pool, as above.
- **Prompt and answer:** experiment 10's prompt and answer schema. The answer is an ordered list of functions.
- **Ground truth:**
  - the functions the gold patch changes, derived by the frozen pipelines of experiments 5 (Python) and 8 (other
    languages);
  - SWE-PolyBench's own `modified_nodes` are reported as a cross-check, not used for scoring.
- **Primary score:** function recall, the share of changed functions the answer lists. It was 0.41 on experiment 10's
  multi-file issues.
- **Accuracy:**
  - a changed function among the first three (confirmatory);
  - a changed function first (secondary; experiment 10's only interval that excluded zero, so it is reported for
    every arm).
- **Secondary:** file recall, the share of changed files with at least one listed function.

### T2: change impact (code-review-graph's home task, its own co-change design)

- **Data:** a second sample of the multi-file pool, disjoint from T1.
- **Prompt:** the issue and the gold patch's diff of one seed file (the file with the most changed lines; ties by
  path). "This change is being made. Which other files and functions must also change?"
- **Ground truth:** the other files and functions the same patch changes, seed excluded. This is the ground truth
  code-review-graph's own documentation calls the independent one: it comes from the author, not from any graph.
- **Primary score:** file recall, the share of the other changed files the answer lists. This is code-review-graph's
  own unit.
- **Secondary:** function recall.
- **Accuracy:** one of the other changed files among the first three.

### T3: answer questions about a codebase (graphify's home task, its own metric)

- **Data:**
  - SWE-QA (v2, ACL 2026 Findings): 720 human-checked question and answer pairs from 15 Python repositories,
    balanced across What, Why, Where and How questions;
  - Apache-2.0 licence (Hugging Face `swe-qa/SWE-QA-Benchmark`, checked 2026-11-20);
  - the repositories are pinned to the commits the dataset used, from the authors' `repo_commit.txt`
    (github.com/peng-weihan/SWE-QA-Bench at commit c13deac). Dataset revision f048f07 on Hugging Face; file hashes
    recorded;
  - the reference answers are long (median 261 words), so key facts are many per question;
  - graphify's own six ERPNext questions are not added (decided by the owner on 2026-11-20: too few to test, and
    one more large repository to index for every arm).
- **Prompt:** the question. The answer is free text plus the code locations it relies on.
- **Score:** key-fact coverage, graphify's own metric.
  - **Key facts:** each reference answer is split into atomic key facts once, before any run, by a frozen prompt to
    Claude Sonnet 5.5. A random 10% is checked by hand against the reference answers.
  - **Judge:** Claude Sonnet 5.5 (not the agent's model) marks each key fact as covered or not. It sees the
    question, the facts and the answer, never the arm.
  - **Judge reliability:** a random 10% of answers is judged twice, and the agreement is reported.
- **Secondary score:** SWE-QA's own judge prompt, from the authors' `llm-as-a-judge.py`. It rates correctness,
  completeness and three more dimensions against the reference answer, 1 to 20 each. The prompt is unchanged, but the
  judge is Claude Sonnet 5.5 instead of the authors' GPT-5.
- **Disclosure:** this is the only task scored by an LLM judge. Our earlier experiments avoided judges. T3 uses one
  because it is graphify's own scoring and the task has no exact ground truth.

## Outcomes

- **Per run:** the task's primary score and accuracy, as above. A run without an answer scores 0.
- **Per item:** the mean over its 2 repeats.
- **Secondary:**
  - total tokens per run (input, output and cache) and list-price cost;
  - turns and wall time;
  - whether the agent used the arm's tool;
  - each tool arm against G0.

## Confirmatory tests

The unit is the item (issue or question). Tests are paired sign-flip permutation tests (exact up to 2^16 sign
patterns, else 20,000 seeded flips), **two-sided**, with 95% bootstrap CIs and Holm correction within each family:

- **Family R1, as shipped (primary score, Holm over 6):** TT against GF and TT against CR, on T1, T2 and T3.
- **Family R2, like for like (primary score, Holm over 6):** TS against GF and TS against CR, on T1, T2 and T3.
- **Family A1, as shipped (accuracy, Holm over 4):** TT against GF and TT against CR, on T1 and T2.
- **Family A2, like for like (accuracy, Holm over 4):** TS against GF and TS against CR, on T1 and T2.

T3 has no accuracy measure apart from coverage.

A difference counts in whichever direction it falls. Everything else is exploratory:
- TS against TT (what the setup does for TypeTrace);
- tokens and cost;
- tool use;
- each arm against G0;
- the sensitivity arms;
- splits by language, repository and question type.

## Pilot and sample size

- **Pilot:** about 30 items per task that are not in the main samples, 5 arms × 2 repeats.
- **Sample size:**
  - The pilot's SDs set *n* per task with experiment 10's rule: detect a 0.05 difference with 80% power, using the
    80% upper bound on the SD and the Holm-adjusted level of the family's first test.
  - *n* is capped at 250 items per task.
  - Experiment 10's 34 multi-file issues give a first estimate. The SD of the paired recall differences between
    TypeTrace and the other arms was 0.08 to 0.12, which gives *n* of roughly 40 to 110. The top-3 accuracy SD was
    about 0.23, which needs more.
- **Rough scale:** at about 150 items per task, 450 items × 5 arms × 2 repeats ≈ 4,500 runs. At experiment 10's speed
  that is about a day and a half, plus waits at account usage limits.
- **Pilot accuracy:** seen but not acted on, as in experiment 10.

## Accounts, parallel runs, failures and spend

As in experiment 10:
- the logins in a fixed order with failover;
- 2 workers;
- index builds one at a time;
- each issue's indexes deleted when it ends (E10-D06);
- stalls retried up to 4 attempts (E10-D02);
- any init mismatch stops the run;
- spend caps set in the local approval file.

## Fairness rules

1. Every tool gets its vendor's default Claude Code setup, captured from its own installer, never written by us.
2. TypeTrace is tested twice: as it ships today (TT), and with a setup of the same kind and strength as the
   competitors' (TS). The TS setup obeys the rules under Arms, ships in a public release, and is never tuned on
   this experiment's data.
3. Every task is scored the same way for every arm. Two of the three tasks and scores come from the competitors'
   own benchmarks.
4. Versions, setups and ground truth are frozen and hashed before the pilot.
5. When the repository is public, the protocol and setups are published before the main run. The competitors'
   authors can then point out a wrong setup in time.

## Open decisions for the owner

Decided:
- 2026-11-19: TypeTrace is tested both as it ships today (TT) and with its own setup (TS).
- 2026-11-20:
  - T1 and T2 use multi-file issues from SWE-bench and SWE-PolyBench;
  - no sensitivity arms;
  - SWE-QA only, without the ERPNext questions.

- 2026-11-20: the owner approved the TS setup, the 0.3.0 release, the pilot and the main run ("do all of it").
  0.3.0 was released the same day.

Nothing is open. The sample sizes follow from the pilot by the rule above.
