# Independent audit of Immich draft tasks (experiment 3)

Auditor: independent, read-only. Scope: 36 category-A bug tasks + 15 understanding tasks from `dataset/immich-audit-set.json`.
Per-task records: `immich-audit.jsonl`.

## Method
- Did not open the forbidden files (candidates jsonl notes, immich-analysis.md, results/, .cache jsonl); no retrieval/ranking tool run.
- Category A: read each draft (description, RC symbols, module_level_changes), the forward patch (`targets/exp3/dataset-patches/immich/immich_prN.patch`), compared patched files and hunk functions against RC/module keys (script: every non-test patched file is covered by RC or module-level keys for all 36 tasks), read surrounding snapshot code for boundary labels, and read linked issues/PRs with read-only `gh` where the report's relation to the fix was in doubt (#27545, #31050, #22522, #30933 and keyword scans of 16 accepted issue bodies).
- Understanding: read every gt_path/relevant/distractor symbol at the pinned snapshot a203e288 (all 142 keys resolve to a real file/class/method), traced each call/event/job step, checked oracle_edit.old uniqueness (all four occur exactly once), tsc effects by reading the call sites, and test lists by grep.

## Counts
| group | accept | accept_with_fixes | reject |
|---|---|---|---|
| Category A (36) | 12 | 4 | 20 |
| Understanding (15) | 1 (t9) | 14 | 0 |
| Total (51) | 13 | 18 | 20 |

Reject reasons (category A; some tasks have several):
- report_states_mechanism: 14 (28923, 29485, 31927, 32474, 32563, 32566, 32600, 32938, 29186, 31098, 31102, 30900, 32486, 32614)
- title_only / no symptom: 6 (28923, 28950, 30120, 32931, 32934, 29186)
- report_fix_mismatch: 3 (32609, 29267, 31098)
Accept_with_fixes (A): 29240 (boundary should be `event`), 30512 (stack trace leaks the failing expression), 31473 (new methods not resolvable as RC), 31074 (only the truncated description may be used; full issue links the exact functions).

## Systematic problems
1. **PR-sourced reports are mostly leaky.** Of the tasks with report_source = pr, nearly all are rejected: the PR body is a security/fix write-up that states the change (e.g. 30900, 32486, 32563, 32566, 32600, 32614, 31927, 32474) or only a title (30120, 32931, 32934, 28950). Only issue-sourced reports (and a few PR bodies written as bug reports) survive. This biases the surviving set to issue-reports and loses most "easy / high lexical" tasks (strata easy: 30900, 32486, 32614 rejected; 30431 kept).
2. **Descriptions are truncated at ~900 characters** with a trailing "…" and are not "verbatim" (images stripped). Truncation cuts mid-sentence (e.g. 32938 "doesn't check if the values are…", 31473 inside an ffprobe dump). Truncation can hide or expose mechanism text; for 31074 the full issue (#30933) names the exact functions, so only the truncated form is safe. The lead should fix one policy (truncated vs full) and re-run the leakage check under it.
3. **Mined issue -> PR links are sometimes wrong in substance**: 32609 (issue is about partner assets, fix adds album-shared access), 31098 (PR says "Fixes ... (partially)", issue discusses different fields), 29267 (client unique-constraint issue vs backfill boundary fix). The mechanical `Fixes #N` link is not enough; PRs saying "partially" or with a title-only body should be flagged.
4. **Mechanical RC derivation is correct at file/function level** (no missing/extra changed functions found) but several fixes add NEW members that cannot exist in the bug snapshot (31473 isFrameVertical x5, 32474 getToneMapping overrides x2, 31074 getTrackedPaths) or are module-level (zod schemas, constants, `columns.syncAlbumAsset`, migration file). They are recorded in module_level_changes at best; recall metrics must not require them.
5. **indirect_boundary labels are unreliable for media/HLS and access-control tasks**: 29240 labelled `job` but the path is HLS events (hls.service.ts serverSend -> transcoding.service.ts @OnEvent); 32609 labelled `di` but is a direct call chain. Label semantics (db/other) were not defined in the inputs; `db` was accepted when the defect is in a SQL query reached directly.
6. **Understanding tasks: paths are accurate but often under-specified.** Typical defects: question asks for more than the path covers (t8 stops at metadata extraction though "searchable" is asked; t11 omits shared-link validity checks; t12 omits isVideo/AudioTranscodeRequired; t13 omits the cron scheduler; t14 omits the two process entry points; t10 omits how failures surface), wrong entry/anchor (t5 should be handleRecognizeFaces; t7 should start at AlbumService.addAssets), or a valid parallel path declared a distractor (t3 searchSmartV3, t4 SystemConfigService.onConfigUpdate, t5 handleQueueRecognizeFaces).
7. **Cross-task overlap**: t13 (handleAssetDeletion) and bug pr29354 share a function; t1/t8/t2 share JobService.onDone/handleMetadataExtraction with several media/metadata bug tasks. Fine if indexes are per-task, but a lead may want to confirm no gt leakage via shared corpus.
8. Category C: oracles are sound (old strings unique; compile effects as claimed) with two caveats: t2 note wrongly says the JobSource import stays used (it becomes an unused type import in event.repository.ts:12; harmless) and t15 test list is incomplete.

## For the lead to adjudicate
- Policy on stack-trace/log leakage (30512): kept as accept_with_fixes; the log shows the verbatim failing expression. Reject if localisation-by-trace is considered a leak.
- 30431 (quotes the sibling `Invalid user` message), 29908 (cites earlier PR #6712): kept, flagged low-severity.
- 32219 and 32240 kept at medium confidence (behavioural change / reporter unsure of mechanism).
- 29485 rejected as mechanism-stating on the basis of "-channel_layout 5.1" (actual fix used -ac 2); medium confidence.
- Whether understanding gt_path should be treated as ordered strictly (t1 parallel stages, t4 mixes startup-time and runtime steps).
- Truncated vs full description policy (item 2).

## Addendum: remaining 20 category-A drafts
Applied lead policy: description judged as stored (miner truncation ~800 chars); stack traces/error messages are symptom evidence; indirect_boundary = first non-call link (job/event/di hop first, otherwise `db` if the defect is a query, else none/other).

Counts: 5 accept (29035, 29516, 29737, 30759, 31533), 1 accept_with_fixes (31425), 14 reject. (Grand total over all 71 audited: 18 accept, 19 accept_with_fixes, 34 reject.)

Reject reasons: report_states_mechanism 12 (30837, 31777, 32077, 32079, 32080, 32559, 32565, 32567, 32603, 32604, 32606, 32607); report_fix_mismatch / ground truth not reproducible 2 (30908: real fix is Dockerfile base image + start.sh LD_LIBRARY_PATH, the mechanical patch is an unrelated refactor; 31479: thumbnail-failure report vs. large-files hidden-asset filter).

Systematic notes: (a) the same pattern as before - security/hardening PR bodies (32559-32607) all restate the fix, so every PR-sourced security task is unusable; (b) mechanical patches drop non-`.ts` changes (Dockerfile, shell scripts, SQL query snapshots), which can make the derived RC wrong (30908); (c) RC can include an unchanged function when a new sibling method is appended in the same hunk (31425 updateTags); (d) renamed symbols (29737 streamAssetPaths) resolve only in the bug snapshot.
