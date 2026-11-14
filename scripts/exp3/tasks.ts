#!/usr/bin/env tsx
/**
 * Experiment 3 task tooling for historical-bug tasks (category A) on M (Immich) and L (Twenty). No retrieval method
 * is run or consulted anywhere in this script (E3-D10).
 *
 *   npx tsx scripts/exp3/tasks.ts sanitize --repo immich|twenty   candidates without retrieval-derived fields
 *   npx tsx scripts/exp3/tasks.ts patches  --repo immich|twenty   fix patches (non-test src) + reverse-apply check on the pinned snapshot
 *   npx tsx scripts/exp3/tasks.ts derive   --repo immich|twenty   bug snapshot -> root-cause symbols, strata -> draft v2 tasks
 *   npx tsx scripts/exp3/tasks.ts restore-patches --repo immich|twenty   rebuild the frozen tasks' fix patches from upstream
 *       commits (dataset/v2/<repo>-patch-sources.json; needs the full-history clone REPOS[repo].history) and verify each SHA-256
 *
 * Bug snapshot = pinned snapshot with the fix's non-test source change reverted (`git apply -R`, fuzz -C1 allowed);
 * the fix's own tests stay at the pinned version, so FAIL_TO_PASS can be checked on the same tree.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { abs } from '../../src/config.js';
import { SymbolIndex } from '../../src/evaluation/symbol-index.js';

export const REPOS = {
  immich: { root: 'targets/exp3/immich', src: 'server/src', corpusRoot: 'targets/exp3/immich/server', history: 'targets/exp3/immich-history', pinned: 'a203e288c212f1bd89fc81256dddb792ad3247cd' },
  twenty: { root: 'targets/exp3/twenty', src: 'packages/twenty-server/src', corpusRoot: 'targets/exp3/twenty/packages/twenty-server', history: 'targets/exp3/twenty-history', pinned: 'bde4ff135765e8590d64874cebd5404c0919528d' },
} as const;
export type RepoName = keyof typeof REPOS;
const EXP = 'experiments/03-graph-scale';
const TEST_RE = /(\.spec\.|\.test\.|\/__tests__\/|\/test\/|\/tests\/|e2e)/;
const RETRIEVAL_FIELDS = ['bm25_best_func_rank', 'bm25_best_file_rank', 'grep_hard', 'suitability'];

function git(cwd: string, args: string[], input?: string) {
  const r = spawnSync('git', args, { cwd: abs(cwd), encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const readJsonl = (p: string) => fs.readFileSync(abs(p), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const candidatesPath = (r: RepoName) => `${EXP}/dataset/candidates/${r}.jsonl`;
// Patches contain upstream (AGPL) code: kept outside the tracked tree, reproducible from public history (commit range + sha256).
const patchDir = (r: RepoName) => `targets/exp3/dataset-patches/${r}`;

/** Candidates as mined, minus every field derived from a retrieval method (BM25 ranks, tiers). */
export function sanitize(repo: RepoName) {
  const src = `${EXP}/notes/${repo}-bug-candidates.jsonl`;
  const rows = readJsonl(src).map((r: Record<string, unknown>) => { for (const f of RETRIEVAL_FIELDS) delete r[f]; return r; });
  fs.mkdirSync(path.dirname(abs(candidatesPath(repo))), { recursive: true });
  fs.writeFileSync(abs(candidatesPath(repo)), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${repo}: ${rows.length} candidates -> ${candidatesPath(repo)} (removed: ${RETRIEVAL_FIELDS.join(', ')})`);
}

/** Rebuild the frozen tasks' patches from upstream commits (the patches contain AGPL code and are not redistributed). */
export function restorePatches(repo: RepoName) {
  const R = REPOS[repo];
  const src = JSON.parse(fs.readFileSync(abs(`${EXP}/dataset/v2/${repo}-patch-sources.json`), 'utf8')) as Record<string, { parent_commit: string; merge_commit: string; files: string[]; patch_sha256: string }>;
  fs.mkdirSync(abs(patchDir(repo)), { recursive: true });
  let ok = 0;
  for (const [id, x] of Object.entries(src)) {
    const d = git(R.history, ['diff', '--no-color', '--no-ext-diff', x.parent_commit, x.merge_commit, '--', ...x.files]);
    if (!d.ok) throw new Error(`${id}: git diff failed in ${R.history} (clone the full upstream history there first): ${d.err.slice(0, 200)}`);
    if (sha(d.out) !== x.patch_sha256) throw new Error(`${id}: patch hash mismatch`);
    fs.writeFileSync(abs(`${patchDir(repo)}/${id}.patch`), d.out); ok++;
  }
  console.log(`${repo}: ${ok} patches restored and verified -> ${patchDir(repo)}`);
}

export function patches(repo: RepoName) {
  const R = REPOS[repo];
  const rows = readJsonl(candidatesPath(repo));
  fs.mkdirSync(abs(patchDir(repo)), { recursive: true });
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const files = (r.fixed_files as string[]).filter((f) => f.startsWith(R.src + '/') && /\.tsx?$/.test(f) && !TEST_RE.test(f));
    const id = `${repo}_pr${r.pr}`;
    if (!files.length) { out.push({ task_id: id, pr: r.pr, status: 'no-nontest-ts-files' }); continue; }
    const d = git(R.history, ['diff', '--no-color', '--no-ext-diff', r.parent_commit, r.merge_commit, '--', ...files]);
    if (!d.ok || !d.out.trim()) { out.push({ task_id: id, pr: r.pr, status: 'diff-failed', err: d.err.slice(0, 200) }); continue; }
    const pf = `${patchDir(repo)}/${id}.patch`;
    fs.writeFileSync(abs(pf), d.out);
    let mode: string | null = null;
    if (git(R.root, ['apply', '-R', '--check', abs(pf)]).ok) mode = 'exact';
    else if (git(R.root, ['apply', '-R', '-C1', '--check', abs(pf)]).ok) mode = 'fuzz-C1';
    out.push({ task_id: id, pr: r.pr, status: mode ? 'applies' : 'does-not-apply', mode, files, patch: pf, patch_sha256: sha(d.out) });
  }
  fs.writeFileSync(abs(`${EXP}/dataset/candidates/${repo}-patches.json`), JSON.stringify({ pinned: R.pinned, results: out }, null, 2) + '\n');
  const c = (s: string) => out.filter((x) => x.status === s).length;
  console.log(`${repo}: ${out.length} candidates; applies ${c('applies')} (exact ${out.filter((x) => x.mode === 'exact').length}), does-not-apply ${c('does-not-apply')}, other ${out.length - c('applies') - c('does-not-apply')}`);
}

/** Apply the bug (reverse of the fix) to the pinned snapshot. Returns a restore function. */
export function materialise(repo: RepoName, patchFile: string, mode: string): () => void {
  const R = REPOS[repo];
  const fuzz = mode === 'fuzz-C1' ? ['-C1'] : [];
  const a = git(R.root, ['apply', '-R', ...fuzz, abs(patchFile)]);
  if (!a.ok) throw new Error(`apply -R failed for ${patchFile}: ${a.err}`);
  return () => {
    const files = git(R.root, ['diff', '--name-only']).out.split('\n').filter(Boolean);
    const created = git(R.root, ['ls-files', '--others', '--exclude-standard', '--', R.src]).out.split('\n').filter(Boolean);
    if (files.length) git(R.root, ['checkout', '--', ...files]);
    for (const f of created) fs.rmSync(path.join(abs(R.root), f), { force: true });
    const left = git(R.root, ['status', '--porcelain', '--', R.src]).out.trim();
    if (left) throw new Error(`snapshot not restored: ${left}`);
  };
}

/** Changed line ranges on the working-tree (bug) side, per corpus-relative file. */
function changedLines(repo: RepoName): Map<string, number[]> {
  const R = REPOS[repo];
  const d = git(R.root, ['diff', '-U0', '--no-color', '--', R.src]).out;
  const out = new Map<string, number[]>();
  let file: string | null = null;
  const prefix = path.relative(R.root, R.corpusRoot) + '/';
  for (const line of d.split('\n')) {
    const m = /^\+\+\+ b\/(.*)$/.exec(line);
    if (m) { file = m[1].startsWith(prefix) ? m[1].slice(prefix.length) : null; if (file && !out.has(file)) out.set(file, []); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]); const n = h[2] === undefined ? 1 : Number(h[2]);
      const arr = out.get(file)!;
      if (n === 0) arr.push(start); // pure deletion on the bug side: anchor at the line before
      for (let i = 0; i < n; i++) arr.push(start + i);
    }
  }
  return out;
}

const CALLABLE = new Set(['function', 'method', 'constructor', 'accessor']);

/** Identifier-level lexical overlap of the report with the root cause (mechanical, method-independent). */
export function lexicalOverlap(report: string, keys: string[]): 'high' | 'medium' | 'low' {
  const has = (w: string) => w.length >= 4 && new RegExp(`\\b${w.replace(/[$]/g, '\\$')}\\b`, 'i').test(report);
  let level: 'high' | 'medium' | 'low' = 'low';
  for (const k of keys) {
    const [file, q] = k.split('::');
    const parts = q.split('.');
    const member = parts[parts.length - 1];
    if (parts.length > 1 ? has(member) && member !== 'constructor' : has(parts[0])) return 'high';
    const stem = path.basename(file).replace(/\.(ts|tsx)$/, '').split('.')[0];
    if ((parts.length > 1 && has(parts[0])) || has(stem)) level = 'medium';
  }
  return level;
}

export function derive(repo: RepoName) {
  const R = REPOS[repo];
  const cands = new Map(readJsonl(candidatesPath(repo)).map((r: Record<string, unknown>) => [`${repo}_pr${r.pr}`, r]));
  const pr = JSON.parse(fs.readFileSync(abs(`${EXP}/dataset/candidates/${repo}-patches.json`), 'utf8'));
  const outDir = abs(`${EXP}/dataset/drafts/${repo}`);
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const p of pr.results as Record<string, any>[]) {
    if (p.status !== 'applies') continue;
    const c = cands.get(p.task_id)!;
    const restore = materialise(repo, p.patch, p.mode);
    let task: Record<string, unknown>;
    try {
      const lines = changedLines(repo);
      const files = [...lines.keys()].filter((f) => fs.existsSync(path.join(abs(R.corpusRoot), f)));
      const idx = new SymbolIndex(abs(R.corpusRoot), files);
      const rc = new Set<string>(); const structural = new Set<string>();
      for (const [f, ls] of lines) {
        const syms = idx.byFile.get(f) ?? [];
        for (const l of ls) {
          const inner = syms.filter((s) => s.start_line <= l && l <= s.end_line && s.kind !== 'module').sort((a, b) => (a.end_line - a.start_line) - (b.end_line - b.start_line))[0];
          if (inner && CALLABLE.has(inner.kind)) rc.add(inner.key);
          else if (inner) structural.add(inner.key);
          else structural.add(`${f}::<module>`);
        }
      }
      const root = rc.size ? [...rc].sort() : [...structural].filter((k) => !k.endsWith('::<module>')).sort();
      const report = [c.issue_title, c.symptom_report].filter(Boolean).join('\n\n');
      const overlap = lexicalOverlap(report, root);
      const boundary = String(c.indirect_boundary ?? 'none');
      const multi = files.length >= 2;
      const difficulty = overlap === 'high' ? 'easy' : overlap === 'low' && (multi || ['job', 'event', 'di'].includes(boundary)) ? 'hard' : 'medium';
      task = {
        schema_version: 2, task_id: p.task_id, split: null, repo, task_type: 'bug_localisation',
        description: report,
        root_cause_symbols: root, relevant_symbols: root, relevant_files: [...new Set([...root.map((k) => k.split('::')[0]), ...files])].sort(),
        module_level_changes: [...structural].filter((k) => k.endsWith('::<module>') || !root.includes(k)).sort(),
        snapshot: { kind: 'revert_fix', base_commit: R.pinned, patch: p.patch, patch_sha256: p.patch_sha256, apply: p.mode },
        source: { pr: c.url, issue: c.issue ? `#${c.issue}` : null, merge_commit: c.merge_commit, parent_commit: c.parent_commit, merged_at: c.merged_at, report_source: c.report_source, tests_added: c.tests_added ?? [], test_files_changed: c.test_files_changed ?? [] },
        strata: { difficulty, lexical_overlap: overlap, indirect_boundary: boundary, gt_files: files.length },
        evidence: [`fix ${c.merge_commit} (${c.url})`, ...((c.tests_added as string[] | undefined) ?? []).map((t) => `test: ${t}`)],
        audit: { status: 'pending' },
      };
    } finally { restore(); }
    fs.writeFileSync(path.join(outDir, `${p.task_id}.json`), JSON.stringify(task, null, 2) + '\n');
    n++;
  }
  console.log(`${repo}: ${n} draft tasks in ${path.relative(process.cwd(), outDir)}`);
}

const cmd = process.argv[2];
const repo = arg('repo') as RepoName;
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('tasks.ts')) {
  if (!REPOS[repo]) { console.error('usage: tasks.ts sanitize|patches|derive|restore-patches --repo immich|twenty'); process.exit(2); }
  if (cmd === 'sanitize') sanitize(repo);
  else if (cmd === 'patches') patches(repo);
  else if (cmd === 'restore-patches') restorePatches(repo);
  else if (cmd === 'derive') derive(repo);
  else { console.error(`unknown command ${cmd}`); process.exit(2); }
}
