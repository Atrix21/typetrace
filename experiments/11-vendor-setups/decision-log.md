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
