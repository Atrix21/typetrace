# Experiment 05: decision log

Every change to the code or the procedure after the protocol was committed (`5197c03`), with the reason and what was
checked. Earlier numbers are kept.

## E5-D01 (2026-11-17, before the scored run): the run uses the code at `cbe5b7c`

The scored run started from `cbe5b7c` (experiment 6 findings), not from the protocol commit. Between the two, these
changes touch code the runner uses. All of them leave outputs unchanged:

- `src/retrieval/graph-engine.ts`, `hybrid-retrieval.ts`, `compact-context.ts`: three query-time speed fixes from
  experiment 6 (lookups that were rebuilt on every query or comparison are now built once). Output was checked byte for
  byte against stored outputs on the experiment 3 TypeScript tasks (158 method–task outputs, all identical;
  [experiment 6](../06-next-direction/findings.md)).
- `src/retrieval/embeddings.ts`: an optional progress display for the product CLI (off on the benchmark path) and a
  clearer error message.
- `src/competitors/code-review-graph-adapter.ts`: the helper embedding server no longer keeps the process open after the
  run ends.
- `src/graph/graph-builder.ts`: merging graphs of mixed-language repositories. This runner calls the Python front-end
  directly and does not use it.

The only output before the scored run was a one-instance smoke test (`astropy__astropy-12907`, `bm25` only). It was
discarded and is not in the results.

## E5-D02 (2026-11-17, during the run): crash fix in the Python front-end

**What happened.** The run stopped on instance 225 of 300 (`sympy__sympy-11870`) with
`TypeError: Cannot read properties of undefined (reading 'file')` in `buildPythonGraph`. A file in that snapshot defines
a class and later a function with the same qualified name. Declarations are kept per file by qualified name, so the
function replaced the class there. The class's base-class list still pointed at the class, and the look-up of the class
returned nothing.

**Change.** The base-class list now keeps the class's own declaration, so the look-up can no longer fail
(`src/languages/python.ts`). The shadowed class gets its EXTENDS edges like any other class.

**Why the completed instances are unaffected.** For every input where the old code did not throw, the look-up returned
the same declaration that is now stored. Same id, same file, same scope, so the output is identical. Checked by building the
graph with the old and the new code on five completed snapshots (`psf__requests-2317`, `pallets__flask-4045`,
`django__django-11099`, `matplotlib__matplotlib-23314`, `sympy__sympy-11400`): the SHA-256 of nodes plus edges is equal,
and the node and edge counts match `results/graphs.jsonl`. The old code still throws on `sympy__sympy-11870`. The new
code builds it.

**Effect on the run.** The 224 instances scored before the crash (all 9 methods each) are kept as they are. The run
resumed from instance 225 with the fix. `tasks.jsonl` has a second row for `sympy__sympy-11870`, because the runner had
written the task before the crash. The analysis uses the first row per instance (both rows are identical).

## E5-D03 (2026-11-17, during the run): two pauses, no code change

The run was paused twice on the owner's request. Neither pause changed code or settings.

- **12:41 IST, between instances,** at 243 of 300, for a laptop shutdown. It resumed at 14:00 from the same tree.
  The results file was compared with a backup before resuming and was identical.
- **18:09 IST, mid-instance,** at 271 of 300. The machine was short of memory, so the run was stopped at once,
  while `sympy__sympy-18835` was being scored. Seven of its nine methods were already scored. code-review-graph was
  building its index when the run stopped. Every results line was checked and was complete. Before the run resumed
  at 22:15, that half-written code-review-graph index (`.cache/swebench/run/sympy__sympy-18835/crg`, with its write
  lock still in place) was deleted. Both code-review-graph methods therefore built a fresh index, as they do for
  every instance. The seven scored rows were kept. The runner wrote `tasks.jsonl` again for this instance on resume,
  so that file holds a second, identical row for it, as for `sympy__sympy-11870` (E5-D02). The analysis uses the
  first row per instance.
