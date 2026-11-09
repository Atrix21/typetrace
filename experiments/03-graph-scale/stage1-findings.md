# Experiment 3, stage 1: retrieval-only findings and go/no-go

**Scope.** This stage measured deterministic retrieval only. It made no model calls and ran no agent. The agent hypotheses H3 and H4 were not tested; they need milestone 3, which is not approved.

**Sources.**
- Generated tables: `results/stage1-report-test.md` (test split; confirmatory) and `results/stage1-report-dev.md`.
- Machine-readable results: `results/stage1-analysis-*.json` and `results/stage1-{S,M,L}/metrics.jsonl`.
- Design: `protocol.md` (Amendment B was written before any M/L result). Decisions: `decision-log.md` E3-D12…E3-D25.

## 1. Answers

| Question | Answer (test split; 95% task-level bootstrap CIs) |
|---|---|
| Does graph retrieval improve over hybrid without graph information? | **Yes on S and L; barely on M.** Δ_graph is Recall@10(hybrid) − Recall@10(hybrid_nograph). S +0.24 [+0.09, +0.40] (n = 14); M +0.05 [0.00, +0.12] (n = 26); L +0.16 [+0.07, +0.25] (n = 18); pooled M+L +0.10 [+0.05, +0.15] (n = 44; 17 wins / 3 losses / 24 ties). On L the graph method also beats the best of BM25, embeddings and hybrid_nograph chosen per task (an optimistic oracle) by +0.06. |
| Does the improvement increase with repository size? | **Not established.** Across repositories it is not monotone (S 0.24 > L 0.16 > M 0.05), and task mix confounds that comparison. Within L (nested corpora, the confirmatory H1) the mean slope is +0.06 per 10× [−0.02, +0.15], p = 0.10 (Holm 0.10): not supported, and not falsified either. Descriptively, the non-graph methods lose recall as code is added around the same tasks, while hybrid with the graph holds up (§3.4). |
| Does it increase on cross-module tasks? | **Yes (H2 supported).** Cross-module minus local = +0.12 [+0.03, +0.21], one-sided p = 0.009, Holm 0.019. Cross-module tasks gain +0.15 [+0.07, +0.23] (n = 25); local tasks gain +0.03 [0.00, +0.08] (n = 19). The pattern holds in both repositories (M +0.10 vs 0.00; L +0.21 vs +0.07). |
| Does it survive fixed token budgets? | **On L yes, on M no.** Recall within 1k uniformly rendered tokens: L +0.12 [+0.04, +0.25]; M −0.02 [−0.07, +0.01]; M+L +0.04 [−0.01, +0.10]. Within 4k: L +0.12 [0.00, +0.24]; M +0.01. At natural output: L +0.19 [+0.08, +0.32]; M +0.05 [−0.07, +0.16]. M's Recall@10 gain is re-ranking that does not buy more relevant code per token. |
| Does it survive the alternative corpus-expansion strategy? | **Yes, and the random strategy shows the cleaner trend.** The random-community slope is +0.07 per 10× [+0.02, +0.14] (p = 0.014, sensitivity analysis, unadjusted). Mean Δ by size: random 0.09 / 0.16 / 0.16 against community 0.09 / 0.23 / 0.16 (≈ 100k / 300k / 1.01M lines). The community-based construction does not explain the effect. |
| Is the improvement large enough to justify testing an autonomous agent? | **Conditionally.** It meets the protocol's stage-1 bar (Δ_graph ≥ +0.10 at L). But it rests on 11 understanding tasks: L bug localisation shows +0.00, all ties, mostly both methods at 0. Twenty's 6 dev tasks point the other way (−0.18, driven by one task). See §5 for the recommendation. |
| What would falsify the hypothesis? | §6. |

## 2. What was run

**Repositories.** TypeScript/NestJS throughout:

| Level | Repository | Corpus | Graph build |
|---|---|---|---|
| S | nestjs-boilerplate | 170 files; experiment 1's single-bug snapshots | experiment 1's |
| M | Immich server | 572 files, 96.6k lines incl. co-located tests | fully typed |
| L | Twenty server | 11,894 files, 1.01M lines | third-party declarations stubbed (E3-D15) |

Corpus hashes are in `manifests/repositories.json`.

**Tasks** (`dataset/v2`, frozen, independently audited; `dataset/ADJUDICATION.md`):
- **S:** experiment 1's 20 injected tasks (14 test).
- **M:** 37 tasks (26 test): 22 historical bug tasks (15 test) and 15 understanding tasks (11 test).
- **L:** 24 tasks (18 test): 10 historical bug tasks (7 test) and 14 understanding tasks (11 test).

