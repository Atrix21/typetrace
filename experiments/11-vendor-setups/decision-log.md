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
