# Experiments

Each experiment answers one question. Each has a protocol written before its runs, and a decision log for anything
changed afterwards. Findings report losses and null results alongside wins. The paper draft in [`../paper/`](../paper/)
draws on all of them.

| # | Question | Data | Main result | Where |
|---|---|---|---|---|
| 1 | Does graph-augmented retrieval find a bug's code better than flat search and two code-graph tools? | nestjs-boilerplate (6k lines), 20 injected bugs, 14 held out | Hybrid Recall@10 0.67 against 0.47 for embeddings; call-graph traversal is the component that matters (−0.24 when removed) | [`../research/findings.md`](../research/findings.md) |
| 2 | Does that make a coding agent better at diagnosing bugs? | same 14 test bugs, Claude Code (Sonnet), 1,176 runs | No: the agent was at ceiling with grep and never chose a retrieval tool. With no tools, context quality mattered (31–33% → 71–98%) | [`02-agent-diagnosis/findings.md`](02-agent-diagnosis/findings.md) |
| 3 | Does the graph matter more as repositories grow, and does it help an agent at scale? Head-to-head with graphify and code-review-graph | 6k / 63k / 763k-line TypeScript ladder, 64 audited tasks; 918 agent runs | Retrieval: ahead of both competitors everywhere (16 of 18 comparisons p ≤ 0.001); graph +0.24 / +0.05 / +0.16. Agent: 18–28% fewer tokens than grep alone in all five runs, no replicated accuracy gain | [`03-graph-scale/`](03-graph-scale/README.md), results in the top-level README |
| 4 | What do the search components score on LOCOMO, the conversational benchmark graphify quotes? | LOCOMO, 1,536 questions, open protocol | BM25 0.540, BM25 + our embedding model 0.635, + a reranker we do not ship 0.745; not comparable with graphify's 0.497 | [`04-locomo/`](04-locomo/README.md) |
| 5 | Does the lead hold on Python, on a public benchmark chosen by others? | SWE-bench Lite, 300 issues | Ahead of both competitors (P1, P2 supported); the Python graph adds nothing (P3 not supported, −0.018) | [`05-swebench-python/findings.md`](05-swebench-python/findings.md) |
| 6 | Is there a next accuracy improvement (change history, commit titles, reranking, …)? | development data, then one held-out test | None found: the reranker failed its held-out test. Queries became 13–46× faster with byte-identical output | [`06-next-direction/findings.md`](06-next-direction/findings.md) |
| 7 | Are the new language front-ends' graphs correct? | 13 open-source repositories, 11 languages | 151 of 156 hand-checked verified call edges correct | [`07-languages/`](07-languages/README.md) |
| 8 | Does the lead hold in nine other languages? | SWE-bench Multilingual, 300 issues | Done: ahead of both competitors (Holm p = 0.0001 each); the graph adds nothing (−0.002) | [`08-swebench-multilingual/findings.md`](08-swebench-multilingual/findings.md) |
| 9 | How much does the product's fast first index (no embeddings yet) lose? | experiment 3's tasks on the 6k / 63k / 763k-line ladder | Nothing up to 63k lines (+0.01); clearly worse on 763k lines (Recall@10 0.17 vs 0.28) until the background embeddings finish, identical after | [`09-fast-first-index/`](09-fast-first-index/README.md) |

**Conventions.**
- **Unit and tests:** the unit is the task or instance. Paired tests are one-sided sign-flip permutation tests with
  bootstrap CIs, Holm-corrected within each pre-registered family; everything else is labelled exploratory.
- **Raw outputs:** retrieval outputs, agent transcripts and fix patches can contain code from the benchmark
  repositories, some of them AGPL. They are kept out of git, and results reference them by commit and hash.
- **Run queue:** long runs go through [`run-queue.sh`](run-queue.sh), one heavy job at a time.
