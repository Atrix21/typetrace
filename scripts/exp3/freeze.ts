#!/usr/bin/env tsx
/**
 * Experiment 3: adjudicate audits and freeze dataset v2 for one repository. No retrieval method is run or consulted.
 *
 *   npx tsx scripts/exp3/freeze.ts --repo immich|twenty
 *
 * Inputs: dataset/<repo>-audit-set.json, dataset/drafts/<repo>/*.json, dataset/audit/<repo>-audit.jsonl (independent
 * auditor), dataset/audit/adjudication-<repo>.json (lead decisions on disputed items; optional), dataset/evidence/*
 * (FAIL_TO_PASS, change-impact oracle), manifests/communities-<repo>.json (import-graph communities).
 * Rules: reject -> excluded; accept_with_fixes -> auditor fixes applied unless the adjudication file overrides them;
 * every symbol key is validated on the task's own snapshot (bug snapshot for category A); category C direct impact is
 * replaced by the type-checker oracle's set; strata and dev/test split are computed mechanically (seed 20261110).
 * Output: dataset/v2/<repo>/<task_id>.json, dataset/v2/<repo>-freeze-report.json, hash recorded in dataset/v2/FROZEN.json.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { abs } from '../../src/config.js';
import { validateTasks } from '../../src/evaluation/ground-truth.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';
import type { GroundTruthTask } from '../../src/types.js';
import { materialise, lexicalOverlap, REPOS, type RepoName } from './tasks.js';

const repo = process.argv[process.argv.indexOf('--repo') + 1] as RepoName;
const R = REPOS[repo];
const D = abs('experiments/03-graph-scale/dataset');
const readJson = (p: string, d?: unknown) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d);
const readJsonl = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const set = readJson(`${D}/${repo}-audit-set.json`);
const ids: string[] = [...set.category_A, ...set.understanding];
const audit = new Map(readJsonl(`${D}/audit/${repo}-audit.jsonl`).map((r: any) => [r.task_id, r]));
const adj = readJson(`${D}/audit/adjudication-${repo}.json`, { decisions: {} }).decisions as Record<string, any>;
const ftp = new Map(readJsonl(`${D}/evidence/${repo}-fail-to-pass.jsonl`).map((r: any) => [r.task_id, r]));
const oracle = new Map((readJson(`${D}/evidence/${repo}-impact-oracle.json`, { results: [] }).results as any[]).map((r) => [r.task_id, r]));
const comm = readJson(abs(`experiments/03-graph-scale/manifests/communities-${repo}.json`));
const commOf = new Map<string, number>();
for (const c of comm.communities) for (const f of c.files) commOf.set(f, c.id);

const uniq = (xs: string[]) => [...new Set(xs)];
const report: Record<string, unknown>[] = [];
const kept: any[] = [];
for (const id of ids) {
  const t = readJson(`${D}/drafts/${repo}/${id}.json`);
  const a = audit.get(id);
  const d = adj[id] ?? {};
  const verdict = d.verdict ?? a?.verdict ?? 'missing_audit';
  if (verdict === 'reject' || verdict === 'missing_audit') { report.push({ task_id: id, status: 'excluded', verdict, reasons: d.reasons ?? a?.reasons ?? [] }); continue; }
  const fx = { ...(a ?? {}), ...(d.fixes ?? {}) };
  const isA = t.task_type === 'bug_localisation';
  if (isA) {
    t.root_cause_symbols = uniq([...t.root_cause_symbols.filter((k: string) => !(fx.root_cause_extra ?? []).includes(k)), ...(fx.root_cause_missing ?? [])]).sort();
    t.relevant_symbols = uniq([...t.root_cause_symbols, ...t.relevant_symbols.filter((k: string) => !(fx.root_cause_extra ?? []).includes(k) && !(fx.relevant_extra ?? []).includes(k)), ...(fx.relevant_missing ?? [])]).sort();
  } else {
    if (fx.gt_path_corrected) t.gt_path = fx.gt_path_corrected;
    t.relevant_symbols = uniq([...t.relevant_symbols.filter((k: string) => !(fx.relevant_extra ?? []).includes(k)), ...(fx.relevant_missing ?? []), ...(t.gt_path ?? [])]);
    if (t.task_type === 'change_impact') {
      const o = oracle.get(id);
      if (o?.status === 'ok' && o.direct_impact.length) {
        t.impact = { direct: o.direct_impact.filter((k: string) => !k.endsWith('::<module>')), indirect: uniq([...(t.impact?.direct ?? []), ...(t.impact?.indirect ?? [])]).filter((k) => !o.direct_impact.includes(k)), tests: uniq([...o.tests_with_errors, ...(t.impact?.tests ?? [])]).sort(), source: 'type-checker oracle (direct, tests_with_errors) + annotated (indirect, tests)' };
        t.relevant_symbols = uniq([...t.relevant_symbols, ...t.impact.direct]);
      }
    }
    t.root_cause_symbols = t.root_cause_symbols.filter((k: string) => t.relevant_symbols.includes(k));
    if (!t.root_cause_symbols.length) t.root_cause_symbols = [t.gt_path?.[0] ?? t.relevant_symbols[0]];
  }
  t.distractor_symbols = uniq([...(t.distractor_symbols ?? []).filter((k: string) => !(fx.distractors_to_remove ?? []).includes(k)), ...(fx.distractors_to_add ?? [])]).filter((k) => !t.relevant_symbols.includes(k));
  t.relevant_files = uniq([...t.relevant_symbols.map((k: string) => k.split('::')[0]), ...(isA ? t.relevant_files : [])]).sort();
  if (fx.indirect_boundary_corrected && t.strata) t.strata.indirect_boundary = fx.indirect_boundary_corrected;
  // validate keys on the task's own snapshot
  const restore = isA ? materialise(repo, t.snapshot.patch, t.snapshot.apply) : () => {};
  let issues: string[] = [];
  try {
    const files = uniq([...t.relevant_files, ...(t.distractor_symbols ?? []).map((k: string) => k.split('::')[0])]).filter((f) => fs.existsSync(path.join(abs(R.corpusRoot), f)));
    const idx = new SymbolIndex(abs(R.corpusRoot), files);
    const drop = (k: string) => !idx.byKey.has(k);
    const unknownDistractors = (t.distractor_symbols ?? []).filter(drop);
    t.distractor_symbols = (t.distractor_symbols ?? []).filter((k: string) => !drop(k));
    if (unknownDistractors.length) issues.push(`dropped unknown distractors: ${unknownDistractors.join(', ')}`);
    if (t.gt_path) t.gt_path = t.gt_path.filter((k: string) => !drop(k));
    if (t.impact) { t.impact.direct = t.impact.direct.filter((k: string) => !drop(k)); t.impact.indirect = (t.impact.indirect ?? []).filter((k: string) => !drop(k)); }
    issues = issues.concat(validateTasks([t as GroundTruthTask], idx).filter((i) => i.level === 'error').map((i) => i.msg));
  } finally { restore(); }
  if (issues.some((m) => !m.startsWith('dropped'))) { report.push({ task_id: id, status: 'excluded', verdict: 'invalid_after_fixes', reasons: issues }); continue; }
  // strata (mechanical)
  const filesGT = uniq(t.relevant_symbols.map((k: string) => k.split('::')[0]));
  const communities = uniq(filesGT.map((f) => String(commOf.get(f) ?? 'none'))).length;
  const boundary = t.strata?.indirect_boundary ?? fx.indirect_boundary_corrected ?? (isA ? 'none' : 'see-path');
  const pathLen = t.gt_path?.length ?? 0;
  const indirect = ['job', 'event', 'di', 'graphql'].includes(boundary);
  const cross = communities >= 2 && (pathLen >= 3 || indirect || !isA);
  const overlap = lexicalOverlap(t.description, isA ? t.root_cause_symbols : t.relevant_symbols);
  const difficulty = overlap === 'high' ? 'easy' : overlap === 'low' && (filesGT.length >= 2 || indirect || pathLen >= 3) ? 'hard' : 'medium';
  t.strata = { ...(t.strata ?? {}), difficulty, lexical_overlap: overlap, indirect_boundary: boundary, gt_files: filesGT.length, communities_spanned: communities, gt_path_length: pathLen, locality: cross ? 'cross_module' : 'local' };
  t.evidence = uniq([...(t.evidence ?? []), ...(a?.evidence ?? [])]);
  const f = ftp.get(id);
  if (isA) t.executable_evidence = f ? { fail_to_pass: f.status, tests: f.fail_to_pass ?? [] } : { fail_to_pass: 'not_run' };
  t.audit = { status: verdict === 'accept' ? 'accepted' : 'accepted_with_fixes', auditor_confidence: a?.confidence ?? null, adjudicated: !!adj[id], notes: [...(a?.reasons ?? []), ...(d.reasons ?? [])] };
  if (issues.length) t.audit.notes.push(...issues);
  kept.push(t);
  report.push({ task_id: id, status: 'kept', verdict, strata: t.strata });
}
// seeded stratified split: ~25% dev per (category group, difficulty)
const rnd = (() => { let s = 20261110 >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; })();
const groups = new Map<string, any[]>();
for (const t of kept.sort((x, y) => (x.task_id < y.task_id ? -1 : 1))) { const g = `${t.task_type === 'bug_localisation' ? 'A' : 'BCDE'}|${t.strata.difficulty}`; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(t); }
for (const [, ts] of [...groups].sort()) {
  const order = ts.map((t) => ({ t, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.t);
  const nDev = Math.round(order.length * 0.25);
  order.forEach((t, i) => { t.split = i < nDev ? 'dev' : 'test'; });
}
const out = path.join(D, 'v2', repo);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const hashes: Record<string, string> = {};
for (const t of kept) { const txt = JSON.stringify(t, null, 2) + '\n'; fs.writeFileSync(path.join(out, `${t.task_id}.json`), txt); hashes[t.task_id] = crypto.createHash('sha256').update(txt).digest('hex'); }
const datasetHash = crypto.createHash('sha256').update(Object.entries(hashes).sort().map(([k, v]) => `${k} ${v}`).join('\n')).digest('hex');
fs.writeFileSync(path.join(D, 'v2', `${repo}-freeze-report.json`), JSON.stringify({ repo, kept: kept.length, excluded: report.filter((r) => r.status === 'excluded').length, dataset_sha256: datasetHash, report }, null, 2) + '\n');
const frozen = readJson(path.join(D, 'v2', 'FROZEN.json'), { note: 'dataset v2 (experiment 3); per-repository hashes over sorted "task_id sha256(file)" lines', repos: {} });
frozen.repos[repo] = { tasks: kept.length, dev: kept.filter((t) => t.split === 'dev').length, test: kept.filter((t) => t.split === 'test').length, dataset_sha256: datasetHash, files: hashes, frozen_at: new Date().toISOString() };
fs.writeFileSync(path.join(D, 'v2', 'FROZEN.json'), JSON.stringify(frozen, null, 2) + '\n');
console.log(`${repo}: kept ${kept.length} (dev ${frozen.repos[repo].dev}, test ${frozen.repos[repo].test}), excluded ${report.filter((r) => r.status === 'excluded').length}; dataset sha256 ${datasetHash.slice(0, 16)}`);