Category-A tasks are post-2026-06-01 fixes reverted on the pinned snapshot. The ground truth is the functions the fix changed, with 40 of 56 Immich drafts FAIL_TO_PASS-verified. Category-C direct impact comes from a type-checker oracle.

**Methods** (`manifests/methods.json`; frozen experiment-1 configurations; no per-repository tuning):
- ripgrep, BM25, embeddings (Qwen3-Embedding-0.6B);
- **hybrid_nograph**: experiment 1's `no_graph_at_all` ablation, reproduced per task on S;
- **hybrid** (graph propagation);
- **custom graph**;
- **compact_nograph / compact_graph**: identical pointer format and 800-token cap.

**Graph.** It gained three generic rules (keyed dispatch, GraphQL entry points, Kysely tables). The independent re-audit found 100/100 sampled new edges correct after the precision fixes (E3-D21, E3-D22). S graphs stay byte-identical to experiment 1's (21/21).

**Corpora.** Every method used the same budget (50 results / 8k tokens; the experiment-1 budget) on the full corpus. On L it also ran four nested corpora per task: community and random expansion at ≈ 100k and ≈ 300k lines. Their manifests carry SHA-256 hashes, rebuild deterministically, and contain every ground-truth file (E3-D19).

## 3. Results

### 3.1 Method levels (Recall@10, full corpus, test)

| Method | S | M | L |
|---|---:|---:|---:|
| ripgrep | 0.23 | 0.18 | 0.03 |
| BM25 | 0.40 | 0.37 | 0.19 |
| embeddings | 0.47 | 0.47 | 0.19 |
| hybrid_nograph | 0.43 | 0.43 | 0.17 |
| **hybrid** | **0.67** | **0.48** | **0.33** |
| custom graph | 0.60 | 0.35 | 0.22 |
| compact_nograph (≈ 760 tokens) | 0.43 | 0.43 | 0.17 |
| compact_graph (≈ 740 tokens) | 0.61 | 0.39 | 0.28 |

All methods get worse with scale; ripgrep collapses. The S rows reproduce experiment 1 exactly (`manifests/s-reproduction.json`).

### 3.2 Primary contrast at natural output and fixed budgets

| Δ_graph | S | M | L | M+L |
|---|---|---|---|---|
| Recall@10 | +0.24 [+0.09, +0.40] | +0.05 [0.00, +0.12] | +0.16 [+0.07, +0.25] | +0.10 [+0.05, +0.15] |
| Recall at natural output | +0.06 [−0.07, +0.23] | +0.05 [−0.07, +0.16] | +0.19 [+0.08, +0.32] | +0.11 [+0.02, +0.19] |
| Recall within 1k tokens | +0.07 [−0.12, +0.27] | −0.02 [−0.07, +0.01] | +0.12 [+0.04, +0.25] | +0.04 [−0.01, +0.10] |
| Recall within 4k tokens | +0.07 [−0.08, +0.26] | +0.01 [−0.11, +0.13] | +0.12 [0.00, +0.24] | +0.05 [−0.03, +0.14] |
| RC MRR (category A) | +0.24 [+0.04, +0.46] | +0.16 [−0.02, +0.36] | +0.16 [0.00, +0.39] (n = 7) | +0.16 [+0.02, +0.31] |
| Path recall@10 (B–E) | — | +0.01 [−0.16, +0.15] | +0.19 [+0.04, +0.36] | +0.09 [−0.03, +0.20] |

### 3.3 Where the effect lives

- **By locality (M+L):** cross-module +0.15 [+0.07, +0.23] (n = 25) against local +0.03 [0.00, +0.08] (n = 19). This is H2.
- **By difficulty:** hard +0.14 [+0.07, +0.21] (n = 27); medium +0.03 (n = 16).
- **By task type:**
  - On L, understanding tasks gain +0.26 [+0.15, +0.37] (n = 11) and bug localisation +0.00 (n = 7). Five of those 7 have Recall@10 = 0 for both methods: a floor effect, not evidence of no benefit.
  - On M, bug tasks gain +0.07 and understanding tasks +0.03.
- **Dev split** (not confirmatory): M +0.03 (n = 11). L −0.18 (n = 6), driven by one bug task (twenty_pr26271), where hybrid_nograph finds the root cause and hybrid does not.

### 3.4 Scale within L (nested corpora; same tasks, more surrounding code)

