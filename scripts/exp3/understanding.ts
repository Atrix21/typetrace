#!/usr/bin/env tsx
/**
 * Experiment 3: convert drafted understanding tasks (categories B–E; notes/<repo>-understanding-tasks.json, written by
 * the mining agents with file:line ground truth) into v2 task drafts with canonical symbol keys at the pinned
 * snapshot. Each file:line is mapped to the innermost declaration containing it (callables preferred); the drafted
 * symbol name is kept and a name mismatch is flagged for the auditor. No retrieval method is involved.
 *
 *   npx tsx scripts/exp3/understanding.ts --repo immich|twenty
 */
import fs from 'node:fs';
import path from 'node:path';
import { abs } from '../../src/config.js';
import { SymbolIndex, type CanonicalSymbol } from '../../src/evaluation/symbol-index.js';
import { REPOS, type RepoName } from './tasks.js';

const repo = process.argv[process.argv.indexOf('--repo') + 1] as RepoName;
const R = REPOS[repo];
const EXP = 'experiments/03-graph-scale';
const prefix = path.relative(R.root, R.corpusRoot) + '/';
const raw = JSON.parse(fs.readFileSync(abs(`${EXP}/notes/${repo}-understanding-tasks.json`), 'utf8')) as Record<string, any>[];
const CAT: Record<string, string> = { B: 'feature_understanding', C: 'change_impact', D: 'data_flow', E: 'architecture' };
const rel = (f: string) => (f.startsWith(prefix) ? f.slice(prefix.length) : f);
const files = new Set<string>();
const collect = (x: any) => { if (x && typeof x === 'object' && typeof x.file === 'string' && /\.tsx?$/.test(x.file)) files.add(rel(x.file)); };
for (const t of raw) for (const k of ['gt_path', 'relevant', 'alternatives', 'distractors']) (t[k] ?? []).forEach(collect);
for (const t of raw) for (const k of ['direct', 'indirect']) (t.impact?.[k] ?? []).forEach(collect);
const existing = [...files].filter((f) => fs.existsSync(path.join(abs(R.corpusRoot), f)));
const idx = new SymbolIndex(abs(R.corpusRoot), existing);
const CALL = new Set(['function', 'method', 'constructor', 'accessor']);

const issues: string[] = [];
function keyOf(x: any, where: string): string | null {
  if (!x || typeof x !== 'object' || !x.file) return null;
  const f = rel(x.file);
  const syms = idx.byFile.get(f);
  if (!syms) { issues.push(`${where}: file not found ${f}`); return null; }
  const line = Number(x.line);
  const containing = syms.filter((s) => s.kind !== 'module' && s.start_line <= line && line <= s.end_line).sort((a, b) => (a.end_line - a.start_line) - (b.end_line - b.start_line));
  const best: CanonicalSymbol | undefined = containing.find((s) => CALL.has(s.kind)) ?? containing[0];
  if (!best) { issues.push(`${where}: no declaration at ${f}:${line}`); return null; }
  const want = String(x.symbol ?? '');
  const last = best.name.split('.').pop()!;
  if (want && !want.includes(last)) issues.push(`${where}: drafted '${want}' but ${f}:${line} is inside ${best.name}`);
  return best.key;
}

const out = path.join(abs(`${EXP}/dataset/drafts/${repo}`));
fs.mkdirSync(out, { recursive: true });
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
for (const t of raw) {
  const id = `${repo}_${String(t.id).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const pathKeys = uniq((t.gt_path ?? []).map((x: any, i: number) => keyOf(x, `${t.id} gt_path[${i}]`)));
  const relevant = uniq([...pathKeys, ...(t.relevant ?? []).map((x: any, i: number) => keyOf(x, `${t.id} relevant[${i}]`))]);
  const direct = uniq((t.impact?.direct ?? []).map((x: any, i: number) => keyOf(x, `${t.id} impact.direct[${i}]`)));
  const indirect = uniq((t.impact?.indirect ?? []).map((x: any, i: number) => keyOf(x, `${t.id} impact.indirect[${i}]`)));
  const distractors = uniq((t.distractors ?? []).map((x: any, i: number) => keyOf(x, `${t.id} distractors[${i}]`))).filter((k) => !relevant.includes(k));
  const anchor = t.category === 'C' && direct.length ? [direct[0]] : pathKeys.length ? [pathKeys[0]] : relevant.slice(0, 1);
  const relevantAll = uniq([...relevant, ...direct, ...indirect, ...anchor]);
  const task = {
    schema_version: 2, task_id: id, split: null, repo, task_type: CAT[t.category], category: t.category,
    description: t.query,
    root_cause_symbols: anchor, anchor_note: 'non-bug task: root_cause_symbols holds the anchor (entry point / changed symbol); RC metrics are reported for category A only',
    relevant_symbols: relevantAll, relevant_files: uniq(relevantAll.map((k) => k.split('::')[0])).sort(),
    gt_path: pathKeys, impact: t.category === 'C' ? { direct, indirect, tests: (t.impact?.tests ?? []).map((x: any) => rel(typeof x === 'string' ? x : x.file)) } : undefined,
    oracle_edit: t.oracle_edit ? { ...t.oracle_edit, file: rel(t.oracle_edit.file) } : undefined,
    alternatives: t.alternatives ?? [], distractor_symbols: distractors,
    snapshot: { kind: 'pinned', base_commit: R.pinned },
    source: { drafted_by: `mining agent (${repo})`, draft_id: t.id, verification: t.verification ?? null, notes: t.notes ?? null },
    evidence: t.evidence ?? [],
    strata: null, audit: { status: 'pending' },
  };
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(task, null, 2) + '\n');
}
fs.writeFileSync(abs(`${EXP}/dataset/drafts/${repo}-understanding-mapping.txt`), issues.join('\n') + '\n');
console.log(`${repo}: ${raw.length} understanding tasks -> drafts; ${issues.length} mapping notes (dataset/drafts/${repo}-understanding-mapping.txt)`);
