# Experiment 10: decision log

Every change to the code or the procedure after the protocol was committed, with the reason and what was checked.

## E10-D00 (2026-11-18, with the protocol): harness changes, all opt-in

The protocol commit is also the code freeze. It adds these changes:

- `scripts/swebench/agent.ts`: the runner. It is experiment 3's harness generalised to SWE-bench issues, with
  parallel workers and account failover.
- `src/agent-eval/shared-embedder.ts`: one query-embedding model serves every worker. A daemon uses it only when
  `TYPETRACE_EMBED_URL` is set. The vectors come from the same server script, so they are identical.
- `src/retrieval/embeddings.ts`: a machine-wide lock around document embedding. It is on only when
  `TYPETRACE_EMBED_LOCK=1`.
- `src/agent-eval/exp3/daemon.ts` (`--files`) and `src/graph/build-cli.ts` (`--files-from`): an explicit corpus
  list. Without the flag, behaviour is unchanged.
- `src/agent-eval/swebench/prompt.ts`: experiment 3's prompts, made language-neutral.
- `src/agent-eval/exp3/daemon.ts` and `src/graph/build-cli.ts` load the tree-sitter grammars of their corpus before
  using it. Both were written for TypeScript (experiments 1 to 3), where no grammar is needed. On Python and the
  tree-sitter languages they failed outright (see the mock test below). For TypeScript, loading grammars changes
  nothing. Experiments 5 and 8 built their graphs in-process, where the grammars were already loaded. The Python
  graph that build-cli now produces for `pytest-dev__pytest-11143` matches experiment 5's (6,074 nodes, 24,235
  edges).
- `scripts/swebench/agent.ts` takes a machine-wide lock (`.cache/swebench-agent/runner.lock`), so a second runner
  cannot start while one is active. A failed graph build leaves no partial graph behind.
- `scripts/swebench/agent_leak_check.py`: scans the requests recorded in a mock run for user configuration.

None of these changes affects experiments 1 to 8, which never set the variables or flags.

Mock runs against the local fake API exercised the whole pipeline before any billable run:
- A0 on Python and Rust issues;
- failover from the first account to the second when the first reports a usage limit;
- all five arms, once experiment 8 finished (results below).

**Five-arm mock test (2026-11-18).** Run `mock-full`: three pilot issues in three languages (`pytest-dev__pytest-11143`
Python, `burntsushi__ripgrep-2576` Rust, `axios__axios-5892` JavaScript), all five arms, two workers in parallel.
- **First attempt:** the graph build and the retrieval daemon failed on the Python and Rust issues because the
  grammars were not loaded (fixed above). The JavaScript issue passed in all arms.
- **Second attempt:** two runners were started by mistake at the same time. They wrote to the same workspaces and
  failed. This is why the runner lock was added. A second launch is now refused.
- **Final run, from scratch:** 15 of 15 runs scored. Each arm called its own tool: `find_relevant_code` in A1 and A2,
  graphify's `query_graph` in A5, code-review-graph's tools in A6, none in A0. The agent tool returned results from
  the issue's own repository in all three languages. Every init fingerprint matched.

**Isolation check with the real account folders.** The billable runs use the owner's two Claude Code logins, whose
configuration folders hold a CLAUDE.md, skills, memory and MCP servers.
- **The runs as configured.** `agent_leak_check.py` scanned the 42 requests the agents sent in `mock-full`, which ran
  with the second login's folder. It searched them for every distinctive CLAUDE.md line of both logins and for
  skill and memory markers. There were no matches.
- **The same profile, per login.** `src/agent-eval/verify-isolation.ts --profiles restricted-oauth --conditions
  baseline` ran once with each login's folder (`CLAUDE_CONFIG_DIR`). With the isolation profile, neither request
  contained CLAUDE.md text, a skill listing or memory. The tools offered were exactly Glob, Grep, Read and
  StructuredOutput, plus Claude Code's empty `DeferredToolPlaceholder`, which is also present in experiment 3 and in
  every arm. The init fingerprint matched.
- **Positive control.** The same request **without** the isolation flags, for each login. The detectors found the
  CLAUDE.md text, the e-mail marker, the skill listing and memory in both. The second login also offered 27 tools,
  including unrelated MCP servers. So the detectors work, and the isolation is what keeps this configuration out.

Only redacted verdicts are kept. The raw requests of the positive control contain private configuration and are
not stored.

## E10-D01 (2026-11-18, during the pilot): 2 workers instead of 4, for memory

The pilot started at 22:33 IST with 4 workers. After about 85 minutes and 139 scored runs, the machine had about 1 GB
of memory available and its swap was full. Each worker holds one retrieval daemon per issue, and on the larger
Python repositories these grew to 1.2 to 3.2 GB each, next to a competitor index build and the owner's desktop
applications. The free-memory gate only applies when a worker starts an issue, so it could not prevent this.