| Corpus (median lines) | hybrid | hybrid_nograph | BM25 | embeddings |
|---|---:|---:|---:|---:|
| community ≈ 99k | 0.42 | 0.32 | 0.25 | 0.35 |
| community ≈ 306k | 0.43 | 0.20 | 0.21 | 0.25 |
| random ≈ 102k | 0.34 | 0.25 | 0.26 | 0.28 |
| random ≈ 309k | 0.37 | 0.21 | 0.23 | 0.27 |
| full 1.01M | 0.33 | 0.17 | 0.19 | 0.19 |

**H1.** The per-task slope of Δ_graph on log10(lines) is:
- community: +0.06 per 10× [−0.02, +0.15], p = 0.10;
- random: +0.07 [+0.02, +0.14], p = 0.014, unadjusted.

The added code depresses lexical and embedding recall: distractors, name collisions (a callee name is shared by 214 declarations on average in L), and longer paths. Graph propagation from the same seeds is much less affected. This is the mechanism a scale benefit would need. With 18 tasks and three corpus sizes, though, the slope is not established. On the community corpora it is also non-monotone: largest at ≈ 300k, and smaller on the full corpus.

### 3.5 Compact agent-facing output (same format and cap; the only difference is graph content plus the ranking it drives)

compact_graph − compact_nograph, Recall@10:
- S +0.18 [+0.01, +0.36];
- M −0.04 [−0.15, +0.05];
- L +0.12 [+0.04, +0.19].

At the pointer output itself (≈ 740 tokens versus 6–8k tokens of native context), L shows +0.10 [−0.02, +0.23]. On L, the ≈ 740-token graph pointer list has a higher Recall@10 (0.28) than the embeddings ranking (0.19), whose native context is about ten times longer. Whether an agent turns pointers into answers is exactly the open agent question.

### 3.6 Other contrasts (descriptive)

- **Custom graph versus hybrid_nograph.** M −0.07 [−0.18, +0.03]; L +0.05 [−0.02, +0.13] (natural output: L +0.20 [+0.09, +0.32]). Graph-only ranking is worse than the fused hybrid at M. The value comes from graph propagation on top of good lexical and semantic seeds, as in experiment 1.
- **hybrid_nograph versus its components.** It is not better than BM25 or embeddings at L (−0.02 and −0.02). The L gain is therefore not a fusion artefact.

## 4. Infrastructure and scaling costs (measured on a 15 GB laptop with an RTX 3060)

| Measure | S | M | L |
|---|---|---|---|
| Graph build (full, one snapshot) | experiment 1 | 22 s, 1.9 GB peak, 89 MB SQLite | 81 s, 4.0 GB peak, 1.2 GB SQLite (stubbed); fully typed build infeasible (killed at 6.5–7.3 GB after 7–15 min) |
| Graph size (nodes / edges) | 2.7k / 8.6k | 23.3k / 120k | 233k / 859k |
| Embeddings (one-time, content-hash cached) | 728 chunks | 5,764 chunks | 50,151 chunks in 17 min (GPU), 3.0 GB |
| Query latency (median): BM25 / embeddings / hybrid / custom graph | 11 / 56 / 81 / 74 ms | 17 / 26 / 587 / 1,096 ms | 106 ms / 4.8 s / 12.1 s / 18.4 s |
| Index preparation per corpus (BM25 / hybrid incl. graph engine) | 0.09 / 0.24 s | 1.0 / 1.7 s | 13.9 / 23.3 s |
| Evaluation process memory | 0.8 GB | 2.1 GB | 6.1 GB |
| Freshness: a typical fix touches 1 file; graph difference vs pinned (median) | — | 366 edges added / 375 removed, 0.6% of edges | 224 / 248, 0.06% |

- **Incremental updates.** These were not implemented for the graph. An update is a full rebuild: 22 s on M, 81 s on L. Text indexes are incremental through the content-hash embedding cache.
- **Where L's query cost goes.** Brute-force embedding scoring (4.8 s) and graph propagation over 859k edges (7–18 s) dominate. Both are engineering problems, but they also show that at 1M lines a graph index costs real time and memory per query in this implementation.

## 5. Recommendation (go/no-go)

**Conditional GO for the minimum-viable agent pilot only. NO-GO for the full-scale agent plan.**

**Reasons for testing an agent:**
- The pre-registered stage-1 bar is met on L: Δ_graph +0.16 ≥ +0.10.
- The effect survives natural output and fixed token budgets on L.
- It is concentrated where the hypothesis predicts: cross-module and understanding tasks (H2 supported).
- The compact graph interface carries it at about 740 tokens.

