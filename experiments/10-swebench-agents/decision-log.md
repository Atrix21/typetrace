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
