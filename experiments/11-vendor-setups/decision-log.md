# Experiment 11: decision log

Changes after the protocol was frozen (2026-11-20, before the pilot). None yet.

## Checks completed (not deviations)

- **E11-C01 (2026-11-20, during the pilot, before any T3 run was judged): key facts checked by hand.**
  - 28 of the 280 frozen questions (seed 20261120) were read against their reference answers. All 28 fact lists were
    faithful: atomic, nothing invented, nothing that changes the meaning.
  - One fact names a function (`morsel_to_cookie`, requests#40) that the reference describes only in words. That name
    is correct.
  - Automated check on all 280: 2,381 of the 2,396 code names in the facts appear in the reference answer. The other 15
    are reformatted code expressions, or names taken from the question.
  - No key fact was changed.

## Changes after the freeze

- **E11-D01 (2026-11-20, before any scored run): Bash in every arm, in Claude Code's sandbox.**
  - **What the frozen protocol said.** No Bash sandbox could start on this machine (Ubuntu's AppArmor restriction on
    user namespaces). So Bash was offered only in the graphify arm, limited to four graphify read commands.
  - **Why that was wrong.** It is not "each tool as its vendor ships it": every Claude Code user has Bash. It gave the
    arms different base tools. It also blocked the other commands graphify's skill names. A reader could fairly say
    the design handicapped graphify, and the other arms in the opposite way.
  - **Change.** The owner installed socat and an AppArmor profile that lets bubblewrap (only) create user namespaces.
    Every arm now has Bash, run in Claude Code's sandbox:
    - no network;
    - the owner's home folder, /tmp and other system folders unreadable, except the workspace, the run's temp folder
      and the arm's own pinned tool install;
    - writes only in the workspace, the run's temp folder and the tool's own HOME.
  - **Workspace changes.** The setup is committed in the workspace, so git status is clean in every arm. Files a run
    changes are recorded (`workspace_changes`) and undone with git before the next run. A workspace that cannot be
    restored stops the experiment.
  - **Fail closed.** `sandbox.failIfUnavailable` is set. A run whose transcript shows the sandbox disabled is excluded
    (`infra_error:sandbox`, not retried) and stops the experiment. A preflight before every runner start checks
    bubblewrap and socat.
    - The negative test (temp path too long for the sandbox's sockets) showed why the transcript check is needed:
      after a failed initialisation Claude Code turns sandboxing off for the rest of that session, despite
      `failIfUnavailable`.
    - The cause in that test (a long TMPDIR) is avoided: each run's TMPDIR is a short folder under /tmp.
  - **Re-checked.** Mock runs of all five arms passed `setup_check.py`:
    - setups delivered, no crossover;
    - no leak; the mock's attempt to read the owner's CLAUDE.md through Bash found nothing;
    - graphify's command line works inside the sandbox;
    - a test write was detected and undone.
  - **Run state when changed.** The pilot had started under the old design and was stopped while building the first
    issue's indexes, with no run scored. It restarts from the beginning.
  - **Not changed.** Tasks, ground truth, arms, prompts, scoring and analysis.

- **E11-D02 (2026-11-20, before any scored run): each workspace is the whole repository.**
  - **Before.** As in experiment 10, workspaces held only the indexed source files plus top-level manifests. A user's
    repository also has docs, configuration and data files. graphify's setup is built around more than code, and some
    SWE-QA reference answers cite docs, so removing them could handicap graphify on its own task (T3).
  - **Change.** Every arm's workspace is the full `git archive` of the repository at the item's commit, still with no
    history and no ground truth.
  - **Not changed.** The ground truth and the corpus each tool indexes (each tool's own file selection). Every arm sees
    the same files.
  - **Still not done.** graphify's optional LLM pass for documents, papers and images. It needs an API key, and
    graphify states that it does not change code nodes. graphify's graph is built with its own `graphify update .`
    (AST, no LLM), as its hooks rebuild it.

- **E11-D03 (2026-11-20, during the pilot): processes that linger after their result.**
  - **What happened.** In 3 of the first 83 pilot runs the Claude Code process did not finish promptly. One sent its
    final result and answer after about 30 s but never exited, and was stopped at the 900 s timeout as
    `infra_error:timeout`. Two spent 7 to 8 minutes before their sessions started (Claude Code's own session time was
    27 s and 34 s), with no tool errors.
  - **Change.** Once the final result has arrived, a process still running after 15 s is stopped, and the result is
    used (`lingered` is recorded). Wall time in the analysis is Claude Code's own session time (`session_ms`), not the
    process lifetime.
  - **Effect on the agent.** None: nothing the agent sees or does changes, and the scores are read from the result as
    before.
  - **The timed-out run** is retried as any infrastructure failure is (once).
  - **Amended the same day.** A TypeTrace run on vscode timed out after submitting its answer. Its result event appeared
    only when the timeout stopped the process, so Claude Code can linger before it writes the result, not only after.
    The 15 s grace now starts when the answer is accepted ("Structured output provided successfully"). SIGTERM then
    makes Claude Code write its result and exit, so the run is scored instead of being lost to a timeout.

- **E11-D04 (2026-11-20, during the pilot): memory.**
  - **What happened.** At 18:40 IST the machine ran out of memory. At that moment one worker was embedding django on
    the GPU, the other was running a TypeTrace session (its MCP server loads its own embedding model), an unrelated
    package test was running, and the owner had other work open. The kernel killed django's index build (retried) and
    processes in the owner's terminals. A TypeTrace MCP server then failed to start, which was recorded as an
    `init_mismatch` and halted the pilot at 138/300 T1 runs. No scored run was lost.
  - **Changes:**
    - An index build waits for 6 GB of free memory, and each run for 4 GB (before, only the start of an item was
      gated).
    - The runner's processes have `oom_score_adj` 700, so the kernel kills them before the owner's sessions.
    - An MCP server that fails to start is a retryable infrastructure failure (`infra_error:mcp_start`) and no longer
      halts the run.
  - **Record corrected.** The one record of this kind in `pilot-T1/excluded.jsonl` was reclassified (backup kept
    outside the repository).
  - **No effect on what the agent sees, or on scoring.**

- **E11-D05 (2026-11-20, pilot paused by the owner): absolute paths in records.** Error messages in `excluded.jsonl`
  quoted absolute paths of the owner's machine (as in experiment 10, E10-D07). They are shortened to
  repository-relative paths (`~/` outside the repository) in the pilot records, and the runner now does this when it
  writes any record. No other field changed. The original is kept outside the repository.

- **E11-D06 (2026-11-20, during the pilot): which TypeTrace build the TT and TS arms run; 0.3.2 merged.**
  - **The TT arm** ("as it ships today", written as 0.2.0 in the arms table) runs the same build as TS, 0.3.1, with
    `typetrace init --no-setup`. That writes only the index and the MCP entry, as 0.2.0 did. Between v0.2.0 and v0.3.1
    the product changed in two places only: `src/product/claude-setup.ts` (new; the setup, not written under
    `--no-setup`) and 13 lines of `src/product/cli.ts` (wiring the setup, and the query stamp that the hook reads).
    The search is the same code.
  - **0.3.2 (PyPI packages) was merged into main** on 2026-11-20 while the pilot ran. The arms run the compiled build
    in `dist/`, made from 0.3.1 before the pilot, and it is not rebuilt until experiment 11 ends. 0.3.2 would write
    byte-identical setups anyway: its two product changes apply only when the PyPI launcher sets `TYPETRACE_LAUNCH`
    and `TYPETRACE_HOOK_NODE`.
  - **Check.** The hashes of every file each installer wrote are in `setups.jsonl`.
    - In the first 81 pilot workspaces, every arm wrote one identical set of setup files (CLAUDE.md, `.claude/`,
      `.mcp.json`, `.gitignore`, git hooks) in every workspace.
    - `setups.jsonl` also listed some snapshot files as if an installer had written them: files with non-ASCII names
      (git quoted their paths) and, before the `git add -f` fix, files matching a repository's own `.gitignore`. The
      runner now reads git's raw paths, and comparisons of setups use the setup paths above.

- **E11-D07 (2026-11-21, during the pilot): answer paths scored wrongly in multi-package repositories.**
  - **The bug.** The scorer cut every answered path before its first `src/` (experiment 3's cleaning). For
    `gson/src/main/...` or `packages/material-ui/src/...` the cut path no longer matched the ground truth. File
    recall, T2's primary score, was 0 for correct answers, and in monorepos even function matching could fail.
  - **The fix.** `src/agent-eval/exp3/score.ts` `resolveFile`: the path as given wins when it names a corpus file; the
    old cleaning is only the fallback. The runner scores through `scripts/exp11/score.ts`, shared with
    `scripts/exp11/rescore.ts`.
  - **Pilot re-scoring** from the stored answers (`results/pilot-T*/rescore-E11-D07.jsonl`):
    - **T1:** 91 of 100 affected runs changed, all in file recall (0 → 0.78 on those runs). T1's primary score and
      accuracy were unaffected.
    - **T2:** re-scored when its pilot ends; its primary score is file recall.
    - The main run is scored with the fix from the start (about 28% of its T1 and T2 issues are in affected
      repositories).
  - **Experiment 10 was affected too** (E10-D08). Its every-arm top-3 level is 0.82, not the 0.81 this protocol quotes
    in "Why" and "The multi-file pool". On its single-file issues the share of changed functions listed is 0.79–0.80,
    not 0.78. The multi-file figure (0.40–0.42) is unchanged. The argument for the multi-file pool stands.

- **E11-D08 (2026-11-21, during the T3 pilot): two more lingering cases.**
  - **What happened.** A T3 run (sqlfluff#8, grep only) timed out at 900 s although its session took 22 s (Claude Code's
    own `duration_ms`). The grace stop of E11-D03 never fired, in this run or in any other T3 run (0 of 259). Two
    reasons:
    - Claude Code writes the `result` event with a different key order (`{"duration_api_ms":…,"type":"result"}`), so
      the check for a line starting with `{"type":"result"` never matched.
    - A session can stall after the model's StructuredOutput call and before any further output. The lines after the
      call (its tool result and the result event) then appear only when the process is stopped.
  - **Fix** (in `runClaude`, opt-in through `afterResultGraceMs`, so earlier experiments are unaffected):
    - the result event is recognised whatever its key order;
    - once the model has called StructuredOutput, a process that writes nothing for 4 × the grace (60 s) is stopped
      with SIGTERM, after which Claude Code writes its result.
  - **Tested with a fake Claude Code.** A stall after the answer call is stopped; a session that keeps writing after
    the call (for example a rejected answer being redone) is not stopped.
  - **No effect on what the agent sees, or on scoring.** The pilot's timed-out run is retried as before; the main run
    uses the fix.

- **E11-D09 (2026-11-21, T3 pilot): setup files ignored by the repository's own .gitignore.**
  - **What happened.** xarray's `.gitignore` ignores `.claude/` (a "# Claude Code" section). The setups' `.claude/`
    files were therefore not in the workspace's setup commit, and the reset after the first run with a setup removed
    them. The runner's restore check caught it at once and halted at 263/300 T3 runs.
  - **Effect on runs.** The run before the reset had its full setup; no run ran without one.
  - **Fix.** The setup paths (`.claude`, `CLAUDE.md`, `.mcp.json`, `.gitignore`, `graphify-out`) are added to the
    setup commit with `git add -f`; the tools' own data (`.code-review-graph/`) stays untracked.
  - **Check.** A mock run on xarray (TS, GF, CR, two repeats each) restored every workspace. The pilot was resumed.