These are the conditions under which an agent with grep might plausibly benefit. Experiment 2's repository had none of them.

**Reasons for caution:**
- n = 18 L test tasks.
- L's effect comes from 11 understanding tasks; there is no effect on L bug localisation, which sits at the floor.
- The 6 L dev tasks disagree.
- M shows almost no equal-token advantage.
- The size slope (H1) is not established.
- L graphs lack third-party types.
- A retrieval gain is not an agent gain (B5).

**Proposed next step (requires approval; not started).** The minimum-viable plan in `cost-estimate.md`:
- L only; Haiku 5.5 at effort high;
- arms A0 baseline / A1 compact_nograph / A2 compact_graph, with byte-identical tool schemas;
- 6 dev tasks × 3 arms × 1 pilot, then 18 test tasks × 3 arms × 3 repeats = **180 runs**;
- about $2–16 list price, about 0.2–1.5 Pro windows, 4–15 h sequential.

Pre-register that the agent analysis is stratified by task type, with understanding/cross-module tasks primary and bug tasks reported separately, because that is where stage 1 found the effect.

**Optional non-billable step first,** if a stronger stage-1 basis is wanted: add about 20 audited Twenty understanding and cross-module tasks plus parent-commit bug tasks (sub-agent authoring and audit, about 0.6–0.9M subscription tokens), and re-run stage 1 on L. This would turn the L result from 18 tasks into about 40.

## 6. What falsifies the hypothesis (and what this stage showed)

| Claim | Falsified if | Stage 1 |
|---|---|---|
| H1: graph contribution grows with size | slope CI upper < +0.03 per 10× | not falsified (upper +0.15); not supported (CI includes 0) |
| H2: larger on cross-module tasks | difference CI upper < +0.05 | supported (+0.12 [+0.03, +0.21], Holm p = 0.019) |
| Graph beats strong no-graph retrieval at equal tokens | Δ at fixed budgets ≤ 0 | falsified for M (≈ 0); not for L (+0.12) |
| Agent benefit (H3, H4; later) | compact_graph no better than compact_nograph on L while the A0 baseline is below ceiling; or no token reduction at equal accuracy | not tested |

## 7. Threats to validity and limitations

- **Small samples.** Test n = 14, 26 and 18; dev n = 11 and 6. CIs are wide, and three repositories cannot separate repository identity from size (hence the within-L design).
- **Task mix differs by repository.** L's test set is 61% understanding tasks against 42% on M; the L/M difference is partly a task-type difference.
- **Ground truth of understanding tasks.** Annotators drafted it as call and dispatch paths. That is what graph propagation follows, by design of the hypothesis rather than through circular labelling: no graph output was used to create or audit labels. It still means the effect measures "retrieving multi-hop structure", not general relevance.
- **L graphs stub third-party declarations** (E3-D15). TypeORM database edges are absent, and 19% of call sites are unresolved. M is fully typed. The extractors differ by repository.
- **Dispatch recall was not measured.** Precision is 100/100 after the fixes. Database-batch events on L are excluded as broadcast keys.
- **Task survival and difficulty.** Many reports were rejected for stating the fix (40 of 82 audited bug drafts; 26 of 56 Immich, 14 of 26 Twenty). The surviving bug tasks skew hard, and on L they sit at the floor.
- **Process incidents, fixed and rerun before results were used** (E3-D21, E3-D23): low dispatch precision (re-audited), a run interrupted mid-task (contaminated Immich run discarded), and a lazily built reference graph (first L run discarded).
- **No agent and no model calls.** Nothing here measures agent accuracy, tokens or cost.

## 8. Reproduce (no model calls)

```bash
npx tsx scripts/exp3/regression-s.ts                 # S graphs vs experiment-1 hashes
npx tsx scripts/exp3/stage1.ts --repo S --split all --out experiments/03-graph-scale/results/stage1-S
npx tsx scripts/exp3/stage1.ts --repo M --split all --out experiments/03-graph-scale/results/stage1-M
NODE_OPTIONS=--max-old-space-size=9000 npx tsx scripts/exp3/stage1.ts --repo L --split all \
  --nested experiments/03-graph-scale/manifests/corpora-twenty.json --out experiments/03-graph-scale/results/stage1-L
vendor/.venvs/graphify/bin/python -I scripts/exp3/analyse.py --split test   # and --split dev
```

Environment setup (dependencies, workspace builds, patches, embeddings) is in `manifests/repositories.json` and `implementation-plan.md`. Snapshot trees must be clean; the runner refuses otherwise.