The run was stopped cleanly with SIGTERM at 23:35 IST and resumed with 2 workers. The in-flight runs had not been
recorded, so they run again; nothing scored was lost or changed. An interrupted code-review-graph build is recorded as
a setup error, which counts against no run. The graph and daemon caches were deleted before resuming, so nothing
half-written is reused. The protocol allows up to 4 workers. The (arm, repeat) order is seeded within each issue,
so the number of workers changes only the speed. The main run will also use 2 workers unless a measurement shows
more fit in memory.

The failed attempts so far, recorded for the retry decision before the main run, are all on one issue
(`sympy__sympy-21379`): 6 with no result event (exit 0) across A1, A2, A5 and A6, and 1 crash (exit 1) under memory
pressure. In each case the model's response stream stopped and Claude Code exited without a result.

## E10-D02 (2026-11-19, after the pilot, before the main run): stalled responses get up to 4 attempts

**What failed in the pilot.** 298 of 300 runs were scored. 10 attempts failed, on 2 of the 30 issues:
- `sympy__sympy-21379`: 8 attempts across A1, A2, A5 and A6;
- `caddyserver__caddy-6350`: 2 attempts, in A2 and A6.

Nine of the ten were stalls. The model's response stream stopped, usually during a long thinking block, and Claude
Code exited 0 without a result event. The tenth was a crash (exit 1) under memory pressure (E10-D01). A stall is not
an outcome of the agent's work: a retry of the same run usually succeeded (for example `sympy__sympy-21379|A2|r2` on
its second attempt, with 22 turns). Two runs failed twice and were lost (`sympy__sympy-21379|A6|r1` and `|A5|r2`).
Each issue's other repeat of those arms was scored, so all 30 pilot issues have every arm.

**Why change the rule.** Stalls are more likely in long runs, so dropping runs after two stalls would drop long runs
selectively. That can differ by arm.

**The change.** From the main run on, a stall gets up to 4 attempts in all. Any other infrastructure failure is still
retried once, as pre-registered. This change follows from failure counts only, never from accuracy. It was tested
with a mock run seeded with failure records:
- two stalls: retried;
- one stall and one crash: retried;
- two crashes: not retried.

## E10-D03 (2026-11-19): main-run sample size from the pilot

`python3 scripts/swebench/agent_power.py experiments/10-swebench-agents/results/pilot` (30 issues, 298 runs):

| Paired difference (per issue) | SD |
|---|---:|
| A2 − A0 | 0.160 |
| A2 − A1 | 0.265 |

- The rule takes the larger SD, 0.265.
- Its 80% upper bound is 0.301.
- *n* = ⌈((z₀.₉₈₇₅ + z₀.₈₀) · 0.301 / 0.05)²⌉ = **346 issues**, below the 570 cap. Achieved power at *n*: 0.80.

The main sample is the first 346 issues of the main pool in `selection.json`: about 173 from Lite and 173 from
Multilingual, in alternating order. The run uses 5 arms × 2 repeats, 3,460 runs in all.

**What the pilot measured, besides the SD:**
- **Per run:** 40 s wall time and 100k tokens on average (mostly cache reads); $0.006 at list price (ledger total
  $1.77).
- **Account usage:** the first login's 7-day window went from 71% to 74% over the pilot. Its 5-hour window peaked
  near 61%.
- **Throughput with 2 workers:** about 2 runs per minute once the indexes are built.

The pilot's accuracy numbers were seen. Per the protocol, no prompt, tool, arm or scoring change follows from them.
They are not part of any confirmatory test.

## E10-D04 (2026-11-19, at the start of the main run): the pool excludes the issue without ground truth

The main pool in `selection.json` has 570 issues. One of them, `gohugoio__hugo-12204` (position 276), has no ground
truth: experiment 8 excluded it because its gold patch changes only an HTML template. The protocol leaves such
issues out of the data, so the eligible pool has 569 issues, and the main sample is its first 346. The first launch
(01:03 IST) counted the ineligible issue and would have run only 345. It was stopped within a minute, before any
agent run, and its empty results were deleted. The runner now drops ineligible issues before taking the first
*n*. The main sample is therefore pool positions 1 to 347 without position 276.

## E10-D05 (2026-11-19, 07:08 IST): Claude Code updated itself mid-run; the version is now pinned

At 07:07 IST the Claude Code auto-updater moved the `claude` on PATH from 2.1.327 to 2.1.328. The next run's init
event reported 2.1.328, and the runner stopped the experiment, as the protocol requires. At that point 779 of 3,460
runs were scored, all on 2.1.327. Two runs were cut off:
- `scikit-learn__scikit-learn-15535|A2|r2`: init mismatch at start, before any model call;
- `fluent__fluentd-3466|A0|r2`: in progress on the other worker, aborted by the halt.

No run was scored on 2.1.328.

