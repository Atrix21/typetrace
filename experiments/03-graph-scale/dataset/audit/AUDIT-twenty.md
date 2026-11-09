# Twenty task audit (independent, pre-evaluation)

Auditor scope: 26 category A bug drafts + 14 understanding drafts (twenty_tw_t1..t14). Records are in `twenty-audit.jsonl` (one object per task, same directory).

## Method
- Category A: read each draft description in full, the fix patch (`targets/exp3/dataset-patches/twenty/twenty_prN.patch`), and for the changed lines computed the enclosing declaration with the TypeScript AST on the merge commit (`git show <merge>:path`, not the pinned snapshot, because the pinned snapshot is later and renamed/refactored some symbols). Compared with draft `root_cause_symbols`. Read full issues with `gh issue view` when the draft text was truncated (800 chars) and the verdict depended on it. Mechanism check is strict: any text naming the function/file/condition to change, or stating the faulty condition that is the fix, counts.
- Indirect boundary: followed callers/decorators/queues in the snapshot (job processors, `@OnDatabaseBatchEvent`, DiscoveryService registries, factory construction).
- Understanding: for each gt_path/relevant step, resolved the cited file:line to its enclosing declaration (AST on the snapshot), checked every consecutive call edge by reading the source, verified claims about config values, locks, dedupe, ordering, and re-grepped impact sets (callers, constructions, tests) for category C. oracle_edit.old uniqueness checked by exact substring count.
- Not done: no builds/tests/tsc, no retrieval tools, nothing under results/ or `.cache` opened. The category C compile-impact sets were derived by grep, not by running tsc.

## Counts
| verdict | A | understanding | total |
|---|---|---|---|
| accept | 4 (21506, 21846, 26693, 29126) | 0 | 4 |
| accept_with_fixes | 7 (22885, 24301, 25207, 25529, 26271, 27248, 28494) | 14 | 21 |
| reject | 15 | 0 | 15 |

Category A reject reasons (a task can have several):
- report states mechanism: 14 (22640, 23634, 23758, 24534, 25828, 26403, 26614, 27245, 27486, 27918, 27962, 28825, 29193, 29754)
- report/fix mismatch: 1 (23411: description is about front-end behaviour; the server patch only renames a DTO field)
- title-only/insufficient symptom: 0 rejects (25207 flagged borderline, kept)

## Systematic problems
1. `mechanism_in_report` in `candidates/twenty.jsonl` is unreliable. It missed 22640 (names `evaluateTextAndArrayFilter` and the missing cases), 25828 (title says "substring ... not equality"), 28825 (truncated "Technical inputs" names the fixed functions), 29754 (title is the diagnosis), 27245 (title "not synced") and flagged 27248 falsely. The detector looked at 800-char excerpts near fixed identifiers only.
2. Maintainer PR-text and issues with "Root cause"/"Technical inputs" sections dominate the rejects (14/26). For retrieval benchmarking, only symptom-only issues survive; consider removing such sections mechanically only if the lead accepts post-hoc editing (28825 and 22640 would then be salvageable; the others state the mechanism in the title or body core).
3. 800-char truncation leaves mid-sentence/mid-JSON descriptions (23411, 23634, 24301, 25828, 26271, 27248, 28494, 29193). Use the full body (symptom sections only).
4. `root_cause_symbols` derived from the pinned (later) snapshot via old-side line ranges give artefacts: handleWorkspaceMemberEvent (27245) and verifyLoginToken (26614) are not changed; for rename-heavy fixes (27248) 7 of 9 symbols are rename-only; for file moves (28494) the real locus (old `expand-flat-field-metadata-maps.util.ts`) is missing while a one-line call swap is listed. New functions/files added by the fix (e.g. propagateDestroyToSource, findChildStepIds, consumeLoginTokenOrThrow) cannot be GT keys because they do not exist in the bug snapshot; no draft lists them, which is correct.
5. `indirect_boundary` strata for category A are inconsistent: workflow-executor tasks (22640, 23758, 25828, 26271) are labelled none although every path runs inside the RunWorkflowJob queue handler and dispatches through WorkflowActionFactory; migration-runner tasks (23634, 24301) are labelled db but dispatch via the DiscoveryService action-handler registry (di); S3 and messaging tasks hide a driver factory/tool registry (di). Corrected values are in the jsonl (`indirect_boundary_corrected`).
6. Understanding drafts: mapping notes were all line-in-callee artefacts (callee keys already present) plus three real errors: T3 cites the wrong method (deleteOneField), T5 cites the wrong guard (handleUpsert instead of handleEvent), T2 mislabels the in-job continuation as a queue hand-off. Most "distractor" directories exist (core-entity-cache, workspace-cache-storage, query-hooks, message-cleaner, fairness) and several are actually on the path (T13, T7, T4, T12); a few do not exist (T3 table-shape, workspace-sync).
7. Stated facts that are wrong: T6 "per second window" (default window 60 s via WEBHOOK_CALL_RATE_LIMITING_TTL_IN_MS=60000); T9 "no spec calls filterReadableEvents" (three integration specs do); T10 impact.direct omits two of the three object literals in AgentChatThreadRecordEventService; T14 distractor rationale for WorkspaceResolverBuilderService.

## Items for the lead to adjudicate
- Borderline rejects (mechanism strictness): 27245 (title says "not synced", body says record API writes only workspaceMember.locale), 29754 (title: absolute URL vs relative href), 25828, 26403, 27918. 28825 and 22640 become acceptable if the technical/root-cause lines are cut.
- Borderline accepts: 25207 (two-sentence symptom, no stream/readFile hint, confidence low), 22885 (expected behaviour "show v2.20.0" differs from the fix which returns null; also changed declaration VersionInfoDTO.latestVersion), 26693 (second sentence hints stop-vs-skip), 21846 (frontend stack trace only, no relation hint), 28494 (symptom far from code; GT must include the old util functions).
- Boundary 'db' for 28494 retained (Redis cache payload); no 'cache' label exists in the taxonomy.
- 23411 and 27486 bundle several defects; 23634 is a feature request, not a malfunction.
- T1/T2/T14: the hook only handles classified workspace operations; others fall through to the GraphQL engine. T2 depends on dispatch mode (core vs legacy WorkflowTriggerJob); core path was verified, legacy not traced.
- T6: the config description of WEBHOOK_CALL_RATE_LIMITING_LIMIT says excess calls are "recorded as a failed webhook response", which contradicts the code (warn log + metric only); graders should follow the code.
- T13 and T14 are partly about absence/architecture; T13 query phrases (multiple pods) are supported by hash comparison in Redis, not by a pub/sub channel I could verify beyond the publish script constant.
