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
