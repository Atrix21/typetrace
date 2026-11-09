# Experiment 3: does graph-based code retrieval become more valuable at scale?

**Status.** This file is the experiment design and the milestone-2 record (retrieval-only stage). The agent stage and the competitor head-to-head ran afterwards; their results are in the top-level README and `results/`.

## Executive summary

**Setup.**
- **Ladder.** A 6k / 62k / 763k-line TypeScript ladder: nestjs-boilerplate (S), Immich server (M), Twenty server (L).
- **Tasks.** 61 newly mined, independently audited M/L tasks with frozen ground truth, plus experiment 1's 20 S tasks:
  - historical bug fixes reverted on pinned snapshots, with 40 of 56 Immich drafts FAIL_TO_PASS-verified;
  - understanding tasks (features, change impact with a type-checker oracle, data flow, architecture);
- **Methods.** Eight retrieval methods, all with frozen experiment-1 configurations. The primary contrast is hybrid retrieval with graph propagation against the identical hybrid without it (`hybrid_nograph`, experiment 1's ablation, reproduced exactly).

**Results (test split).**
- **The graph adds recall beyond strong lexical+semantic retrieval on S and L, barely on M.** Recall@10 Δ_graph:

  | S | M | L | M+L pooled |
  |---|---|---|---|
  | +0.24 [+0.09, +0.40] | +0.05 [0.00, +0.12] | +0.16 [+0.07, +0.25] | +0.10 [+0.05, +0.15] |

- **It is a cross-module effect (H2 supported).** Cross-module tasks gain +0.15, local tasks +0.03. The difference is +0.12 [+0.03, +0.21], Holm-adjusted p = 0.019.
- **Growth with size is not established (H1 not supported, not falsified).** Within Twenty, as unrelated code is added around the same tasks, the non-graph methods lose recall (hybrid_nograph 0.32 → 0.20 → 0.17) while graph-propagated hybrid holds up (0.42 → 0.43 → 0.33).
  - Slope of Δ_graph: +0.06 per 10× [−0.02, +0.15] on community-built corpora (confirmatory); +0.07 [+0.02, +0.14] on random-built corpora (sensitivity, unadjusted).
  - Across repositories the effect is not monotone, since M is smaller than both S and L.
- **Equal token budgets: survives on L, not on M.** Within 1k tokens the gain is +0.12 [+0.04, +0.25] on L and −0.02 on M.
- **The effect lives in understanding tasks.** On Twenty they gain +0.26, while bug localisation shows +0.00 (at the floor for every method). Twenty's 6 dev tasks disagree (−0.18, one task). The evidence is real but narrow and small-sample.
- **Compact agent-facing output carries it on L.** An ≈ 740-token pointer list with graph relations beats the identical no-graph list by +0.12 Recall@10 on L, but not on M.
- **Scale costs are real.**
  - **Twenty graph:** a full rebuild takes 81 s and 4.0 GB, with 233k nodes and 859k edges. A fully typed build was infeasible on the 15 GB machine, so third-party types are stubbed on L.
  - **Hybrid queries:** 12 s on L against 0.6 s on M.
  - **Updates:** there is no incremental graph update yet, so every change means a full rebuild.

**Recommendation.** Conditional GO for the minimum-viable agent pilot only: Twenty, Haiku 5.5, baseline / compact-no-graph / compact-graph, 180 runs, about $2–16 list price. Its analysis would be pre-registered by task type. NO-GO for the full-scale agent plan. Details, caveats and the optional non-billable strengthening step are in `stage1-findings.md` §5.

## Deliverables (milestone 2)

| # | Deliverable | Where |
|---|---|---|
| 1 | Updated research protocol | `protocol.md` (Amendment B, written before any M/L result) |
| 2 | Repository and corpus manifests | `manifests/repositories.json` (commits, corpus and lockfile hashes, installs, stub policy); `manifests/communities-*.json`; `manifests/corpora-twenty.json` (nested corpora with SHA-256) |
| 3 | Extractor implementation and regression evidence | `src/parser/dispatch-extractor.ts`; `tests/graph/dispatch-extractor.test.ts` + `tests/fixtures/dispatch-app/`; `manifests/s-graph-regression-{before,after}.json` (21/21 identical); `manifests/s-reproduction.json`; `dataset/audit/EDGE-AUDIT.md` (v1 precision 0.31–0.34 for dispatch → fixes → v2 100/100) |
| 4 | Task catalogue and frozen dataset | `task-catalogue.md`; `dataset/v2/` (S: experiment-1 tasks; M 37; L 24); `dataset/v2/FROZEN.json` |
| 5 | Independent audit and adjudication | `dataset/ADJUDICATION.md`; `dataset/audit/AUDIT-{immich,twenty}.md`, `*-audit.jsonl`, `adjudication-*.json`; `dataset/evidence/` (FAIL_TO_PASS, impact oracle) |
| 6 | Retrieval method configurations | `manifests/methods.json`; `src/retrieval/compact-retrieval.ts`; `src/evaluation/methods.ts` |
| 7 | Retrieval-only results with confidence intervals | `results/stage1-report-test.md`, `results/stage1-report-dev.md`, `results/stage1-analysis-*.json`, `results/stage1-{S,M,L}/metrics.jsonl` |
| 8 | Infrastructure and scaling measurements | `stage1-findings.md` §4; `results/stage1-*/infra.jsonl`, `graph-builds.jsonl`; `profiles/*-m2.json` |
| 9 | Community-versus-random corpus sensitivity | `stage1-findings.md` §3.4; report section "H1" |
| 10 | Reconciled agent-experiment cost estimate | `cost-estimate.md`; `scripts/exp3/cost-model.py` → `results/agent-cost-model.{md,json}` |
| 11 | Stage-1 findings and go/no-go | `stage1-findings.md` |
| 12 | Updated decision log | `decision-log.md` (E3-D01…E3-D25) |

Milestone-1 documents remain and are updated where milestone 2 changed facts: `repository-assessment.md`, `retrieval-architecture.md`, `implementation-plan.md`. Raw retrieval outputs contain code from AGPL repositories, so they are kept local (`results/stage1-*/raw/`, git-ignored). The fix patches likewise stay outside the tracked tree (`targets/exp3/dataset-patches/`); they are reproducible from the commit ranges and SHA-256 hashes recorded in the tasks.

## Decisions requiring the owner's approval

1. **Milestone 3, minimum viable:** the L-only Haiku agent pilot (180 runs). Approval should name account, billing mode (subscription or API key), caps and stop rules. The plan is in `cost-estimate.md`.
2. **Or, first, the optional non-billable L task expansion** (about 20 more audited Twenty tasks; sub-agent usage about 0.6–0.9M tokens) to firm up stage 1 before any agent run.
3. **Whether to accept the documented L-specific difference** (third-party types stubbed) or to invest in a lighter-weight typed extractor before further L work.

## Changes to shared code (all regression-tested)

- **Graph builder:**
  - streaming hash and export (milestone 1);
  - opt-in `maxPackageDeclarationBytes` (default off);
  - phase timing (env flag, diagnostics only).
- **Framework extractor:** calls the new `DispatchExtractor`. It adds nothing on S (S graphs byte-identical to experiment 1).
- **`emitEffect`:** refactored into `effectEdges` with identical behaviour.
- **Embedding cache:** streamed and memoised; same keys and values (unit test).
- **New method registrations:** `hybrid_nograph`, `compact_graph`, `compact_nograph`.
- **Graph cache:** opt-in `primeGraphCache` / `clearGraphCache`.
- **Test runner:** files run sequentially. The experiment-2 harness tests were flaky under parallel load; the suite now passes 247/247 in about 60 s.
