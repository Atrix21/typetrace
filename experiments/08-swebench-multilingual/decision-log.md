# Experiment 08: decision log

Every change to the code or the procedure after the protocol was committed (`12915e1`), with the reason and what was
checked. Earlier numbers are kept.

## E8-D01 (2026-11-18, before the scored run): the run uses the code at the commit that starts it

The owner approved the run on 2026-11-17, to start after experiment 5 finished. Between the protocol commit and the
start of the run, one change touches code the runner uses:

- `src/languages/python.ts`: the crash fix of experiment 5 (E5-D02). A class shadowed by a same-named function in
  the same file no longer makes the Python front-end throw. For every input on which the old code did not throw, the
  output is identical (checked on five snapshots by graph hash, see E5-D02). Python files are part of this
  experiment's corpus where a repository has them, because the corpus is the product's own file selection.

**The scored run started on 2026-11-18 at 04:03 IST from commit `3846da1`** (which includes E8-D02 below).

Everything else since the protocol commit is documentation, results of experiment 5, its analysis script, the package
version, and the run queue's new `multilingual` step. No retrieval output of this experiment existed before the run.
The ground-truth dry run (`--gt-only`) ran before the protocol was committed and involves no retrieval method.

## E8-D02 (2026-11-18, before the scored run): failures are recorded, not fatal

The run takes days and runs unattended, and several snapshots are large (31 instances have more than 3,000 corpus
files; the largest has 18,812). Before this change, any method that threw stopped the whole run, and a hung
competitor process stalled it with no limit. Two changes were made before the first scored instance:

- **Recorded failures.** If a method throws (in loading, `prepare` or `retrieve`), the error goes to `failures.jsonl`
  and the runner continues with the next method. No metrics row is written, so the instance lacks that method. If
  TypeTrace's graph build throws, that is recorded too, and the methods that need the graph then fail on their own
  and are recorded. A failed method is retried when the run resumes.
- **Time limit for competitor calls.** Each competitor subprocess call (graphify, code-review-graph) has a
  wall-clock limit of 3 hours, set by the queue step through `TYPETRACE_PY_TIMEOUT_MS`. Experiments 1 to 5 never set
  it, so their behaviour is unchanged.

**Analysis.** The pre-registered tests use the instances that have a row for every method, as in experiment 5. The
report lists every failure by method and stage, and the findings will say how many instances each method's failures
removed. If failures fall unevenly on one method, the findings will also report the tests on the instances that
method completed, as an exploratory check.

Checked on one instance (`gin-gonic__gin-1805`) with a deliberately unknown method name. The failure was recorded,
the run went on, and the other method's row was written.
