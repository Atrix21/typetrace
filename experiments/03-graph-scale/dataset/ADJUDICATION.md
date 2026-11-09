# Dataset v2: independent audit and adjudication (experiment 3)

Two independent Sonnet auditors (one per repository) checked every draft against the code, the fix patches and the history, with no access to any retrieval output (none existed yet) and with the mining agents' BM25 screen removed from every file they used. The lead adjudicated the items they flagged (`audit/adjudication-*.json`), before any retrieval run on that repository. Full records: `audit/immich-audit.jsonl`, `audit/twenty-audit.jsonl`, `audit/AUDIT-immich.md`, `audit/AUDIT-twenty.md`; freeze reports: `v2/<repo>-freeze-report.json`; hashes: `v2/FROZEN.json`.


## immich

| Group | audited | accept | accept with fixes | reject |
|---|---:|---:|---:|---:|
| A | 56 | 17 | 5 | 34 |
| B-E | 15 | 1 | 14 | 0 |

Rejection reasons (first applicable): report states the fix mechanism 26; title-only / no symptom 4; report/fix mismatch 4.

Frozen: **37 tasks** (11 dev / 26 test), dataset SHA-256 `8c7bff1dbe18f3cd1825feb71929f3aac9d57f2967e3e18182f3014670f8a234`. Strata: difficulty {'medium': 17, 'hard': 18, 'easy': 2}; locality {'local': 20, 'cross_module': 17}; categories {'A': 22, 'B-E': 15}.

## twenty

| Group | audited | accept | accept with fixes | reject |
|---|---:|---:|---:|---:|
| A | 26 | 4 | 7 | 15 |
| B-E | 14 | 0 | 14 | 0 |

Rejection reasons (first applicable): report states the fix mechanism 14; report/fix mismatch 1.

Frozen: **24 tasks** (6 dev / 18 test), dataset SHA-256 `25ad8335f37825117bf2bb4fc7626184090a1a2038f186829fcf9215046a15d8`. Strata: difficulty {'medium': 5, 'hard': 19}; locality {'local': 11, 'cross_module': 13}; categories {'A': 10, 'B-E': 14}.

## Adjudication policies (both repositories)

- The description is the mined report text exactly as stored (issue title + body, truncated by the miner at about 800 characters); leakage was judged on this exact text.
- Reports are never rewritten: a report that states the fix is rejected, even where cutting lines would "salvage" it (Twenty 28825, 22640 declined); borderline mechanism cases stay rejected.
- A quoted stack trace or error message is symptom evidence (it raises lexical overlap; it does not invalidate the task).
- indirect_boundary = the first non-call link from the user-visible entry point to the root cause (job, event, di, db, graphql, other, none); auditor corrections applied.
- Category C direct impact = the type-checker oracle's set; annotated sets kept as indirect impact.
- Two tasks failed key validation after fixes: twenty_pr28494 rejected (the fix renames a file, the mined patch cannot restore it, the bug snapshot would not compile); twenty_tw_t9 kept with the auditor's test-file additions moved out of the symbol set.
- Immich was audited in two batches (51, then the remaining 20 category-A drafts) because the first batch rejected 56% of category A; both batches precede any retrieval run on Immich.

## Executable evidence

- Immich FAIL_TO_PASS (`evidence/immich-fail-to-pass.jsonl`): of 56 category-A drafts, 40 verified (the fix's tests pass on the fixed tree and fail on the bug tree), 15 not runnable (database-backed medium/e2e tests only), 1 without a failing test. Twenty unit tests were not run (heavy jest/nx setup; time); its category-A ground truth rests on the fix diff and the audit.
- Change-impact oracle (`evidence/*-impact-oracle.json`): Immich 4/4 and Twenty 3/3 category-C tasks produced a type-checker direct-impact set.