**Changes before resuming:**
- **The version is pinned.** A copy of the 2.1.327 binary sits outside Claude Code's own versions folder. The
  runner starts with that copy first on PATH, `AGENT_EVAL_CLAUDE_BIN` pointing at it, and `DISABLE_AUTOUPDATER=1`.
- **A resume checks the version.** The runner already refused to resume with a different model, arms or issues.
  It now also refuses a different `claude_version` from the one in `plan.json`. Before this, a resume after an
  update would have carried on under the new version without warning. The check was tested: with 2.1.328 on PATH,
  a resume is refused.
- **A version-only mismatch doesn't end a run.** The runner treated every init mismatch as final for that run. When
  the only mismatch is the version, the cause is the installed binary changing, not the run itself. Such a run is
  now neither final nor a counted attempt, so the scikit-learn run above is redone on 2.1.327. Init mismatches in
  tools, model or MCP servers stay final.

No prompt, tool, arm, scoring or analysis change.

## E10-D06 (2026-11-19, 09:35 IST): the disk filled; per-issue indexes are now deleted after each issue

At 09:35 IST the laptop's disk ran out of space, and the runner exited at 1,024 of 3,460 runs scored. When an issue
finished, the runner deleted its workspaces but not its indexes: our graph and daemon cache, and the graphify and
code-review-graph builds. These folders are rebuilt from scratch for every issue and never read afterwards, but
they piled up at about 420 MB per issue: 57 GB over 136 issues.

**What was affected:**
- **Issue setups.** Seven failed in the last three minutes: three code-review-graph builds and four snapshots. All
  are recorded as retryable setup failures. They don't count against any run's attempts, and their runs are pending.
- **One record.** The last line of `excluded.jsonl`, the setup failure of `matplotlib__matplotlib-25332`, was cut off
  mid-write. It was completed from its own prefix and the fixed snapshot path (`snap/<issue>`) and carries a
  `repaired` field. A copy of the files as they were is kept outside the repository.
- **Scored runs: none.** The last four scored runs before the stop (`fmtlib__fmt-3901`) all score 0. They were
  checked: the four answers are complete and agree with each other, and the miss is in the issue, not the disk.
  The tool-call counts of the runs just before the stop match the pattern of the whole run and of the pilot.
- **An orphaned retrieval daemon.** It was stopped.

**The change:** an issue's index folders are added to the folders deleted when the issue ends. Nothing reads them
after that, so no run changes. Two main-sample issues share a snapshot (`sympy__sympy-21612` and
`sympy__sympy-21614`, 46 positions apart). With the change, the second builds its own graph instead of reusing the
first one's, like every other issue. The leftover folders (57 GB) were deleted before resuming.

No prompt, tool, arm, scoring or analysis change.

## E10-D07 (2026-11-20, 05:19 IST): run finished; absolute paths shortened in excluded.jsonl

The main run finished at 05:19 IST with 3,460 of 3,460 runs scored (346 issues × 5 arms × 2 repeats), all on the
first login. Before publishing, the absolute paths in `results/main/excluded.jsonl` (the local scratch folder and
the competitor adapter, inside error messages of failed issue setups) were shortened to repository-relative paths.
No other field and no scored run changed; the original file is kept outside the repository. The analysis ran
unchanged: `python3 scripts/swebench/analyse_agents.py experiments/10-swebench-agents/results/main`.

## E10-D08 (2026-11-21, after the findings were published): scoring correction

- **The bug.** The answer scorer (`src/agent-eval/exp3/score.ts`, inherited from experiment 3) cleaned every answered
  path by cutting it before its first `src/`. In repositories whose code sits under `<package>/src/`, this made some
  correct answers ambiguous, and they scored 0.
- **Found in experiment 11's pilot (E11-D07) and fixed.** The path as given now wins when it names a corpus file; the
  old cleaning is only the fallback.
- **Re-scoring.** Every experiment 10 run that could be affected (444 of 3,460: those listing a path the old cleaning
  changed) was re-scored from its stored answer against an index rebuilt at the issue's commit
  (`scripts/exp11/rescore.ts`; `results/main/rescore-E11-D07.jsonl`).
- **Effect.** Five issues had been scored 0 in every arm and repeat although the answer was right: babel-16130,
  preact-3345, preact-3567, preact-3689 and axum-1119.
  - Every arm's top-3 score rises by the same 0.012: grep alone 0.812 → 0.824, TypeTrace 0.809 → 0.821.
  - Top-1, "any position" and the share of changed functions listed rise slightly, and three rows of the language
    table change (TypeScript, JavaScript, Rust).
  - No paired difference, confidence interval, p-value or non-inferiority result changes, because the correction is
    identical across arms. The conclusions stand.
- **Records.** `results/main/report.md` is kept as first computed. `results/main/report-corrected.md` is
  `analyse_agents.py --apply rescore-E11-D07.jsonl`. `findings.md`, the README and the paper now use the corrected
  figures.
